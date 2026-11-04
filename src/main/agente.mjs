import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { carregar } from './settings.mjs';
import { dirs, lerProjeto, gravarProjeto, hyperframesBin } from './workspace.mjs';
import { renderizar } from './render.mjs';
import { folhaDeQuadros, folhaDeMateriais, folhaDeReferencia, resumoTimeline, editarTimeline, resumirErro } from './ferramentas.mjs';
const imagem = (arquivo) => ({ type: 'image', data: fs.readFileSync(arquivo).toString('base64'), mimeType: 'image/jpeg' });
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
Você está dentro do Editor Jaborizador da Silva, um app de edição automática de vídeo. Você é o editor: monta, ajusta e exporta o vídeo do usuário.

PROJETO ATUAL: ${rel}/  (trabalhe somente dentro desta pasta)
- ${rel}/BRIEFING.md — materiais, narração transcrita com tempos e o estilo pedido. Leia primeiro.
- ${rel}/transcricao.json — tempos por palavra, para legendas sincronizadas.
- ${rel}/projeto.json — gerado pelo app; não edite.

${regrasEngine(p)}

FERRAMENTAS DO APP:
- mcp__studio__renderizar — exporta o vídeo (o app escolhe GPU/CPU e MP4/MOV conforme o usuário).
- mcp__studio__ver_quadros — devolve uma imagem com os momentos pedidos, em segundos, para conferir legenda, enquadramento e cortes.
- mcp__studio__ver_materiais — devolve uma imagem com os materiais numerados e a lista deles.
${p.referencias?.length ? '- mcp__studio__ver_referencia — estuda o material de referência que o usuário enviou: quadros com o segundo, duração e instantes dos cortes. Chame uma vez antes de montar (de novo só com momentos específicos) e reproduza a linguagem de edição dela (ritmo, legendas, transições, cores, efeitos), nunca o conteúdo. Ao salvar o estilo, inclua na receita o que aprendeu da referência.\n' : ''}
${p.timeline ? '- mcp__studio__resumo_timeline — a timeline sem as palavras das legendas; com ids, os itens completos.\n- mcp__studio__editar_timeline — altera, adiciona ou remove itens pelo id.\n' : ''}${p.timeline ? '- mcp__studio__gerar_legendas — cria a trilha de legendas a partir da transcrição, seguindo os pedaços de narração que estão na timeline.\n' : ''}- mcp__studio__salvar_estilo — guarda o estilo deste vídeo como preset reutilizável no app. Use quando o usuário pedir para salvar o estilo. Escreva as instruções como receita completa e concreta (fontes, tamanhos, posições, cores em hex, ritmo de cortes, transições, efeitos), para outro vídeo sair igual sem ver este código.

ECONOMIA (cada imagem e cada arquivo lido é reenviado em todos os turnos; siga sempre):
- Conversão de vídeo (codec, formato, compressão) não é com você: o app converte os materiais na importação e tem um conversor próprio. Nunca rode ffmpeg nem HandBrake; se um material não abrir, avise o usuário.
- Veja os clipes com mcp__studio__ver_materiais, nunca extraindo quadros com ffmpeg nem lendo imagens soltas. Só peça clipes específicos para decidir um corte difícil.
- PARE ANTES DE CONFERIR: o usuário confere e renderiza sozinho, para poupar créditos. Não use mcp__studio__ver_quadros nem mcp__studio__renderizar por conta própria; só use se o usuário pedir explicitamente. Ao terminar a montagem, avise que está pronta para conferência.
- RITMO: cada cena/clipe fica de 1 a 2 segundos na tela, para o vídeo não ficar acelerado nem poluído. Nunca deixe cenas com menos de 1 s nem passe de 2 s sem pedido do usuário.
- Nunca renderize pelo CLI nem por Bash, e nunca rode nada em segundo plano. Se o render falhar, descubra a causa e mude algo antes de chamar de novo; não repita a mesma chamada. Se a chamada vier interrompida, avise o usuário em vez de insistir.
- Depois da primeira montagem, use mcp__studio__resumo_timeline e mcp__studio__editar_timeline. Não leia nem reescreva timeline.json inteiro.
- O briefing já traz a transcrição: não leia transcricao.json. Faça várias alterações de uma vez e leia um arquivo só uma vez.

COMO TRABALHAR:
- Responda sempre em português do Brasil, curto e direto: o usuário vê suas mensagens num chat ao lado do player.
- Na primeira montagem: leia o briefing, monte o vídeo completo (cenas de 1 a 2 s) e pare: não confira com ver_quadros nem renderize, o usuário faz isso.
${p.timeline ? '- Em pedidos de alteração: altere só o que foi pedido na timeline e diga em uma ou duas frases o que mudou. A prévia ao vivo do app já mostra a mudança; só renderize quando o usuário pedir.\n- Mensagens podem trazer [Timeline: …] com a posição do cursor e o item selecionado: é a isso que o usuário se refere com "aqui" ou "esse".' : '- Em pedidos de alteração: altere só o que foi pedido, sem renderizar nem conferir (o usuário faz isso), e diga em uma ou duas frases o que mudou.'}
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
  if (nome === 'mcp__studio__ver_materiais') return 'Vendo os materiais';
  if (nome === 'mcp__studio__ver_referencia') return 'Estudando o material de referência';
  if (nome === 'mcp__studio__resumo_timeline') return 'Lendo a timeline';
  if (nome === 'mcp__studio__editar_timeline') return 'Editando a timeline';
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
          resolucao: z.number().int().min(360).max(4320).optional().describe('Lado menor do quadro em pixels (720, 1080, 1440, 2160). Só passe se o usuário pediu; por padrão vale a escolha dele no app.'),
          qualidade: z.enum(['alta', 'media', 'baixa']).optional().describe('Só passe se o usuário pediu.'),
        },
        async (args) => {
          try {
            const r = await renderizar(id, args, (e) => onEvento({ tipo: 'render', ...e }), controle.signal);
            onEvento({ tipo: 'render', concluido: r.preview ?? r.arquivo });
            const texto = r.reaproveitado ? `Nada mudou desde o último render; o arquivo continua valendo: ${r.arquivo}` : `Render concluído em ${r.segundos}s: ${r.arquivo}`;
            return { content: [{ type: 'text', text: texto }] };
          } catch (e) {
            onEvento({ tipo: 'render', falhou: String(e.message).split('\n')[0] });
            return { content: [{ type: 'text', text: `O render falhou:\n${resumirErro(e.message)}` }], isError: true };
          }
        },
      ),
      tool(
        'ver_quadros',
        'Devolve uma imagem com os momentos pedidos, em ordem de tempo. Em projetos com timeline não precisa de render. Até 2 momentos vêm maiores, para ver detalhes.',
        { segundos: z.array(z.number().min(0)).min(1).max(8) },
        async ({ segundos }) => {
          try {
            return { content: [imagem(await folhaDeQuadros(id, segundos))] };
          } catch (e) {
            return { content: [{ type: 'text', text: resumirErro(e.message) }], isError: true };
          }
        },
      ),
      tool(
        'ver_materiais',
        'Devolve uma imagem com os vídeos e fotos do projeto numerados e a lista deles (até 30 por página). Com arquivos, mostra três momentos de cada clipe pedido.',
        { arquivos: z.array(z.string()).max(8).optional(), pagina: z.number().int().min(1).optional() },
        async (args) => {
          try {
            const { saida, texto } = await folhaDeMateriais(id, args);
            return { content: [imagem(saida), { type: 'text', text: texto }] };
          } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
          }
        },
      ),
      tool(
        'ver_referencia',
        'Estuda o material de referência do projeto: devolve uma imagem com quadros rotulados com o segundo e os dados medidos (duração, resolução, quantos cortes e em que instantes). Sem argumentos, mostra a primeira referência com quadros espaçados; com momentos (em segundos), mostra esses instantes.',
        { arquivo: z.string().optional(), momentos: z.array(z.number().min(0)).max(12).optional() },
        async (args) => {
          try {
            const { saida, texto } = await folhaDeReferencia(id, args);
            return { content: [imagem(saida), { type: 'text', text: texto }] };
          } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
          }
        },
      ),
      tool(
        'resumo_timeline',
        'A timeline compacta, uma linha por item, sem as palavras das legendas. Com ids, devolve esses itens completos.',
        { ids: z.array(z.string()).max(20).optional() },
        async (args) => {
          try {
            return { content: [{ type: 'text', text: resumoTimeline(id, args) }] };
          } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
          }
        },
      ),
      tool(
        'editar_timeline',
        'Grava alterações na timeline sem reescrever o arquivo. Operações: {op:"alterar",id,campos} (campo null apaga), {op:"adicionar",trilha,item}, {op:"remover",id}, {op:"transicoes",trilha,lista}.',
        { operacoes: z.array(z.record(z.string(), z.any())).min(1) },
        async ({ operacoes }) => {
          try {
            return { content: [{ type: 'text', text: editarTimeline(id, operacoes) }] };
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

  const env = {
    ...process.env,
    // Tarefa em segundo plano acorda o Claude depois que a sessão encerrou, e aí as ferramentas do app são
    // interrompidas em 0 s; foi isso que fez o render ser repetido várias vezes seguidas.
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    // Um render passa bem de minutos, e o padrão não pode cortá-lo no meio.
    MCP_TOOL_TIMEOUT: String(3 * 60 * 60 * 1000),
    // Resume a conversa antes: cada turno reenvia tudo, inclusive as imagens já vistas.
    CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '45',
  };
  if (s.apiKey) env.ANTHROPIC_API_KEY = s.apiKey;

  // O render pelo CLI passa por fora da fila, do cache e da lista do app.
  const negar = (motivo) => ({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motivo },
  });
  const barrarRenderPorFora = async (entrada) => {
    const comando = String(entrada.tool_input?.command ?? '');
    if (/remotion[^\n]*\brender\b|hyperframes[^\n]*\brender\b/i.test(comando)) {
      return negar('Use mcp__studio__renderizar: render por Bash não entra na fila nem na lista do app. Para conferir, use mcp__studio__ver_quadros.');
    }
    // A conversão de materiais é do conversor do app (ffmpeg direto, sem gastar tokens): o Claude não converte por conta própria.
    if (/(^|[\s;&|"'\\/])ffmpeg(\.exe)?(\s|"|'|$)|\bHandBrakeCLI\b/i.test(comando)) {
      return negar('Não converta nem processe vídeos com ffmpeg: o app já converte os materiais na importação (H.265 vira H.264) e tem o conversor próprio. Se um material não abre, diga isso ao usuário em vez de convertê-lo.');
    }
    return {};
  };

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
        hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [barrarRenderPorFora] }] },
        permissionMode: 'dontAsk',
        allowedTools: [
          'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Skill',
          'mcp__studio__renderizar', 'mcp__studio__ver_quadros', 'mcp__studio__ver_materiais', 'mcp__studio__ver_referencia', 'mcp__studio__resumo_timeline', 'mcp__studio__editar_timeline', 'mcp__studio__gerar_legendas', 'mcp__studio__salvar_estilo',
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
  let m = `Leia projetos/${p.id}/BRIEFING.md e monte o vídeo completo no estilo pedido, com cenas de 1 a 2 segundos cada. Não confira com mcp__studio__ver_quadros nem renderize: eu faço isso. Me diga em poucas linhas o que montou.`;
  if (p.lote) m += ` Este é o vídeo ${p.lote.indice} de ${p.lote.total} de um lote: mesmos materiais, cada vídeo com sua narração.`;
  if (referencia) m += ` Para o lote ter a mesma identidade, leia antes (só leitura) projetos/${referencia}/src/blocos.tsx e o estilo de alguns itens de projetos/${referencia}/timeline.json com Grep, e siga o mesmo visual, adaptando os cortes e a escolha das cenas a esta narração.`;
  if (salvarEstilo) m += ' No final, salve o estilo com mcp__studio__salvar_estilo, com um nome curto que o descreva.';
  return m;
}
