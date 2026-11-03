import path from 'node:path';
import { createRequire } from 'node:module';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { carregar } from './settings.mjs';
import { dirs, lerProjeto, gravarProjeto, hyperframesBin } from './workspace.mjs';
import { renderizar, extrairQuadros } from './render.mjs';
import { salvarEstilo } from './presets.mjs';
import { gerarLegendas } from './timeline.mjs';

const require = createRequire(import.meta.url);

// O SDK traz o Claude Code (claude.exe). Empacotado, ele fica fora do asar.
export function claudeExe() {
  try {
    const pkg = require.resolve('@anthropic-ai/claude-agent-sdk-win32-x64/package.json');
    return path.join(path.dirname(pkg), 'claude.exe').replace('app.asar', 'app.asar.unpacked');
  } catch {
    return undefined;
  }
}

function regrasEngine(p) {
  const rel = `projetos/${p.id}`;
  if (p.timeline) {
    return `ENGINE: Remotion com TIMELINE. O vídeo é o arquivo ${rel}/timeline.json: o usuário edita o mesmo arquivo numa timeline visual no app e vê a prévia ao vivo. Monte e altere o vídeo editando esse JSON; não crie outra composição.

Formato (tempos em segundos): { largura, altura, fps, fundo, trilhas: [{ id, tipo, nome, itens: [...] }] }. As trilhas são camadas: as últimas ficam por cima. Não mude largura, altura nem fps sem o usuário pedir. Itens de uma trilha podem se sobrepor (o último fica por cima), o que serve para transições.
Tipos de trilha e o que aceitam: video (video, imagem) | sobreposicao (video, imagem, texto, bloco) | legenda (legenda) | audio (audio).
Todo item tem: id único, tipo, inicio, duracao.
- video: arquivo, corteInicio (segundo do arquivo onde começa), velocidade, volume (0 a 1; use 0 quando houver narração), ajuste (cover|contain).
- imagem: arquivo, ajuste, largura (px; sem ela ocupa o quadro).
- audio: arquivo, corteInicio, velocidade, volume, fadeIn, fadeOut.
- texto: texto, estilo. legenda: texto, palavras [{texto, inicio, fim}] (tempos relativos ao início da legenda), estilo.
- bloco: componente, props. Para o que os outros tipos não fazem (selo animado, light leak, gráfico): escreva o componente React em ${rel}/src/blocos.tsx e registre em "blocos". Só blocos.tsx é seu; os outros arquivos de src/ são do app.
Itens visuais também aceitam: x, y (deslocamento em px a partir do centro), escala, rotacao, opacidade, zoom {de, para} (zoom contínuo), entrada e saida {tipo: fade|slide-cima|slide-baixo|slide-esq|slide-dir|zoom|pop, duracao}.
- keyframes: { "<parâmetro>": [{ t, v, curva }] } anima x, y, escala, rotacao, opacidade e os números de efeitos (ex.: "efeitos.desfoque.raio", "efeitos.cor.exposicao"). t é em segundos desde o início do item; curva: linear|hold|bezier|easeIn|easeOut, e vale para o trecho que sai do keyframe. Com keyframes o valor fixo do parâmetro é ignorado. Prefira keyframes a zoom/entrada/saida quando precisar de movimento preciso.
- mesclagem: normal|multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity.
- efeitos: { cor: {exposicao (-5 a 5), contraste (-100 a 100), saturacao (0 a 200, normal 100), temperatura (-100 a 100), matiz (-100 a 100)}, desfoque: {raio}, corte: {esquerda, cima, direita, baixo} (em %), vinheta: {quantidade} (-100 a 100; negativo escurece), pb: true, inverter: true, espelhoH: true, espelhoV: true }.
- transicoes fica na trilha (video ou sobreposicao), não no item: [{ id, tipo, duracao, alinhamento: centro|inicio|fim, de, para, direcao: esq|dir|cima|baixo }]. "de" é o id do item que sai e "para" o do que entra; os dois precisam se encostar. Sem um deles, a transição só abre ou só fecha. Tipos desenhados na prévia e no render: cross_dissolve, dip_to_black, dip_to_white, flash, push, whip, slide, linear_wipe, iris_round, cross_zoom. Centralizada, ela usa duracao/2 a mais de arquivo nos dois clipes: deixe essa sobra (corteInicio de quem entra e o que resta do arquivo de quem sai), senão o corte fica seco.
- filmcraft em um item ou transição guarda dados que só existem no Filmcraft: não edite nem apague.
estilo: fonte (Montserrat|Inter|Poppins|Roboto|Anton|Bebas Neue|Oswald|Playfair Display), tamanho, peso, cor, corDestaque (cor da palavra falada na legenda), contorno, contornoLargura, sombra, fundo, alinhamento, maiusculas, entrelinha.
- arquivo é só o nome dentro de assets/. Se uma skill pedir para escrever código Remotion, aplique o visual dela por aqui, com blocos para o que for específico.
- Para as legendas use mcp__studio__gerar_legendas, não escreva palavra por palavra. Depois de cortar ou mover a narração, gere de novo.`;
  }
  if (p.engine === 'remotion') {
    return `ENGINE: Remotion 4 (React + TypeScript).
- O código fica em ${rel}/src/. Root.tsx registra a <Composition id="Main"> com width=${p.largura}, height=${p.altura}, fps=${p.fps}. Ajuste durationInFrames à duração final.
- Os materiais são servidos pela pasta ${rel}/assets: use staticFile('<arquivo>') (só o nome do arquivo).
- Vídeos com <OffthreadVideo>, imagens com <Img>, áudio com <Audio>. Fontes com @remotion/google-fonts. Transições com @remotion/transitions.
- Pacotes disponíveis: remotion, @remotion/google-fonts, @remotion/media-utils, @remotion/transitions, react. Não instale nada.
- Para checar se compila sem renderizar, rode: node node_modules/@remotion/cli/remotion-cli.js compositions ${rel}/src/index.ts`;
  }
  const bin = path.relative(dirs().ws, hyperframesBin()).replace(/\\/g, '/');
  return `ENGINE: HyperFrames (HTML + CSS + GSAP renderizado em vídeo).
- Leia a skill "hyperframes" antes de escrever. O projeto já está criado em ${rel}/ (index.html, hyperframes.json, meta.json, compositions/).
- Os materiais estão em ${rel}/assets/ — referencie como "assets/<arquivo>".
- Tamanho ${p.largura}x${p.altura}, ${p.fps} fps. Ajuste data-duration da composição raiz à duração final.
- Para validar sem renderizar: node ${bin} check ${rel}`;
}

function promptSistema(p) {
  const rel = `projetos/${p.id}`;
  return `
Você está dentro do Claude Video Studio, um app de edição automática de vídeo. Você é o editor: monta, ajusta e exporta o vídeo do usuário.

PROJETO ATUAL: ${rel}/  (trabalhe somente dentro desta pasta)
- ${rel}/BRIEFING.md — materiais, narração transcrita com tempos e o estilo pedido. Leia primeiro.
- ${rel}/transcricao.json — tempos por palavra, para legendas sincronizadas.
- ${rel}/projeto.json — gerado pelo app; não edite.

${regrasEngine(p)}

FERRAMENTAS DO APP:
- mcp__studio__renderizar — exporta o vídeo (o app escolhe GPU/CPU e MP4/MOV conforme o usuário). Chame ao terminar a montagem e sempre que o usuário pedir render. Se falhar, leia o erro, corrija e chame de novo.
- mcp__studio__ver_quadros — extrai quadros do último render em segundos escolhidos; depois leia os PNGs com Read para conferir legenda, enquadramento e cortes.
${p.timeline ? '- mcp__studio__gerar_legendas — cria a trilha de legendas a partir da transcrição, seguindo os pedaços de narração que estão na timeline.\n' : ''}- mcp__studio__salvar_estilo — guarda o estilo deste vídeo como preset reutilizável no app. Use quando o usuário pedir para salvar o estilo. Escreva as instruções como receita completa e concreta (fontes, tamanhos, posições, cores em hex, ritmo de cortes, transições, efeitos), para outro vídeo sair igual sem ver este código.

COMO TRABALHAR:
- Responda sempre em português do Brasil, curto e direto: o usuário vê suas mensagens num chat ao lado do player.
- Na primeira montagem: leia o briefing, monte o vídeo completo, renderize, confira 3–4 quadros e corrija o que estiver errado antes de encerrar.
${p.timeline ? '- Em pedidos de alteração: altere só o que foi pedido na timeline e diga em uma ou duas frases o que mudou. A prévia ao vivo do app já mostra a mudança; só renderize quando o usuário pedir, ou para conferir quadros.\n- Mensagens podem trazer [Timeline: …] com a posição do cursor e o item selecionado: é a isso que o usuário se refere com "aqui" ou "esse".' : '- Em pedidos de alteração: altere só o que foi pedido, renderize de novo e diga em uma ou duas frases o que mudou.'}
`.trim();
}

const emExecucao = new Map(); // id -> AbortController

export function cancelar(id) {
  emExecucao.get(id)?.abort();
}

export function ocupado(id) {
  return emExecucao.has(id);
}

function resumoFerramenta(nome, input = {}) {
  const arq = input.file_path || input.path || input.pattern;
  const curto = (s) => (s && s.length > 90 ? s.slice(0, 87) + '…' : s);
  if (nome === 'Write') return `Escrevendo ${path.basename(arq ?? '')}`;
  if (nome === 'Edit') return `Editando ${path.basename(arq ?? '')}`;
  if (nome === 'Read') return `Lendo ${path.basename(arq ?? '')}`;
  if (nome === 'Bash') return `Executando: ${curto(input.command)}`;
  if (nome === 'Glob' || nome === 'Grep') return `Procurando ${curto(arq)}`;
  if (nome === 'Skill') return `Usando a skill ${input.skill ?? ''}`;
  if (nome === 'mcp__studio__renderizar') return 'Renderizando o vídeo';
  if (nome === 'mcp__studio__ver_quadros') return 'Conferindo quadros do vídeo';
  if (nome === 'mcp__studio__gerar_legendas') return 'Gerando as legendas';
  if (nome === 'mcp__studio__salvar_estilo') return `Salvando o estilo "${input.nome ?? ''}"`;
  return nome;
}

// Roda um turno do Claude no projeto. onEvento recebe:
// {tipo:'texto', texto} | {tipo:'acao', texto} | {tipo:'render', ...} | {tipo:'fim', custo} | {tipo:'erro', texto}
export async function conversar(id, mensagem, onEvento) {
  if (emExecucao.has(id)) throw new Error('O Claude ainda está trabalhando neste projeto.');
  const s = carregar();
  const projeto = lerProjeto(id);
  const controle = new AbortController();
  emExecucao.set(id, controle);

  const studio = createSdkMcpServer({
    name: 'studio',
    version: '1.0.0',
    tools: [
      tool(
        'renderizar',
        'Exporta o vídeo do projeto atual e mostra no player do app. Retorna o caminho do arquivo ou o erro do render.',
        {
          modo: z.enum(['gpu', 'cpu']).optional().describe('Só passe se o usuário pediu explicitamente GPU ou CPU.'),
          formato: z.enum(['mp4', 'mov']).optional().describe('Só passe se o usuário pediu explicitamente MP4 ou MOV.'),
        },
        async (args) => {
          try {
            const r = await renderizar(id, args, (e) => onEvento({ tipo: 'render', ...e }), controle.signal);
            onEvento({ tipo: 'render', concluido: r.preview ?? r.arquivo });
            return { content: [{ type: 'text', text: `Render concluído em ${r.segundos}s: ${r.arquivo}` }] };
          } catch (e) {
            onEvento({ tipo: 'render', falhou: String(e.message).split('\n')[0] });
            return { content: [{ type: 'text', text: `O render falhou:\n${e.message}` }], isError: true };
          }
        },
      ),
      tool(
        'ver_quadros',
        'Extrai quadros (PNG) do último render nos segundos pedidos e devolve os caminhos para ler com Read.',
        { segundos: z.array(z.number().min(0)).min(1).max(8) },
        async ({ segundos }) => {
          try {
            const arquivos = await extrairQuadros(id, segundos);
            return { content: [{ type: 'text', text: arquivos.join('\n') || 'Nenhum quadro extraído.' }] };
          } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
          }
        },
      ),
      tool(
        'gerar_legendas',
        'Cria a trilha de legendas da timeline a partir da transcrição, com os tempos de cada palavra. Substitui as legendas atuais.',
        {
          maxPalavras: z.number().int().min(1).max(12).optional().describe('Palavras por legenda. Padrão 4.'),
          maxCaracteres: z.number().int().min(5).max(80).optional().describe('Caracteres por legenda. Padrão 26.'),
          estilo: z.record(z.string(), z.any()).optional().describe('O "estilo" da legenda (fonte, tamanho, cor, corDestaque…).'),
          x: z.number().optional(),
          y: z.number().optional().describe('Deslocamento vertical em px a partir do centro.'),
        },
        async (args) => {
          try {
            return { content: [{ type: 'text', text: `${gerarLegendas(id, args)} legendas criadas.` }] };
          } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
          }
        },
      ),
      tool(
        'salvar_estilo',
        'Salva o estilo de edição como preset do app, para o usuário escolher em vídeos futuros.',
        {
          nome: z.string().min(2).max(60),
          descricao: z.string().max(160).describe('Uma frase curta para o card do estilo.'),
          instrucoes: z.string().min(40).describe('Receita completa e concreta do estilo.'),
          engine: z.enum(['remotion', 'hyperframes']),
          formato: z.enum(['9:16', '16:9', '1:1', '4:5']),
        },
        async (args) => {
          const e = salvarEstilo(args);
          onEvento({ tipo: 'estilo', nome: e.nome });
          return { content: [{ type: 'text', text: `Estilo "${e.nome}" salvo.` }] };
        },
      ),
    ],
  });

  const env = { ...process.env };
  if (s.apiKey) env.ANTHROPIC_API_KEY = s.apiKey;

  try {
    const q = query({
      prompt: mensagem,
      options: {
        cwd: dirs().ws,
        model: s.modeloClaude,
        resume: projeto.sessionId ?? undefined,
        abortController: controle,
        pathToClaudeCodeExecutable: claudeExe(),
        env,
        settingSources: ['user', 'project'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: promptSistema(projeto) },
        mcpServers: { studio },
        permissionMode: 'dontAsk',
        allowedTools: [
          'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Skill',
          'mcp__studio__renderizar', 'mcp__studio__ver_quadros', 'mcp__studio__gerar_legendas', 'mcp__studio__salvar_estilo',
        ],
        stderr: (d) => onEvento({ tipo: 'log', texto: d }),
      },
    });

    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        guardarSessao(id, msg.session_id);
      } else if (msg.type === 'assistant') {
        for (const bloco of msg.message.content) {
          if (bloco.type === 'text' && bloco.text.trim()) onEvento({ tipo: 'texto', texto: bloco.text });
          else if (bloco.type === 'tool_use') onEvento({ tipo: 'acao', texto: resumoFerramenta(bloco.name, bloco.input) });
        }
      } else if (msg.type === 'result') {
        guardarSessao(id, msg.session_id);
        if (msg.subtype === 'success') onEvento({ tipo: 'fim', custo: msg.total_cost_usd });
        else onEvento({ tipo: 'erro', texto: `O Claude parou: ${msg.subtype}` });
      }
    }
  } catch (e) {
    if (controle.signal.aborted) onEvento({ tipo: 'erro', texto: 'Cancelado.' });
    else onEvento({ tipo: 'erro', texto: e.message });
  } finally {
    emExecucao.delete(id);
  }
}

function guardarSessao(id, sessionId) {
  if (!sessionId) return;
  const p = lerProjeto(id);
  if (p.sessionId !== sessionId) {
    p.sessionId = sessionId;
    gravarProjeto(p);
  }
}

export function primeiraMensagem(p, salvarEstilo, referencia) {
  let m = `Leia projetos/${p.id}/BRIEFING.md e monte o vídeo completo no estilo pedido. Depois renderize com mcp__studio__renderizar, confira alguns quadros e me diga em poucas linhas o que montou.`;
  if (p.lote) m += ` Este é o vídeo ${p.lote.indice} de ${p.lote.total} de um lote: mesmos materiais, cada vídeo com sua narração.`;
  if (referencia) m += ` Para o lote ter a mesma identidade, leia antes (só leitura) projetos/${referencia}/timeline.json e projetos/${referencia}/src/ e siga o mesmo visual, adaptando os cortes e a escolha das cenas a esta narração.`;
  if (salvarEstilo) m += ' No final, salve o estilo com mcp__studio__salvar_estilo, com um nome curto que o descreva.';
  return m;
}
