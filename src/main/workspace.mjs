import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { carregar } from './settings.mjs';
import { rodar, rodarOuFalhar } from './proc.mjs';
import { todosEstilos, FORMATOS } from './presets.mjs';
import { recurso, temRecurso } from './recursos.mjs';
import { criarTimeline } from './timeline.mjs';
import { slug } from './migracao.mjs';
import { tamanhoVisivel } from './otio.mjs';
import { lerRoteiro } from './roteiro.mjs';
import { trechoDoRoteiro } from './conferir-nucleo.mjs';

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

Cada projeto fica em \`projetos/<id>/\`, com um único conjunto de materiais e uma ou mais timelines:

- \`projeto.json\` — dados do projeto e das timelines (gerado pelo app, não edite)
- \`assets/\` — todos os materiais e as narrações, compartilhados entre as timelines
- \`referencia/\`, \`instrucoes/\` — material de referência e áudios de instrução
- \`roteiro/\` — roteiros enviados pelo usuário, em texto: base das legendas e da ordem das cenas
- \`.cache/\` — miniaturas e cópias leves, refeitas quando faltam
- \`timelines/<timeline>/\` — uma timeline:
  - \`timeline.json\` — o vídeo (só em projetos Remotion)
  - \`BRIEFING.md\` — materiais, narração transcrita e estilo pedido
  - \`transcricao.json\` — narração com tempos por segmento e por palavra (segundos)
  - \`renders/\` — vídeos exportados pelo app

Timelines Remotion têm o código em \`timelines/<timeline>/src/\`; as HyperFrames têm \`index.html\` e \`compositions/\` na pasta da timeline.
Nunca apague nem sobrescreva arquivos de \`assets/\`: outras timelines podem usá-los.
As dependências (remotion, @remotion/*, react, hyperframes) já estão instaladas em \`node_modules\` deste workspace — nunca rode npm install dentro de um projeto.
`;

// Só atualiza o texto do workspace que já existe; as dependências ficam como estão.
export function atualizarDocumentacao() {
  const arq = path.join(dirs().ws, 'CLAUDE.md');
  if (fs.existsSync(arq) && fs.readFileSync(arq, 'utf8') !== CLAUDE_MD) fs.writeFileSync(arq, CLAUDE_MD);
}

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

// Troca pastas pelos materiais que há dentro delas, subpastas incluídas, em ordem de nome.
// pasta é o caminho a partir da pasta escolhida, com o nome dela ("Feed/15.10"); arquivo solto fica com "".
export function listarMateriais(caminhos) {
  const achados = new Map();
  const visitar = (c, pasta) => {
    let info;
    try {
      info = fs.statSync(c);
    } catch {
      return;
    }
    if (info.isFile()) {
      if (tipoDe(c) !== 'outro' && !achados.has(c)) achados.set(c, pasta);
      return;
    }
    if (!info.isDirectory()) return;
    let nomes;
    try {
      nomes = fs.readdirSync(c);
    } catch {
      return;
    }
    nomes
      .filter((n) => !n.startsWith('.'))
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }))
      .forEach((n) => visitar(path.join(c, n), pasta ? `${pasta}/${path.basename(c)}` : path.basename(c)));
  };
  caminhos.forEach((c) => visitar(c, ''));
  return [...achados].map(([caminho, pasta]) => ({ caminho, pasta }));
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
      largura: tamanhoVisivel(v).largura,
      altura: tamanhoVisivel(v).altura,
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
// No mesmo disco é um link, na hora. Em outro disco é cópia de verdade: vídeo 4K leva segundos ou minutos,
// e copiar de forma síncrona deixaria o app inteiro em "Não respondendo". O nome final só existe com o arquivo completo.
async function trazerArquivo(origem, destino) {
  try {
    fs.linkSync(origem, destino);
  } catch {
    const parcial = destino + '.parcial';
    try {
      await fs.promises.copyFile(origem, parcial);
      await fs.promises.rename(parcial, destino);
    } catch (e) {
      await fs.promises.rm(parcial, { force: true });
      throw e;
    }
  }
}

// ---------- projetos ----------

// AAAAMMDDhhmmss no horário local.
export function carimbo(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

// Um projeto é uma pasta com um conjunto de materiais e várias timelines. O id que circula pelo app é o da timeline,
// "<projeto>/<timeline>"; lerProjeto devolve a timeline já com os dados do projeto, e gravarProjeto separa de volta.
const separar = (id) => {
  const [projeto, timeline] = String(id).split('/');
  if (!projeto || !timeline) throw new Error(`Timeline inválida: ${id}`);
  return { projeto, timeline };
};

export const caminhoProjeto = (id) => path.join(dirs().projetos, separar(id).projeto);
export const caminhoAssets = (id) => path.join(caminhoProjeto(id), 'assets');
export const caminhoCache = (id) => path.join(caminhoProjeto(id), '.cache');
export const caminhoTimeline = (id) => path.join(caminhoProjeto(id), 'timelines', separar(id).timeline);
// A partir do workspace, com barras normais, para os prompts do Claude e os CLIs.
export const relAssets = (id) => `projetos/${separar(id).projeto}/assets`;
export const relTimeline = (id) => `projetos/${separar(id).projeto}/timelines/${separar(id).timeline}`;

const arquivoDoProjeto = (projetoId) => path.join(dirs().projetos, projetoId, 'projeto.json');
const lerDoDisco = (projetoId) => JSON.parse(fs.readFileSync(arquivoDoProjeto(projetoId), 'utf8'));

// Um arquivo só guarda todas as timelines do projeto: gravar pela metade não pode perder as outras.
function gravarNoDisco(projeto) {
  const destino = arquivoDoProjeto(projeto.id);
  const parcial = destino + '.tmp';
  const texto = JSON.stringify(projeto, null, 2);
  fs.writeFileSync(parcial, texto);
  try {
    fs.renameSync(parcial, destino);
  } catch {
    // Antivírus ou indexador segurando o arquivo por um instante.
    fs.writeFileSync(destino, texto);
    fs.rmSync(parcial, { force: true });
  }
}

const COMPARTILHADOS = ['materiais', 'referencias', 'audiosInstrucao', 'roteiros'];

function vista(projeto, ordem) {
  const t = projeto.timelines[ordem];
  return {
    ...t,
    id: `${projeto.id}/${t.id}`,
    timelineId: t.id,
    projetoId: projeto.id,
    projetoCriadoEm: projeto.criadoEm,
    ordem,
    // O nome completo vai para o arquivo exportado e o título; dentro do projeto, as abas mostram o rótulo.
    nome: projeto.timelines.length > 1 ? `${projeto.nome} — ${t.rotulo}` : projeto.nome,
    grupo: { id: projeto.id, nome: projeto.nome },
    narracoes: projeto.timelines.map((x) => x.narracao).filter(Boolean),
    ...Object.fromEntries(COMPARTILHADOS.map((c) => [c, projeto[c] ?? []])),
  };
}

export function lerProjeto(id) {
  const { projeto: projetoId, timeline } = separar(id);
  const projeto = lerDoDisco(projetoId);
  const ordem = projeto.timelines.findIndex((t) => t.id === timeline);
  if (ordem < 0) throw new Error(`A timeline "${timeline}" não existe mais neste projeto.`);
  return vista(projeto, ordem);
}

export function gravarProjeto(p) {
  const { id: _id, timelineId, projetoId, projetoCriadoEm: _c, ordem: _o, nome: _n, grupo: _g, narracoes: _nn, ...resto } = p;
  const projeto = lerDoDisco(projetoId);
  for (const c of COMPARTILHADOS) {
    if (resto[c]) projeto[c] = resto[c];
    delete resto[c];
  }
  const n = projeto.timelines.findIndex((t) => t.id === timelineId);
  if (n < 0) throw new Error(`A timeline "${timelineId}" não existe mais neste projeto.`);
  projeto.timelines[n] = { id: timelineId, ...resto };
  gravarNoDisco(projeto);
  return p;
}

// Uma entrada por timeline, do projeto mais novo para o mais antigo.
export function listarProjetos() {
  const { projetos } = dirs();
  if (!fs.existsSync(projetos)) return [];
  return fs
    .readdirSync(projetos)
    .filter((id) => !id.startsWith('.') && fs.existsSync(arquivoDoProjeto(id)))
    .flatMap((id) => {
      try {
        const projeto = lerDoDisco(id);
        return Array.isArray(projeto.timelines) ? projeto.timelines.map((_, n) => vista(projeto, n)) : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.projetoCriadoEm.localeCompare(a.projetoCriadoEm) || a.ordem - b.ordem);
}

// Copia um arquivo para assets/ como está.
export async function importarMaterial(origem, assets, usados, onLinha) {
  const tipo = tipoDe(origem);
  if (tipo === 'outro') return null;
  // Não converte mais na importação (H.265, ProRes…): o arquivo entra como está e a cópia leve da prévia é feita depois,
  // em segundo plano. O render do Remotion lê H.265 direto (OffthreadVideo usa ffmpeg).
  const arquivo = nomeSeguro(path.basename(origem), usados);
  onLinha?.(`Importando ${path.basename(origem)}…`);
  await trazerArquivo(origem, path.join(assets, arquivo));
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
export async function unirAudios(arquivos, saida) {
  const entradas = arquivos.flatMap((a) => ['-i', a]);
  const normalizados = arquivos.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(';');
  const juntar = arquivos.map((_, i) => `[a${i}]`).join('') + `concat=n=${arquivos.length}:v=0:a=1[saida]`;
  await rodarOuFalhar(carregar().ffmpegPath, [
    '-y', ...entradas, '-filter_complex', `${normalizados};${juntar}`, '-map', '[saida]', '-c:a', 'pcm_s16le', saida,
  ]);
}

// Cria a pasta do projeto com os materiais. As timelines entram depois, com novaTimeline, usando estes mesmos arquivos.
// ---------- roteiro ----------
// Do projeto todo: um PDF com os roteiros de vários áudios serve, porque cada áudio é alinhado com o trecho dele.
// Guardado como texto em roteiro/, fora de assets/: não é material do vídeo.

async function guardarRoteiro(origem, pasta, usados) {
  const texto = await lerRoteiro(origem);
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = nomeSeguro(`${path.parse(origem).name}.txt`, usados);
  fs.writeFileSync(path.join(pasta, arquivo), texto);
  return { arquivo, original: origem, nome: path.basename(origem), palavras: texto.split(/\s+/).length };
}

export async function adicionarRoteiros(id, caminhos) {
  const pasta = path.join(caminhoProjeto(id), 'roteiro');
  const inicial = lerProjeto(id).roteiros;
  const usados = new Set(inicial.map((r) => r.arquivo));
  const novos = [];
  const erros = [];
  for (const origem of caminhos) {
    if (inicial.some((r) => r.original === origem)) continue;
    try {
      novos.push(await guardarRoteiro(origem, pasta, usados));
    } catch (e) {
      erros.push(`${path.basename(origem)}: ${e.message.split('\n')[0]}`);
    }
  }
  const atual = lerProjeto(id);
  atual.roteiros = [...atual.roteiros, ...novos];
  gravarProjeto(atual);
  return { roteiros: atual.roteiros, erros };
}

export function removerRoteiro(id, arquivo) {
  const atual = lerProjeto(id);
  if (!atual.roteiros.some((r) => r.arquivo === arquivo)) return atual.roteiros;
  atual.roteiros = atual.roteiros.filter((r) => r.arquivo !== arquivo);
  gravarProjeto(atual);
  // Só o texto extraído: o arquivo original do usuário fica onde está.
  fs.rmSync(path.join(caminhoProjeto(id), 'roteiro', path.basename(arquivo)), { force: true });
  return atual.roteiros;
}

export function textoDosRoteiros(id) {
  return lerProjeto(id).roteiros
    .map((r) => {
      try {
        return fs.readFileSync(path.join(caminhoProjeto(id), 'roteiro', r.arquivo), 'utf8');
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

export async function criarProjeto({ nome, materiais = [], pastas, referencias: refs, audiosInstrucao: audios, roteiros: arquivosRoteiro }, onLinha) {
  const agora = new Date();
  const base = `${carimbo(agora)}-${slug(nome) || 'video'}`;
  const { projetos } = dirs();
  let id = base;
  for (let n = 2; fs.existsSync(path.join(projetos, id)); n++) id = `${base}-${n}`;
  const dir = path.join(projetos, id);
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(path.join(dir, 'timelines'), { recursive: true });

  const usados = new Set();
  const itens = [];
  for (const origem of materiais) {
    const m = await importarMaterial(origem, assets, usados, onLinha);
    if (m) itens.push(pastas?.[origem] ? { ...m, pasta: pastas[origem] } : m);
  }

  // Referências ficam fora de assets/: servem para o Claude estudar o estilo, não entram como material do vídeo.
  const referencias = [];
  if (refs?.length) {
    const pastaRef = path.join(dir, 'referencia');
    fs.mkdirSync(pastaRef, { recursive: true });
    const usadosRef = new Set();
    for (const origem of refs) {
      const tipo = tipoDe(origem);
      if (tipo !== 'video' && tipo !== 'imagem') continue;
      onLinha?.(`Guardando a referência ${path.basename(origem)}…`);
      const arquivo = nomeSeguro(path.basename(origem), usadosRef);
      await trazerArquivo(origem, path.join(pastaRef, arquivo));
      referencias.push({ arquivo, original: origem, tipo, ...(await sondarCompleto(origem)) });
    }
  }

  // Áudios em que o usuário explica o que fazer no vídeo; ficam fora de assets/ e não entram no vídeo.
  const audiosInstrucao = [];
  if (audios?.length) {
    const pastaInstr = path.join(dir, 'instrucoes');
    fs.mkdirSync(pastaInstr, { recursive: true });
    const usadosInstr = new Set();
    for (const origem of audios) {
      onLinha?.(`Guardando o áudio de referência ${path.basename(origem)}…`);
      const arquivo = nomeSeguro(path.basename(origem), usadosInstr);
      await trazerArquivo(origem, path.join(pastaInstr, arquivo));
      audiosInstrucao.push({ arquivo, original: origem });
    }
  }

  const roteiros = [];
  const usadosRoteiro = new Set();
  for (const origem of arquivosRoteiro ?? []) {
    onLinha?.(`Lendo o roteiro ${path.basename(origem)}…`);
    try {
      roteiros.push(await guardarRoteiro(origem, path.join(dir, 'roteiro'), usadosRoteiro));
    } catch (e) {
      onLinha?.(`Não consegui ler o roteiro ${path.basename(origem)}: ${e.message.split('\n')[0]}`);
    }
  }

  gravarNoDisco({
    id,
    nome: nome || 'Vídeo sem nome',
    criadoEm: agora.toISOString(),
    versao: 2,
    materiais: itens,
    referencias,
    audiosInstrucao,
    roteiros,
    timelines: [],
  });
  return id;
}

function pastaNovaDeTimeline(projeto, rotulo) {
  const numeros = projeto.timelines.map((t) => parseInt(t.id, 10)).filter((n) => n > 0);
  const n = Math.max(0, ...numeros) + 1;
  return `${String(n).padStart(2, '0')}-${slug(rotulo, 30) || 'timeline'}`;
}

function registrarTimeline(projeto, entrada) {
  projeto.timelines.push(entrada);
  gravarNoDisco(projeto);
  return vista(projeto, projeto.timelines.length - 1);
}

const proximoRotulo = (projeto) => {
  const nomes = new Set(projeto.timelines.map((t) => t.rotulo));
  let n = projeto.timelines.length + 1;
  while (nomes.has(`Timeline ${n}`)) n++;
  return `Timeline ${n}`;
};

// Uma timeline nova usa os materiais do projeto e só traz o que é dela: a narração.
// Vídeos do projeto com som: quando a narração está no próprio vídeo (pessoa falando para a câmera), cada um vira uma timeline.
export function videosNarrados(projetoId) {
  return lerDoDisco(projetoId).materiais.filter((m) => m.tipo === 'video' && m.temAudio);
}

export async function novaTimeline(projetoId, { rotulo, narracao, narradoPor, duracaoMotion, estiloId, estiloTexto, engine, formato, lote, vazia }, onLinha) {
  const assets = path.join(dirs().projetos, projetoId, 'assets');
  let projeto = lerDoDisco(projetoId);
  const nomeRotulo = rotulo || proximoRotulo(projeto);
  const timelineId = pastaNovaDeTimeline(projeto, nomeRotulo);
  const dir = path.join(dirs().projetos, projetoId, 'timelines', timelineId);
  fs.mkdirSync(path.join(dir, 'renders'), { recursive: true });

  let narr = null;
  if (narracao?.length) {
    onLinha?.('Importando narração…');
    const varios = narracao.length > 1;
    const usados = new Set(fs.readdirSync(assets));
    const arquivo = nomeSeguro(`narracao-${nomeRotulo}` + (varios ? '.wav' : path.extname(narracao[0])), usados);
    const destino = path.join(assets, arquivo);
    if (varios) await unirAudios(narracao, destino);
    else await trazerArquivo(narracao[0], destino);
    narr = { arquivo, original: narracao[0], partes: narracao, ...(await sondarCompleto(destino)) };
  }

  const estilos = todosEstilos();
  const estilo = estilos.find((e) => e.id === estiloId) ?? estilos.at(-1);
  // Lido de novo: importar a narração leva tempo, e outra timeline pode ter gravado o projeto nesse meio-tempo.
  projeto = lerDoDisco(projetoId);
  const view = registrarTimeline(projeto, {
    id: timelineId,
    rotulo: nomeRotulo,
    criadoEm: new Date().toISOString(),
    engine,
    formato,
    ...FORMATOS[formato],
    fps: 30,
    // Timelines Remotion são editáveis na timeline; o HyperFrames segue pelo chat.
    timeline: engine === 'remotion',
    estiloId: estilo.id,
    estiloNome: estilo.nome,
    estiloTexto: estiloTexto ?? '',
    narracao: narr,
    narradoPor: narradoPor ?? null,
    duracaoMotion: duracaoMotion ?? null,
    lote: lote ?? null,
    sessionId: null,
    renders: [],
    chat: [],
  });
  scaffold(view, { vazia });
  return view;
}

// Nova timeline a partir da aba do editor: em branco, nos mesmos formato e estilo da que está aberta.
export async function timelineEmBranco(id) {
  const atual = lerProjeto(id);
  const view = await novaTimeline(atual.projetoId, {
    estiloId: atual.estiloId,
    estiloTexto: atual.estiloTexto,
    engine: atual.engine,
    formato: atual.formato,
    vazia: true,
  });
  escreverBriefing(view, null);
  return view;
}

// Cópia editável da montagem: só os dados da timeline, nunca os materiais. Conversa e renders começam do zero.
export function duplicarTimeline(id) {
  const atual = lerProjeto(id);
  const projeto = lerDoDisco(atual.projetoId);
  const rotulo = `${atual.rotulo} (cópia)`;
  const timelineId = pastaNovaDeTimeline(projeto, rotulo);
  const origem = caminhoTimeline(id);
  const destino = path.join(dirs().projetos, atual.projetoId, 'timelines', timelineId);
  const deFora = new Set(['renders', '.previa', 'filmcraft', 'assets']);
  fs.mkdirSync(path.join(destino, 'renders'), { recursive: true });
  for (const nome of fs.readdirSync(origem)) {
    if (!deFora.has(nome)) fs.cpSync(path.join(origem, nome), path.join(destino, nome), { recursive: true });
  }
  if (atual.engine !== 'remotion') ligarAssets(destino, atual.projetoId);
  const { id: _i, timelineId: _t, projetoId: _p, projetoCriadoEm: _c, ordem: _o, nome: _n, grupo: _g, narracoes: _nn, materiais: _m, referencias: _r, audiosInstrucao: _a, filmcraft: _f, migradoDe: _d, ...resto } = atual;
  return registrarTimeline(projeto, { ...resto, id: timelineId, rotulo, criadoEm: new Date().toISOString(), lote: null, sessionId: null, renders: [], chat: [] });
}

export function renomearTimeline(id, rotulo) {
  const limpo = String(rotulo ?? '').trim().slice(0, 80);
  if (!limpo) throw new Error('O nome da timeline não pode ficar vazio.');
  gravarProjeto({ ...lerProjeto(id), rotulo: limpo });
}

// O nome do projeto fica no projeto.json: a pasta (id) não muda, então nada que aponta para ela quebra.
export function renomearProjeto(id, nome) {
  const limpo = String(nome ?? '').trim().slice(0, 80);
  if (!limpo) throw new Error('O nome do projeto não pode ficar vazio.');
  const projeto = lerDoDisco(lerProjeto(id).projetoId);
  projeto.nome = limpo;
  gravarNoDisco(projeto);
}

// Apaga só o que é da timeline (montagem e renders). Os materiais ficam: são do projeto.
export function excluirTimeline(id) {
  const atual = lerProjeto(id);
  const projeto = lerDoDisco(atual.projetoId);
  if (projeto.timelines.length < 2) throw new Error('O projeto precisa de pelo menos uma timeline.');
  fs.rmSync(caminhoTimeline(id), { recursive: true, force: true });
  projeto.timelines = projeto.timelines.filter((t) => t.id !== atual.timelineId);
  gravarNoDisco(projeto);
}

// O HyperFrames lê "assets/…" a partir da pasta do vídeo: uma junção leva à pasta do projeto, sem copiar nada.
function ligarAssets(dir, projetoId) {
  fs.symlinkSync(path.join(dirs().projetos, projetoId, 'assets'), path.join(dir, 'assets'), 'junction');
}

function duracaoAlvo(p) {
  if (p.duracaoMotion) return p.duracaoMotion;
  if (p.narracao?.duracao) return p.narracao.duracao;
  const baseNarrada = p.narradoPor && p.materiais.find((m) => m.arquivo === p.narradoPor);
  if (baseNarrada?.duracao) return baseNarrada.duracao;
  const soma = p.materiais.reduce((s, m) => s + (m.tipo === 'video' ? m.duracao ?? 0 : m.tipo === 'imagem' ? 3 : 0), 0);
  return Math.max(5, Math.round(soma));
}

// Ponto de partida que já renderiza; o Claude refaz.
function scaffold(p, { vazia } = {}) {
  const dir = caminhoTimeline(p.id);
  const dur = duracaoAlvo(p);
  if (p.engine === 'remotion') {
    criarTimeline(p, { vazia });
  } else {
    ligarAssets(dir, p.projetoId);
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

// Com narração transcrita, só o trecho do roteiro que ela fala: o roteiro inteiro gastaria tokens à toa em todo turno.
function secaoRoteiro(p, transcricao) {
  const roteiro = textoDosRoteiros(p.id);
  if (!roteiro) return [];
  const ouvido = transcricao?.segmentos?.map((s) => s.texto).join(' ');
  const trecho = ouvido ? trechoDoRoteiro(ouvido, roteiro) : null;
  return [
    '## Roteiro',
    '',
    'O usuário enviou o roteiro: é a base do vídeo. A sequência das cenas segue a ordem dele, e cada cena mostra o que está sendo dito naquele momento. Onde a transcrição e o roteiro divergem na grafia (nomes, marcas, preços), vale o roteiro.',
    '',
    trecho ? '> ' + trecho : '> ' + roteiro.replace(/\n/g, '\n> '),
    '',
  ];
}

export function escreverBriefing(p, transcricao, instrucoes = []) {
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
    ...(instrucoes.length
      ? [
          '## Instruções do usuário por áudio',
          '',
          'O usuário gravou um áudio explicando o que fazer neste vídeo. A transcrição abaixo é o pedido dele: siga-a, com prioridade sobre o texto do estilo quando houver conflito.',
          '',
          ...instrucoes.map((i) => (i.texto ? `> ${i.texto.replace(/\n/g, '\n> ')}\n` : `(Não foi possível transcrever ${i.arquivo}: o Whisper não está disponível ou falhou. Avise o usuário.)\n`)),
        ]
      : []),
    ...secaoRoteiro(p, transcricao),
    ...(p.referencias?.length
      ? [
          '## Material de referência',
          '',
          'O usuário enviou material de referência: faça este vídeo de forma parecida com ele. Onde a referência define algo (ritmo e duração dos cortes, tipo e posição das legendas, fontes, cores, transições, efeitos, zoom, enquadramento, abertura e fechamento), a referência vale mais que as instruções do estilo; no que ela não define, siga o estilo. Não copie o conteúdo dela (cenas, falas, marcas), só a linguagem de edição.',
          'Estude com mcp__studio__ver_referencia (uma imagem com quadros, a duração e os instantes dos cortes, sem gastar leituras de arquivo). Não leia os arquivos de referencia/ direto.',
          '',
          '| arquivo | tipo | duração | resolução | áudio |',
          '|---|---|---|---|---|',
          ...p.referencias.map((r) => `| ${r.arquivo} | ${r.tipo} | ${r.tipo === 'imagem' ? '-' : fmt(r.duracao)} | ${r.largura ? `${r.largura}x${r.altura}` : '-'} | ${r.temAudio ? 'sim' : 'não'} |`),
          '',
        ]
      : []),
    `## Materiais (em ${relAssets(p.id)}/, compartilhados com as outras timelines do projeto)`,
    '',
    '| arquivo | pasta | tipo | duração | resolução | áudio |',
    '|---|---|---|---|---|---|',
    ...p.materiais.map(
      (m) =>
        `| ${m.arquivo} | ${m.pasta || '-'} | ${m.tipo} | ${m.tipo === 'imagem' ? '-' : fmt(m.duracao)} | ${m.largura ? `${m.largura}x${m.altura}` : '-'} | ${m.temAudio ? 'sim' : 'não'} |`,
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
  } else if (p.narradoPor) {
    const base = p.materiais.find((m) => m.arquivo === p.narradoPor);
    linhas.push(
      '## Narração no próprio vídeo',
      '',
      'A fala está no áudio do vídeo `' + p.narradoPor + '` (' + fmt(base?.duracao) + '), em geral uma pessoa falando para a câmera. Não há áudio de narração separado.',
      'Regras: esse vídeo é a base da timeline e mantém o som (volume 1). Corte-o só em pausas ou erros, sem cortar no meio de uma palavra, e mantenha a imagem e o áudio juntos. Os outros materiais entram por cima como cobertura (b-roll) em trilhas de vídeo com volume 0, sem esconder a pessoa nos momentos importantes. Gere as legendas com mcp__studio__gerar_legendas: elas seguem a fala do vídeo.',
      '',
    );
    if (transcricao?.segmentos?.length) {
      linhas.push(
        'Transcrição da fala por frase (os tempos por palavra estão em `transcricao.json`; são os tempos do arquivo do vídeo):',
        '',
        ...transcricao.segmentos.map((s) => `- [${fmt(s.inicio)} → ${fmt(s.fim)}] ${s.texto}`),
        '',
      );
    } else {
      linhas.push('(Sem transcrição disponível.)', '');
    }
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
  fs.writeFileSync(path.join(caminhoTimeline(p.id), 'BRIEFING.md'), linhas.join('\n'));
}
