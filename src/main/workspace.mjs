import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { carregar } from './settings.mjs';
import { rodar, rodarOuFalhar } from './proc.mjs';
import { todosEstilos, FORMATOS } from './presets.mjs';
import { infoVideo, transcodificar } from './transcodificar.mjs';
import { recurso, temRecurso } from './recursos.mjs';
import { criarTimeline } from './timeline.mjs';

const HYPERFRAMES_VERSAO = '0.8.217';

const PACOTE_WORKSPACE = {
  name: 'claude-video-studio-workspace',
  private: true,
  type: 'module',
  dependencies: {
    remotion: '4.0.539',
    '@remotion/cli': '4.0.539',
    '@remotion/google-fonts': '4.0.539',
    '@remotion/media-utils': '4.0.539',
    '@remotion/player': '4.0.539',
    '@remotion/transitions': '4.0.539',
    react: '^19.3.1',
    'react-dom': '^19.3.1',
    hyperframes: HYPERFRAMES_VERSAO,
  },
};

const CLAUDE_MD = `# Claude Video Studio — workspace

Cada vídeo fica em \`projetos/<id>/\`:

- \`projeto.json\` — dados do projeto (gerado pelo app, não edite)
- \`BRIEFING.md\` — materiais, narração transcrita e estilo pedido
- \`transcricao.json\` — narração com tempos por segmento e por palavra (segundos)
- \`assets/\` — todos os materiais e a narração
- \`renders/\` — vídeos exportados pelo app

Projetos Remotion têm o código em \`projetos/<id>/src/\`; projetos HyperFrames têm \`index.html\` e \`compositions/\` na raiz do projeto.
As dependências (remotion, @remotion/*, react, hyperframes) já estão instaladas em \`node_modules\` deste workspace — nunca rode npm install dentro de um projeto.
`;

export function dirs() {
  const ws = carregar().workspaceDir;
  return { ws, projetos: path.join(ws, 'projetos') };
}

export function workspacePronto() {
  const { ws } = dirs();
  return (
    fs.existsSync(path.join(ws, 'node_modules', '@remotion', 'cli')) &&
    fs.existsSync(path.join(ws, 'node_modules', '@remotion', 'player')) &&
    fs.existsSync(path.join(ws, 'node_modules', 'hyperframes'))
  );
}

export async function prepararWorkspace(onLinha) {
  const { ws, projetos } = dirs();
  fs.mkdirSync(projetos, { recursive: true });
  fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify(PACOTE_WORKSPACE, null, 2));
  fs.writeFileSync(path.join(ws, 'CLAUDE.md'), CLAUDE_MD);
  fs.writeFileSync(
    path.join(ws, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: false,
          skipLibCheck: true,
          noEmit: true,
        },
      },
      null,
      2,
    ),
  );
  copiarSkills(onLinha);
  if (temRecurso('engines', 'node_modules')) {
    // Instalador completo: as engines (com o Chrome do Remotion) já vêm prontas, sem internet nem npm.
    onLinha?.('Copiando Remotion e HyperFrames (só na primeira vez, leva um ou dois minutos)…');
    await fs.promises.cp(recurso('engines', 'node_modules'), path.join(ws, 'node_modules'), { recursive: true, force: true });
    copiarChromeHyperframes(onLinha);
  } else {
    onLinha?.('Instalando Remotion e HyperFrames (só na primeira vez, pode levar alguns minutos)…');
    await rodarOuFalhar('npm', ['install', '--no-fund', '--no-audit'], { cwd: ws, onLinha, shell: true });
  }
  onLinha?.('Workspace pronto.');
}

// O HyperFrames procura o Chrome dele em ~/.cache/hyperframes/chrome e baixa se não achar.
function copiarChromeHyperframes(onLinha) {
  const destino = path.join(os.homedir(), '.cache', 'hyperframes', 'chrome');
  if (!temRecurso('chrome-hyperframes') || fs.existsSync(destino)) return;
  fs.cpSync(recurso('chrome-hyperframes'), destino, { recursive: true });
  onLinha?.('Chrome do HyperFrames copiado.');
}

function copiarSkills(onLinha) {
  const origem = carregar().skillsOrigem;
  const destino = path.join(dirs().ws, '.claude', 'skills');
  if (!origem || !fs.existsSync(origem)) {
    onLinha?.(`Pasta de skills não encontrada (${origem}); seguindo sem as skills.`);
    return;
  }
  fs.mkdirSync(destino, { recursive: true });
  for (const nome of fs.readdirSync(origem)) {
    fs.cpSync(path.join(origem, nome), path.join(destino, nome), { recursive: true, force: true });
  }
  onLinha?.('Skills de edição copiadas para o workspace.');
}

export function hyperframesBin() {
  const pasta = path.join(dirs().ws, 'node_modules', 'hyperframes');
  const pkg = JSON.parse(fs.readFileSync(path.join(pasta, 'package.json'), 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.hyperframes ?? Object.values(pkg.bin)[0];
  return path.join(pasta, bin);
}

// ---------- mídia ----------

const EXT = {
  video: ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'],
  imagem: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
};

export function tipoDe(arquivo) {
  const ext = path.extname(arquivo).toLowerCase();
  return Object.keys(EXT).find((t) => EXT[t].includes(ext)) ?? 'outro';
}

function ffprobePath() {
  const ff = carregar().ffmpegPath;
  return ff === 'ffmpeg' ? 'ffprobe' : path.join(path.dirname(ff), 'ffprobe.exe');
}

async function sondarCompleto(arquivo) {
  let saida = '';
  await rodar(
    ffprobePath(),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo],
    { onLinha: (l) => (saida += l + '\n') },
  );
  try {
    const j = JSON.parse(saida);
    const v = j.streams?.find((s) => s.codec_type === 'video');
    return {
      duracao: j.format?.duration ? Number(Number(j.format.duration).toFixed(2)) : null,
      largura: v?.width ?? null,
      altura: v?.height ?? null,
      temAudio: !!j.streams?.find((s) => s.codec_type === 'audio'),
    };
  } catch {
    return { duracao: null, largura: null, altura: null, temAudio: false };
  }
}

function nomeSeguro(nome, usados) {
  const ext = path.extname(nome).toLowerCase();
  let base = path
    .basename(nome, path.extname(nome))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'arquivo';
  let final = base + ext;
  let i = 2;
  while (usados.has(final)) final = `${base}-${i++}${ext}`;
  usados.add(final);
  return final;
}

// Hard link quando está no mesmo disco (instantâneo, sem ocupar espaço); senão copia.
function trazerArquivo(origem, destino) {
  try {
    fs.linkSync(origem, destino);
  } catch {
    fs.copyFileSync(origem, destino);
  }
}

// ---------- projetos ----------

// AAAAMMDDhhmmss no horário local.
export function carimbo(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

export function caminhoProjeto(id) {
  return path.join(dirs().projetos, id);
}

export function lerProjeto(id) {
  return JSON.parse(fs.readFileSync(path.join(caminhoProjeto(id), 'projeto.json'), 'utf8'));
}

export function gravarProjeto(p) {
  fs.writeFileSync(path.join(caminhoProjeto(p.id), 'projeto.json'), JSON.stringify(p, null, 2));
  return p;
}

export function listarProjetos() {
  const { projetos } = dirs();
  if (!fs.existsSync(projetos)) return [];
  return fs
    .readdirSync(projetos)
    .filter((id) => fs.existsSync(path.join(projetos, id, 'projeto.json')))
    .map((id) => {
      try {
        return lerProjeto(id);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

// Copia um arquivo para assets/. H.265 não decodifica de forma confiável no Chrome dos renders: entra já em H.264.
// "convertidos" guarda as conversões de um lote: o mesmo material não é convertido uma vez por vídeo.
export async function importarMaterial(origem, assets, usados, onLinha, convertidos) {
  const tipo = tipoDe(origem);
  if (tipo === 'outro') return null;
  if (convertidos?.has(origem)) {
    const arquivo = nomeSeguro(path.basename(origem, path.extname(origem)) + '.mp4', usados);
    trazerArquivo(convertidos.get(origem), path.join(assets, arquivo));
    return { arquivo, original: origem, tipo, convertidoDe: 'hevc', ...(await sondarCompleto(path.join(assets, arquivo))) };
  }
  if (tipo === 'video' && (await infoVideo(origem)).codec === 'hevc') {
    const arquivo = nomeSeguro(path.basename(origem, path.extname(origem)) + '.mp4', usados);
    convertidos?.set(origem, path.join(assets, arquivo));
    onLinha?.(`Convertendo ${path.basename(origem)} de H.265 para H.264…`);
    await transcodificar(origem, { formato: 'mp4', modo: carregar().renderModo, saida: path.join(assets, arquivo) }, (p) =>
      onLinha?.(`Convertendo ${path.basename(origem)}… ${Math.round(p * 100)}%`),
    );
    return { arquivo, original: origem, tipo, convertidoDe: 'hevc', ...(await sondarCompleto(path.join(assets, arquivo))) };
  }
  const arquivo = nomeSeguro(path.basename(origem), usados);
  onLinha?.(`Importando ${path.basename(origem)}…`);
  trazerArquivo(origem, path.join(assets, arquivo));
  return { arquivo, original: origem, tipo, ...(await sondarCompleto(origem)) };
}

// ---------- narrações ----------

const ordemNatural = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

function audiosDaPasta(pasta) {
  return fs
    .readdirSync(pasta, { withFileTypes: true })
    .filter((d) => d.isFile() && tipoDe(d.name) === 'audio')
    .map((d) => d.name)
    .sort(ordemNatural)
    .map((n) => path.join(pasta, n));
}

// Cada pasta com áudios é uma narração, e os áudios dela são um roteiro só. Pasta sem áudios direto,
// mas com subpastas, vale uma narração por subpasta. Um arquivo de áudio solto é uma narração.
export async function resolverNarracoes(caminhos) {
  const brutas = [];
  for (const c of caminhos) {
    if (!fs.statSync(c).isDirectory()) {
      if (tipoDe(c) === 'audio') brutas.push({ nome: path.basename(c, path.extname(c)), arquivos: [c] });
      continue;
    }
    const diretos = audiosDaPasta(c);
    if (diretos.length) {
      brutas.push({ nome: path.basename(c), arquivos: diretos });
      continue;
    }
    const subpastas = fs.readdirSync(c, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(ordemNatural);
    for (const sub of subpastas) {
      const arquivos = audiosDaPasta(path.join(c, sub));
      if (arquivos.length) brutas.push({ nome: sub, arquivos });
    }
  }
  return Promise.all(
    brutas.map(async (n) => {
      const infos = await Promise.all(n.arquivos.map(sondarCompleto));
      return { ...n, duracao: infos.reduce((t, i) => t + (i.duracao ?? 0), 0) };
    }),
  );
}

// Uma narração em vários áudios vira um arquivo só, na ordem dada, para a transcrição e os cortes seguirem um único tempo.
async function unirAudios(arquivos, saida) {
  const entradas = arquivos.flatMap((a) => ['-i', a]);
  const normalizados = arquivos.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(';');
  const juntar = arquivos.map((_, i) => `[a${i}]`).join('') + `concat=n=${arquivos.length}:v=0:a=1[saida]`;
  await rodarOuFalhar(carregar().ffmpegPath, [
    '-y', ...entradas, '-filter_complex', `${normalizados};${juntar}`, '-map', '[saida]', '-c:a', 'pcm_s16le', saida,
  ]);
}

export async function criarProjeto({ nome, materiais, narracao, duracaoMotion, estiloId, estiloTexto, engine, formato, lote, convertidos }, onLinha) {
  const agora = new Date();
  const slug = (nome || 'video')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'video';
  // Vídeos de um lote nascem no mesmo segundo e podem ter pastas de mesmo nome.
  let id = `${carimbo(agora)}-${slug}`;
  for (let n = 2; fs.existsSync(caminhoProjeto(id)); n++) id = `${carimbo(agora)}-${slug}-${n}`;
  const dir = caminhoProjeto(id);
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(path.join(dir, 'renders'), { recursive: true });

  const usados = new Set();
  const itens = [];
  for (const origem of materiais) {
    const m = await importarMaterial(origem, assets, usados, onLinha, convertidos);
    if (m) itens.push(m);
  }

  let narr = null;
  if (narracao?.length) {
    onLinha?.('Importando narração…');
    const varios = narracao.length > 1;
    const arquivo = nomeSeguro('narracao' + (varios ? '.wav' : path.extname(narracao[0])), usados);
    const destino = path.join(assets, arquivo);
    if (varios) await unirAudios(narracao, destino);
    else trazerArquivo(narracao[0], destino);
    narr = { arquivo, original: narracao[0], partes: narracao, ...(await sondarCompleto(destino)) };
  }

  const estilos = todosEstilos();
  const estilo = estilos.find((e) => e.id === estiloId) ?? estilos.at(-1);
  const projeto = {
    id,
    nome: nome || 'Vídeo sem nome',
    criadoEm: agora.toISOString(),
    engine,
    formato,
    ...FORMATOS[formato],
    fps: 30,
    // Projetos Remotion são editáveis na timeline; o HyperFrames segue pelo chat.
    timeline: engine === 'remotion',
    estiloId: estilo.id,
    estiloNome: estilo.nome,
    estiloTexto: estiloTexto ?? '',
    materiais: itens,
    narracao: narr,
    duracaoMotion: duracaoMotion ?? null,
    lote: lote ?? null,
    sessionId: null,
    renders: [],
    chat: [],
  };
  gravarProjeto(projeto);
  scaffold(projeto);
  return projeto;
}

function duracaoAlvo(p) {
  if (p.duracaoMotion) return p.duracaoMotion;
  if (p.narracao?.duracao) return p.narracao.duracao;
  const soma = p.materiais.reduce((s, m) => s + (m.tipo === 'video' ? m.duracao ?? 0 : m.tipo === 'imagem' ? 3 : 0), 0);
  return Math.max(5, Math.round(soma));
}

// Ponto de partida que já renderiza; o Claude refaz.
function scaffold(p) {
  const dir = caminhoProjeto(p.id);
  const dur = duracaoAlvo(p);
  if (p.engine === 'remotion') {
    criarTimeline(p);
  } else {
    const resolucao = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' }[p.formato];
    fs.mkdirSync(path.join(dir, 'compositions'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'hyperframes.json'),
      JSON.stringify(
        {
          $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
          registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
          paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
          media: { autoProxy: true },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({ id: p.id, name: p.nome, createdAt: p.criadoEm }, null, 2),
    );
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      `<!doctype html>
<html lang="pt-BR"${resolucao ? ` data-resolution="${resolucao}"` : ''}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${p.largura}, height=${p.altura}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${p.largura}px; height: ${p.altura}px; overflow: hidden; background: #000; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${dur}"
      data-width="${p.largura}" data-height="${p.altura}"></div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`,
    );
  }
}

// ---------- briefing ----------

const fmt = (s) => (s == null ? '?' : `${Number(s).toFixed(2)}s`);

export function escreverBriefing(p, transcricao) {
  const estilo = todosEstilos().find((e) => e.id === p.estiloId);
  const linhas = [
    `# Briefing — ${p.nome}`,
    '',
    `- Engine: **${p.engine === 'remotion' ? 'Remotion' : 'HyperFrames'}**`,
    `- Formato: ${p.formato} (${p.largura}x${p.altura}), ${p.fps} fps`,
    `- Duração alvo: ${fmt(duracaoAlvo(p))}${p.narracao ? ' (duração da narração)' : ''}`,
    '',
    '## Estilo',
    '',
    `**${estilo?.nome ?? p.estiloNome}**`,
    '',
    estilo?.instrucoes || '',
    p.estiloTexto ? `\n${p.duracaoMotion ? 'O que o usuário quer no vídeo' : 'Pedido do usuário sobre o estilo'}:\n\n> ${p.estiloTexto.replace(/\n/g, '\n> ')}` : '',
    '',
    '## Materiais (em assets/)',
    '',
    '| arquivo | tipo | duração | resolução | áudio |',
    '|---|---|---|---|---|',
    ...p.materiais.map(
      (m) =>
        `| ${m.arquivo} | ${m.tipo} | ${m.tipo === 'imagem' ? '-' : fmt(m.duracao)} | ${m.largura ? `${m.largura}x${m.altura}` : '-'} | ${m.temAudio ? 'sim' : 'não'} |`,
    ),
    '',
  ];
  if (p.duracaoMotion) {
    linhas.push(
      '## Só motion',
      '',
      `Este vídeo não tem materiais, narração nem áudio. Crie tudo em animação, seguindo o pedido do usuário, com exatamente ${fmt(p.duracaoMotion)} de duração.`,
      p.timeline ? 'Na timeline, use a trilha de gráficos com textos e blocos: é o último item que define a duração do vídeo.' : '',
      '',
    );
  } else if (p.narracao) {
    linhas.push(
      '## Narração',
      '',
      `Arquivo: \`${p.narracao.arquivo}\` (${fmt(p.narracao.duracao)})`,
      ...(p.narracao.partes?.length > 1 ? [`É um único roteiro, unido a partir de ${p.narracao.partes.length} áudios.`] : []),
      '',
    );
    if (transcricao?.segmentos?.length) {
      linhas.push(
        'Transcrição por frase (os tempos por palavra estão em `transcricao.json`):',
        '',
        ...transcricao.segmentos.map((s) => `- [${fmt(s.inicio)} → ${fmt(s.fim)}] ${s.texto}`),
        '',
      );
    } else {
      linhas.push('(Sem transcrição disponível.)', '');
    }
  } else {
    linhas.push('## Narração', '', 'Sem narração. Use o áudio original dos vídeos ou monte o ritmo pelos cortes.', '');
  }
  fs.writeFileSync(path.join(caminhoProjeto(p.id), 'BRIEFING.md'), linhas.join('\n'));
}
