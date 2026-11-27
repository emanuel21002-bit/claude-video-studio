// Painel do MovAi dentro do Premiere Pro (extensão CEP). O painel é só a tela e as mãos: o chat e o Claude rodam aqui no app,
// que já tem o login, as skills e o decupador. Os dois conversam por HTTP em 127.0.0.1, com um token gravado no
// painel quando ele é instalado. Cada ferramenta do Claude vira um "comando" que o painel busca (long-poll),
// executa no ExtendScript do Premiere (sequência, clipes, efeitos) e devolve o resultado.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { carregar, arquivoDoApp } from './settings.mjs';
import { dirs } from './workspace.mjs';
import { rodar } from './proc.mjs';
import { claudeExe } from './agente.mjs';
import { trechosDaDecupagem, decuparAudio } from './decupar.mjs';

const require = createRequire(import.meta.url);
export const PORTA_PREMIERE = 47821;
const ESPERA_EVENTOS = 20_000; // ms de long-poll
const ESPERA_COMANDO = 120_000; // ms para o painel responder um comando

// ---------- estado ----------

const eventos = []; // { n, tipo, ... } — os últimos 500
let contador = 0;
const esperando = new Set(); // respostas HTTP paradas no long-poll
const pendentes = new Map(); // id do comando -> { resolver, timer }
let controle = null; // AbortController do turno do Claude
let ultimoContato = 0; // quando o painel pediu eventos pela última vez
const acompanhando = new Map(); // id da timeline -> nome, dos vídeos novos pedidos pelo painel
let ganchos = {}; // funções do main.mjs: criarVideo, estilos (ver configurarPremiere)

// O painel fica ocupado com o chat ou com um vídeo novo sendo montado.
const ocupado = () => !!controle || acompanhando.size > 0;

export const painelConectado = () => Date.now() - ultimoContato < ESPERA_EVENTOS + 5000;

function emitir(ev) {
  const e = { n: ++contador, em: Date.now(), ...ev };
  eventos.push(e);
  if (eventos.length > 500) eventos.splice(0, eventos.length - 500);
  if (['texto', 'acao', 'erro', 'voce'].includes(e.tipo)) guardarHistorico(e);
  for (const r of esperando) entregar(r.res, r.desde);
  esperando.clear();
}

function entregar(res, desde) {
  const lista = eventos.filter((e) => e.n > desde);
  responder(res, 200, { eventos: lista, ultimo: contador, ocupado: ocupado() });
}

// ---------- histórico e sessão ----------

const pasta = () => {
  const p = path.join(dirs().ws, 'premiere');
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const arqHistorico = () => path.join(pasta(), 'chat.json');
const arqSessao = () => path.join(pasta(), 'sessao.json');

function lerJson(arq, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arq, 'utf8'));
  } catch {
    return padrao;
  }
}

function guardarHistorico(e) {
  const h = lerJson(arqHistorico(), []);
  h.push({ tipo: e.tipo, texto: e.texto, em: e.em });
  fs.writeFileSync(arqHistorico(), JSON.stringify(h.slice(-300)));
}

// ---------- servidor ----------

function responder(res, codigo, corpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-movai-token' });
  res.end(JSON.stringify(corpo));
}

const lerCorpo = (req) =>
  new Promise((ok, falha) => {
    let dados = '';
    req.on('data', (c) => {
      dados += c;
      if (dados.length > 5e6) req.destroy();
    });
    req.on('end', () => {
      try {
        ok(dados ? JSON.parse(dados) : {});
      } catch (e) {
        falha(e);
      }
    });
    req.on('error', falha);
  });

// Num arquivo à parte: o settings.json é regravado inteiro pelo app, e uma cópia antiga em memória apagaria o token.
export function tokenPremiere() {
  const arq = arquivoDoApp('premiere-token.txt');
  try {
    const t = fs.readFileSync(arq, 'utf8').trim();
    if (t) return t;
  } catch {}
  const novo = crypto.randomBytes(18).toString('hex');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, novo);
  return novo;
}

let servidor = null;

export function iniciarPontePremiere(onLog) {
  if (servidor) return;
  const token = tokenPremiere();
  servidor = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return responder(res, 204, {});
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/estado') return responder(res, 200, { app: 'MovAi', ok: true });
    if (req.headers['x-movai-token'] !== token) return responder(res, 401, { erro: 'Token inválido: reinstale o painel pelo MovAi.' });
    try {
      if (req.method === 'GET' && url.pathname === '/eventos') {
        ultimoContato = Date.now();
        const desde = Number(url.searchParams.get('desde') ?? 0);
        if (eventos.some((e) => e.n > desde) || desde > contador) return entregar(res, desde > contador ? 0 : desde);
        const r = { res, desde };
        esperando.add(r);
        const t = setTimeout(() => {
          esperando.delete(r);
          entregar(res, desde);
        }, ESPERA_EVENTOS);
        res.on('close', () => {
          clearTimeout(t);
          esperando.delete(r);
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/historico') return responder(res, 200, { historico: lerJson(arqHistorico(), []), ultimo: contador, ocupado: ocupado() });
      const corpo = req.method === 'POST' ? await lerCorpo(req) : {};
      if (url.pathname === '/chat') {
        if (ocupado()) return responder(res, 409, { erro: 'O Claude ainda está trabalhando.' });
        const mensagem = String(corpo.mensagem ?? '').trim();
        if (!mensagem) return responder(res, 400, { erro: 'Mensagem vazia.' });
        emitir({ tipo: 'voce', texto: mensagem });
        conversarNoPremiere(mensagem, corpo.contexto).catch((e) => emitir({ tipo: 'erro', texto: e.message }));
        return responder(res, 202, { ok: true });
      }
      if (url.pathname === '/cancelar') {
        controle?.abort();
        for (const [id, p] of pendentes) p.resolver({ ok: false, erro: 'Cancelado.' }), pendentes.delete(id);
        return responder(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/estilos') return responder(res, 200, ganchos.estilos?.() ?? { estilos: [], formatos: [] });
      if (url.pathname === '/escolher') return responder(res, 200, { caminhos: await escolher(corpo) });
      if (url.pathname === '/novo-video') {
        if (ocupado()) return responder(res, 409, { erro: 'Espere o Claude terminar.' });
        const ids = await novoVideo(corpo);
        return responder(res, 202, { ok: true, ids });
      }
      if (url.pathname === '/novo') {
        if (ocupado()) return responder(res, 409, { erro: 'Espere o Claude terminar.' });
        fs.rmSync(arqSessao(), { force: true });
        fs.rmSync(arqHistorico(), { force: true });
        return responder(res, 200, { ok: true });
      }
      if (url.pathname === '/resposta') {
        const p = pendentes.get(corpo.id);
        if (p) {
          pendentes.delete(corpo.id);
          clearTimeout(p.timer);
          p.resolver(corpo);
        }
        return responder(res, 200, { ok: true });
      }
      responder(res, 404, { erro: 'Rota desconhecida.' });
    } catch (e) {
      responder(res, 500, { erro: e.message });
    }
  });
  servidor.on('error', (e) => onLog?.(`Painel do Premiere: não consegui abrir a porta ${PORTA_PREMIERE} (${e.code ?? e.message}).`));
  servidor.listen(PORTA_PREMIERE, '127.0.0.1');
}

// Manda um comando ao painel e espera a resposta.
function pedir(nome, args = {}) {
  if (!painelConectado()) return Promise.resolve({ ok: false, erro: 'O painel do MovAi não está aberto no Premiere (Janela → Extensões → MovAi).' });
  const id = crypto.randomUUID();
  return new Promise((ok) => {
    const timer = setTimeout(() => {
      pendentes.delete(id);
      ok({ ok: false, erro: `O Premiere não respondeu em ${ESPERA_COMANDO / 1000} s.` });
    }, ESPERA_COMANDO);
    pendentes.set(id, { resolver: ok, timer });
    emitir({ tipo: 'comando', id, nome, args });
  });
}

const texto = (t, erro = false) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t) }], ...(erro ? { isError: true } : {}) });
const viaPainel = (nome) => async (args) => {
  const r = await pedir(nome, args);
  return r.ok ? texto(r.resultado ?? 'ok') : texto(r.erro ?? 'Falhou.', true);
};

// ---------- o Claude ----------

const PROMPT = `
Você está no painel do MovAi dentro do Adobe Premiere Pro 2026 (26.x). Você é o editor: edita a SEQUÊNCIA ABERTA no Premiere pelas ferramentas mcp__premiere__*. Responda em português do Brasil, curto e direto.

COMO TRABALHAR
- Comece por mcp__premiere__ler_sequencia: ela dá o tamanho, o fps, as trilhas (V1, V2…, A1, A2…) e os clipes com id ("V1.0", "A2.3"…, por ordem de tempo), início/fim na sequência, entrada/saída na mídia e o caminho do arquivo.
- Os ids mudam depois de editar: leia de novo antes de uma nova rodada de edições.
- Tempos sempre em segundos. Faça várias operações numa chamada (editar_clipes aceita uma lista). Cortar usa a lâmina do Premiere e leva junto o áudio ou vídeo ligado ao clipe.
- Arquivos novos: importe com importar (caminhos absolutos) e coloque com colocar_clipe.
- Não existe ferramenta para criar trilhas: use as que existem e, se faltar, peça ao usuário para criar.
- Texto e legenda: a API do Premiere não cria texto. Use MOGRT (inserir_mogrt) se o usuário tiver um, ou diga o que ele precisa fazer.
- Para ver o conteúdo de um vídeo, use ver_quadros (lê o arquivo de mídia direto).
- Narração: decupar_narracao corta as pausas no padrão do usuário. modo "cortes" põe os trechos na sequência (editáveis, sem acelerar); modo "arquivo" gera o áudio decupado (com 1,2x, sobreposição e limpeza) e coloca na sequência.
- Movimento: escala em %, posição em pixels do quadro (0,0 no canto superior esquerdo), rotação em graus, opacidade em %. Keyframes: tempos em segundos da sequência.
- Transições e efeitos: use listar_transicoes / listar_efeitos para achar o nome exato (pode estar em português) antes de aplicar.

SKILLS
- Vídeo de estética automotiva (lavagem, polimento, vitrificação, detailer, película, farol): leia a skill "edicao-reels-estetica" antes de montar e siga o padrão de edição dela (ordem do serviço, ritmo, cortes, light leak, logo), aplicando pelas ferramentas do Premiere. Ignore o que nela for do Remotion ou do projeto meu-video.
- Roteiro, falas ou copy de estética automotiva: skill "roteiros-estetica-automotiva".
`;

function resumo(nome, input = {}) {
  const n = nome.replace(/^mcp__premiere__/, '');
  const mapa = {
    ler_sequencia: 'Lendo a sequência',
    importar: `Importando ${(input.arquivos ?? []).length} arquivo(s)`,
    colocar_clipe: `Colocando ${path.basename(input.arquivo ?? '')}`,
    editar_clipes: `Editando ${(input.operacoes ?? []).length} clipe(s)`,
    movimento: `Ajustando o movimento de ${input.clipe ?? ''}`,
    aplicar_transicao: `Transição em ${(input.clipes ?? []).join(', ')}`,
    aplicar_efeito: `Efeito em ${(input.clipes ?? []).join(', ')}`,
    marcadores: 'Criando marcadores',
    decupar_narracao: `Decupando ${path.basename(input.arquivo ?? '')}`,
    ver_quadros: `Vendo quadros de ${path.basename(input.arquivo ?? '')}`,
  };
  if (mapa[n]) return mapa[n];
  if (nome === 'Skill') return `Lendo a skill ${input.skill ?? ''}`;
  if (nome === 'Read') return `Lendo ${path.basename(input.file_path ?? '')}`;
  return n;
}

async function quadros(arquivo, segundos) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-pr-quadros-'));
  const saida = path.join(tmp, 'folha.jpg');
  const entradas = segundos.flatMap((s) => ['-ss', String(s), '-i', arquivo]);
  // Na ordem pedida, da esquerda para a direita, todos com a mesma altura.
  const escala = segundos.map((_, i) => `[${i}:v]scale=-2:640,setsar=1${segundos.length > 1 ? `[q${i}]` : ''}`).join(';');
  const grafo = segundos.length > 1 ? `${escala};${segundos.map((_, i) => `[q${i}]`).join('')}hstack=inputs=${segundos.length}` : escala;
  const r = await rodar(carregar().ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...entradas, '-filter_complex', grafo, '-frames:v', '1', '-q:v', '4', saida]);
  if (r.codigo !== 0) throw new Error(r.cauda);
  const dados = fs.readFileSync(saida).toString('base64');
  fs.rmSync(tmp, { recursive: true, force: true });
  return dados;
}

async function conversarNoPremiere(mensagem, contexto) {
  const s = carregar();
  controle = new AbortController();
  const tId = z.string().describe('Id do clipe, como "V1.0" ou "A2.3" (de ler_sequencia).');
  const premiere = createSdkMcpServer({
    name: 'premiere',
    version: '1.0.0',
    tools: [
      tool('ler_sequencia', 'A sequência aberta: tamanho, fps, posição da agulha, trilhas e clipes (id, nome, início/fim, entrada/saída na mídia, arquivo, desativado), e os marcadores.', {}, viaPainel('ler_sequencia')),
      tool('importar', 'Importa arquivos (caminhos absolutos) para o projeto do Premiere. Arquivos já importados são reaproveitados.', { arquivos: z.array(z.string()).min(1).max(50) }, viaPainel('importar')),
      tool(
        'colocar_clipe',
        'Põe um arquivo (importa se preciso) na sequência. Com entrada/saida usa só esse pedaço da mídia. modo "sobrepor" (padrão) ou "inserir" (empurra o resto).',
        {
          arquivo: z.string(),
          inicio: z.number().min(0).describe('Segundo da sequência.'),
          trilhaVideo: z.number().int().min(1).optional().describe('Número da trilha de vídeo (1 = V1). Padrão 1.'),
          trilhaAudio: z.number().int().min(1).optional().describe('Número da trilha de áudio (1 = A1). Padrão 1.'),
          entrada: z.number().min(0).optional(),
          saida: z.number().min(0).optional(),
          modo: z.enum(['sobrepor', 'inserir']).optional(),
        },
        viaPainel('colocar_clipe'),
      ),
      tool(
        'editar_clipes',
        'Edita clipes, tudo num passo de desfazer. Operações: {op:"mover",clipe,inicio} | {op:"aparar",clipe,inicio?,fim?} (bordas na sequência, mexe na mídia junto) | {op:"cortar",clipe,em} (divide em dois no segundo da sequência) | {op:"remover",clipe,ripple?} | {op:"desativar",clipe,desativado} | {op:"renomear",clipe,nome} | {op:"duplicar",clipe,deslocamento?,trilhas?}.',
        { operacoes: z.array(z.record(z.string(), z.any())).min(1).max(200) },
        viaPainel('editar_clipes'),
      ),
      tool(
        'movimento',
        'Movimento e opacidade de um clipe de vídeo. Valores fixos ou keyframes [{t (segundo da sequência), v}] para escala (%), posicao ([x,y] px), rotacao (graus), opacidade (%).',
        {
          clipe: tId,
          escala: z.union([z.number(), z.array(z.object({ t: z.number(), v: z.number() }))]).optional(),
          posicao: z.union([z.array(z.number()).length(2), z.array(z.object({ t: z.number(), v: z.array(z.number()).length(2) }))]).optional(),
          rotacao: z.union([z.number(), z.array(z.object({ t: z.number(), v: z.number() }))]).optional(),
          opacidade: z.union([z.number(), z.array(z.object({ t: z.number(), v: z.number() }))]).optional(),
        },
        viaPainel('movimento'),
      ),
      tool('listar_transicoes', 'Lista os nomes das transições de vídeo do Premiere, como aparecem no painel Efeitos (com filtro opcional).', { busca: z.string().optional() }, viaPainel('listar_transicoes')),
      tool(
        'aplicar_transicao',
        'Aplica uma transição de vídeo no fim (padrão) ou no começo de cada clipe.',
        { clipes: z.array(tId).min(1), nome: z.string().describe('Nome exato de listar_transicoes.'), duracao: z.number().min(0.04).max(5).optional(), lado: z.enum(['fim', 'inicio']).optional(), umLado: z.boolean().optional() },
        viaPainel('aplicar_transicao'),
      ),
      tool('listar_efeitos', 'Lista os nomes dos efeitos de vídeo do Premiere (com filtro).', { busca: z.string().optional() }, viaPainel('listar_efeitos')),
      tool('aplicar_efeito', 'Adiciona um efeito de vídeo aos clipes, pelo nome exato de listar_efeitos.', { clipes: z.array(tId).min(1), nome: z.string() }, viaPainel('aplicar_efeito')),
      tool(
        'marcadores',
        'Cria marcadores na sequência.',
        { lista: z.array(z.object({ t: z.number().min(0), nome: z.string(), comentario: z.string().optional(), duracao: z.number().min(0).optional() })).min(1).max(100) },
        viaPainel('marcadores'),
      ),
      tool(
        'trazer_do_app',
        'Leva uma timeline já montada no MovAi para o Premiere como sequência nova (cortes nativos + textos e legendas renderizados por cima). timeline = id completo "projeto/timeline".',
        { timeline: z.string() },
        async ({ timeline }) => {
          try {
            return texto(await exportarSequencia(timeline, (l) => emitir({ tipo: 'progresso', texto: l })));
          } catch (e) {
            return texto(e.message, true);
          }
        },
      ),
      tool('inserir_mogrt', 'Insere um modelo de Essential Graphics (.mogrt) na sequência.', { arquivo: z.string(), inicio: z.number().min(0), trilhaVideo: z.number().int().min(1).optional() }, viaPainel('inserir_mogrt')),
      tool(
        'ver_quadros',
        'Imagem com quadros de um arquivo de mídia nos segundos pedidos (do arquivo, não da sequência).',
        { arquivo: z.string(), segundos: z.array(z.number().min(0)).min(1).max(6) },
        async ({ arquivo, segundos }) => {
          try {
            return { content: [{ type: 'image', data: await quadros(arquivo, segundos), mimeType: 'image/jpeg' }] };
          } catch (e) {
            return texto(e.message, true);
          }
        },
      ),
      tool(
        'decupar_narracao',
        'Corta as pausas de uma narração no padrão do usuário e põe na sequência a partir de "inicio". modo "cortes": os trechos viram clipes, alternando entre trilhaAudio e a de baixo para a sobreposição. modo "arquivo": gera o áudio decupado (1,2x, limpeza) e coloca um clipe só.',
        { arquivo: z.string(), inicio: z.number().min(0).optional(), trilhaAudio: z.number().int().min(1).optional(), modo: z.enum(['cortes', 'arquivo']).optional() },
        async ({ arquivo, inicio = 0, trilhaAudio = 1, modo = 'cortes' }) => {
          try {
            if (!fs.existsSync(arquivo)) return texto(`Não achei ${arquivo}.`, true);
            if (modo === 'arquivo') {
              emitir({ tipo: 'acao', texto: 'Gerando o áudio decupado…' });
              const r = await decuparAudio(arquivo, { formato: 'wav' }, null, controle.signal);
              const p = await pedir('colocar_clipe', { arquivo: r.saida, inicio, trilhaAudio, soAudio: true });
              return p.ok ? texto(`Decupado: ${r.antes.toFixed(1)} s → ${r.depois.toFixed(1)} s, ${r.cortes} cortes. Arquivo ${r.saida}. ${p.resultado ?? ''}`) : texto(p.erro, true);
            }
            const d = await trechosDaDecupagem(arquivo, {}, controle.signal);
            const p = await pedir('montar_trechos', { arquivo, inicio, trilhaAudio, trechos: d.trechos, sobreposicoes: d.sobreposicoes });
            const fica = d.trechos.reduce((a, [x, y]) => a + y - x, 0) - d.sobreposicoes.reduce((a, x) => a + x, 0);
            return p.ok ? texto(`${d.trechos.length} trechos na sequência: ${d.duracao.toFixed(1)} s → ${fica.toFixed(1)} s (sem a aceleração). ${p.resultado ?? ''}`) : texto(p.erro, true);
          } catch (e) {
            return texto(e.message, true);
          }
        },
      ),
    ],
  });
  const nomes = ['ler_sequencia', 'importar', 'colocar_clipe', 'editar_clipes', 'movimento', 'listar_transicoes', 'aplicar_transicao', 'listar_efeitos', 'aplicar_efeito', 'marcadores', 'inserir_mogrt', 'ver_quadros', 'decupar_narracao', 'trazer_do_app'];
  const env = { ...process.env, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', MCP_TOOL_TIMEOUT: String(60 * 60 * 1000), CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '45' };
  if (s.apiKey) env.ANTHROPIC_API_KEY = s.apiKey;
  const sessao = lerJson(arqSessao(), {}).id;
  const guardar = (id) => id && fs.writeFileSync(arqSessao(), JSON.stringify({ id }));
  try {
    const q = query({
      prompt: contexto ? `${mensagem}\n\n(Contexto do Premiere: ${contexto})` : mensagem,
      options: {
        cwd: pasta(),
        model: s.modeloClaude,
        effort: ['low', 'medium', 'high', 'xhigh'].includes(s.esforcoClaude) ? s.esforcoClaude : 'high',
        resume: sessao ?? undefined,
        abortController: controle,
        pathToClaudeCodeExecutable: claudeExe(),
        env,
        settingSources: ['user', 'project'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: PROMPT },
        mcpServers: { premiere },
        permissionMode: 'dontAsk',
        allowedTools: ['Read', 'Glob', 'Grep', 'Skill', ...nomes.map((n) => `mcp__premiere__${n}`)],
      },
    });
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') guardar(msg.session_id);
      else if (msg.type === 'assistant') {
        for (const b of msg.message.content) {
          if (b.type === 'text' && b.text.trim()) emitir({ tipo: 'texto', texto: b.text });
          else if (b.type === 'tool_use') emitir({ tipo: 'acao', texto: resumo(b.name, b.input) });
        }
      } else if (msg.type === 'result') {
        guardar(msg.session_id);
        emitir(msg.subtype === 'success' ? { tipo: 'fim' } : { tipo: 'erro', texto: `O Claude parou: ${msg.subtype}` });
      }
    }
  } catch (e) {
    emitir({ tipo: 'erro', texto: controle.signal.aborted ? 'Cancelado.' : e.message });
  } finally {
    controle = null;
    emitir({ tipo: 'parado' });
  }
}

// ---------- vídeo novo pelo painel ----------

// O main.mjs passa as funções do app: criarVideo(dados) cria o projeto e põe as timelines na fila do Claude (o mesmo
// caminho do "Novo projeto"); estilos() lista os estilos e formatos.
export function configurarPremiere(g) {
  ganchos = g;
}

const EXT_MIDIA = /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts|mxf|jpg|jpeg|png|webp|heic|gif|tif|tiff|mp3|wav|m4a|aac|flac|ogg)$/i;

// Pastas viram a lista dos arquivos de mídia dentro delas (sem descer em subpastas de sistema).
function expandir(caminhos) {
  const r = [];
  for (const c of caminhos ?? []) {
    if (!fs.existsSync(c)) continue;
    if (!fs.statSync(c).isDirectory()) r.push(c);
    else for (const n of fs.readdirSync(c).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))) {
      const f = path.join(c, n);
      if (!n.startsWith('.') && fs.statSync(f).isFile() && EXT_MIDIA.test(n)) r.push(f);
    }
  }
  return r;
}

// Janela de escolher arquivos do Windows, aberta pelo app (o painel do CEP não tem uma confiável).
async function escolher({ tipo = 'arquivos', titulo, filtro } = {}) {
  const { dialog, BrowserWindow } = await import('electron');
  const dono = new BrowserWindow({ show: false, alwaysOnTop: true });
  try {
    const filtros = filtro === 'audio' ? [{ name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] }] : filtro === 'midia' ? [{ name: 'Vídeos e fotos', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'jpg', 'jpeg', 'png', 'webp', 'heic'] }] : [];
    const r = await dialog.showOpenDialog(dono, {
      title: titulo ?? (tipo === 'pasta' ? 'Escolha a pasta' : 'Escolha os arquivos'),
      properties: tipo === 'pasta' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters: filtros,
    });
    return r.canceled ? [] : r.filePaths;
  } finally {
    dono.destroy();
  }
}

async function novoVideo(d) {
  if (!ganchos.criarVideo) throw new Error('Atualize o MovAi: esta versão não cria vídeos pelo painel.');
  const materiais = expandir(d.materiais);
  if (!materiais.length && !d.soMotion) throw new Error('Escolha o material (vídeos e fotos).');
  emitir({ tipo: 'acao', texto: `Criando o projeto: ${materiais.length} materiais, ${(d.narracoes ?? []).length || 'sem'} narração(ões)…` });
  const criados = await ganchos.criarVideo({ ...d, materiais }, (l) => emitir({ tipo: 'progresso', texto: l }));
  for (const p of criados) acompanhando.set(p.id, p.nome);
  emitir({ tipo: 'acao', texto: `${criados.length > 1 ? `${criados.length} vídeos na fila` : 'Vídeo na fila'}: o Claude está montando no MovAi. A sequência aparece aqui quando ficar pronta.` });
  emitir({ tipo: 'ocupado' });
  return criados.map((p) => p.id);
}

// Recebe os eventos que o app manda à própria janela: os da montagem dos vídeos do painel aparecem no chat.
export function notificarPremiere(canal, dados) {
  if (canal !== 'agente' || !acompanhando.has(dados?.id)) return;
  const nome = acompanhando.get(dados.id);
  if (dados.tipo === 'texto' && dados.texto) emitir({ tipo: 'texto', texto: `${nome}: ${dados.texto}` });
  else if ((dados.tipo === 'acao' || dados.tipo === 'preparo') && dados.texto) emitir({ tipo: 'progresso', texto: `${nome}: ${dados.texto}` });
  else if (dados.tipo === 'erro' && dados.texto) emitir({ tipo: 'erro', texto: `${nome}: ${dados.texto}` });
}

// Chamado pelo main.mjs quando o Claude termina de montar uma timeline.
export async function aoTerminarMontagem(id) {
  if (!acompanhando.has(id)) return;
  const nome = acompanhando.get(id);
  try {
    emitir({ tipo: 'acao', texto: `${nome}: montado. Preparando textos e legendas para o Premiere…` });
    const r = await exportarSequencia(id, (l) => emitir({ tipo: 'progresso', texto: `${nome}: ${l}` }));
    emitir({ tipo: 'texto', texto: `${nome}: sequência criada no Premiere. ${r}` });
  } catch (e) {
    emitir({ tipo: 'erro', texto: `${nome}: não consegui levar para o Premiere: ${String(e.message ?? e).split('\n')[0]}` });
  } finally {
    acompanhando.delete(id);
    if (!ocupado()) emitir({ tipo: 'parado' });
  }
}

// Arquivo com a extensão trocada (um .mp3 que na verdade é M4A, comum em packs baixados): o Premiere não abre.
// Lê o começo do arquivo e, se não bater, aponta para um link com a extensão certa.
function extensaoCerta(arquivo) {
  let b;
  try {
    const fd = fs.openSync(arquivo, 'r');
    b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  const ext = path.extname(arquivo).toLowerCase();
  const audio = /^\.(mp3|wav|m4a|aac|flac|ogg|opus)$/.test(ext);
  if (b.toString('latin1', 4, 8) === 'ftyp' && !/^\.(mp4|mov|m4a|m4v|3gp)$/.test(ext)) return audio ? '.m4a' : '.mp4';
  if ((b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) && ext !== '.mp3') return '.mp3';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE' && ext !== '.wav') return '.wav';
  return null;
}

function corrigirExtensoes(otio, pastaMidia) {
  const { fileURLToPath, pathToFileURL } = require('node:url');
  const trocados = [];
  const visitar = (no) => {
    if (!no || typeof no !== 'object') return;
    if (no.OTIO_SCHEMA?.startsWith('ExternalReference') && no.target_url?.startsWith('file:')) {
      const arq = fileURLToPath(no.target_url);
      const nova = extensaoCerta(arq);
      if (nova) {
        fs.mkdirSync(pastaMidia, { recursive: true });
        const destino = path.join(pastaMidia, path.basename(arq, path.extname(arq)) + nova);
        if (!fs.existsSync(destino)) {
          try {
            fs.linkSync(arq, destino);
          } catch {
            fs.copyFileSync(arq, destino);
          }
        }
        no.target_url = pathToFileURL(destino).href;
        no.name = path.basename(destino);
        trocados.push(path.basename(arq));
      }
    }
    for (const v of Object.values(no)) if (v && typeof v === 'object') visitar(v);
  };
  visitar(otio);
  return [...new Set(trocados)];
}

// Gera o OTIO da timeline e manda o painel importar como uma sequência nova.
export async function exportarSequencia(id, onLinha) {
  const { args, trocados } = await prepararSequencia(id, onLinha);
  const r = await pedir('importar_sequencia', args);
  if (!r.ok) throw new Error(r.erro);
  return `${r.resultado ?? ''}${trocados.length ? ` (${trocados.length} arquivo(s) com extensão trocada foram ligados com a extensão certa: ${trocados.join(', ')})` : ''}`;
}

// O OTIO pronto para o Premiere e os argumentos do comando importar_sequencia.
export async function prepararSequencia(id, onLinha) {
  const { otioDaTimeline } = await import('./filmcraft.mjs');
  const { lerProjeto, caminhoTimeline, caminhoAssets } = await import('./workspace.mjs');
  const projeto = lerProjeto(id);
  const { otio, largura, altura } = await otioDaTimeline(id, onLinha);
  const nome = projeto.nome;
  otio.name = nome;
  if (otio.tracks) otio.tracks.name = nome;
  const destino = path.join(caminhoTimeline(id), 'premiere');
  fs.mkdirSync(destino, { recursive: true });
  const trocados = corrigirExtensoes(otio, path.join(destino, 'midia'));
  const arq = path.join(destino, `${nome.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.otio`);
  fs.writeFileSync(arq, JSON.stringify(otio, null, 1));
  return { args: { otio: arq, largura, altura, nome, pastas: [caminhoAssets(id), path.join(destino, 'midia')] }, trocados };
}

// ---------- instalação do painel ----------

// Copia a extensão para a pasta de extensões CEP do usuário, com a porta e o token. O Premiere carrega extensões sem
// assinatura porque o PlayerDebugMode do CSXS está ligado; se não estiver, avisa.
export function instalarPainelPremiere(origem) {
  const destino = path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions', 'com.movai.premiere');
  fs.rmSync(destino, { recursive: true, force: true });
  fs.cpSync(origem, destino, { recursive: true });
  fs.writeFileSync(path.join(destino, 'config.js'), `window.MOVAI_CONFIG = ${JSON.stringify({ porta: PORTA_PREMIERE, token: tokenPremiere() })};\n`);
  return { instalado: true, pasta: destino, depuracao: modoDepuracaoCep() };
}

// PlayerDebugMode = 1 em alguma versão do CSXS (as do Premiere 2022 em diante vão de 11 a 15).
function modoDepuracaoCep() {
  try {
    const { execFileSync } = require('node:child_process');
    const saida = execFileSync('reg', ['query', String.raw`HKCU\Software\Adobe`, '/s', '/f', 'PlayerDebugMode'], { encoding: 'utf8', windowsHide: true });
    return /CSXS\.1[1-9][\s\S]*?PlayerDebugMode\s+REG_SZ\s+1/.test(saida);
  } catch {
    return false;
  }
}
