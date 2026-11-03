import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';
import { dirs, caminhoProjeto, lerProjeto, gravarProjeto, importarMaterial, listarMateriais } from './workspace.mjs';
import { infoVideo } from './transcodificar.mjs';
import { FORMATOS } from './presets.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const MODELO = ['index.ts', 'Root.tsx', 'TimelineVideo.tsx', 'blocos.tsx', 'previa.tsx'];

const TIPOS_POR_TRILHA = {
  video: ['video', 'imagem'],
  sobreposicao: ['video', 'imagem', 'texto', 'bloco'],
  legenda: ['legenda'],
  audio: ['audio'],
};

export const CURVAS = ['linear', 'hold', 'bezier', 'easeIn', 'easeOut'];
export const MESCLAGENS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

let contador = 0;
export const novoId = (prefixo = 'i') => `${prefixo}${Date.now().toString(36)}${(contador++).toString(36)}`;

const arquivoTimeline = (id) => path.join(caminhoProjeto(id), 'timeline.json');

export function lerTimeline(id) {
  return JSON.parse(fs.readFileSync(arquivoTimeline(id), 'utf8'));
}

// Confere a timeline antes de gravar ou renderizar. Devolve a lista de problemas (vazia = ok).
export function validarTimeline(id, t) {
  const erros = [];
  if (!t || !Array.isArray(t.trilhas)) return ['timeline.json precisa ter "trilhas" (lista).'];
  for (const c of ['largura', 'altura', 'fps']) if (!(t[c] > 0)) erros.push(`"${c}" inválido.`);
  const assets = path.join(caminhoProjeto(id), 'assets');
  const vistos = new Set();
  for (const tr of t.trilhas) {
    const aceitos = TIPOS_POR_TRILHA[tr.tipo];
    if (!aceitos) {
      erros.push(`Trilha "${tr.id}": tipo "${tr.tipo}" não existe (use ${Object.keys(TIPOS_POR_TRILHA).join(', ')}).`);
      continue;
    }
    if (!Array.isArray(tr.itens)) {
      erros.push(`Trilha "${tr.id}" precisa ter "itens" (lista).`);
      continue;
    }
    for (const i of tr.itens) {
      const nome = `Item "${i.id}" (trilha ${tr.id})`;
      if (!i.id || vistos.has(i.id)) erros.push(`${nome}: "id" ausente ou repetido.`);
      vistos.add(i.id);
      if (!aceitos.includes(i.tipo)) erros.push(`${nome}: tipo "${i.tipo}" não cabe em trilha ${tr.tipo} (aceita ${aceitos.join(', ')}).`);
      if (!(i.inicio >= 0)) erros.push(`${nome}: "inicio" precisa ser >= 0.`);
      if (!(i.duracao > 0)) erros.push(`${nome}: "duracao" precisa ser > 0.`);
      if (['video', 'imagem', 'audio'].includes(i.tipo) && !fs.existsSync(path.join(assets, i.arquivo ?? ''))) {
        erros.push(`${nome}: arquivo "${i.arquivo}" não está em assets/.`);
      }
      if (i.mesclagem && !MESCLAGENS.includes(i.mesclagem)) erros.push(`${nome}: mesclagem "${i.mesclagem}" não existe (use ${MESCLAGENS.join(', ')}).`);
      for (const [param, kfs] of Object.entries(i.keyframes ?? {})) {
        if (!Array.isArray(kfs) || kfs.some((k) => !(k.t >= 0) || typeof k.v !== 'number')) erros.push(`${nome}: keyframes de "${param}" precisam de t >= 0 e v numérico.`);
        else if (kfs.some((k) => k.curva && !CURVAS.includes(k.curva))) erros.push(`${nome}: curva de "${param}" não existe (use ${CURVAS.join(', ')}).`);
      }
    }
    for (const x of tr.transicoes ?? []) {
      const nome = `Transição "${x.id}" (trilha ${tr.id})`;
      if (!['video', 'sobreposicao'].includes(tr.tipo)) erros.push(`${nome}: só trilhas de vídeo e sobreposição têm transição.`);
      if (!x.id || !x.tipo) erros.push(`${nome}: precisa de "id" e "tipo".`);
      if (!(x.duracao > 0)) erros.push(`${nome}: "duracao" precisa ser > 0.`);
      if (!x.de && !x.para) erros.push(`${nome}: precisa de "de" ou "para".`);
      for (const ref of [x.de, x.para]) if (ref && !tr.itens.some((i) => i.id === ref)) erros.push(`${nome}: o item "${ref}" não está nesta trilha.`);
      const a = tr.itens.find((i) => i.id === x.de);
      const b = tr.itens.find((i) => i.id === x.para);
      if (a && b && Math.abs(a.inicio + a.duracao - b.inicio) > 0.05) erros.push(`${nome}: "de" precisa terminar onde "para" começa.`);
    }
  }
  return erros;
}

export function gravarTimeline(id, t) {
  const erros = validarTimeline(id, t);
  if (erros.length) throw new Error(erros.join('\n'));
  fs.writeFileSync(arquivoTimeline(id), JSON.stringify(t, null, 2));
  // O formato pode mudar pela timeline: o projeto acompanha.
  const p = lerProjeto(id);
  if (p.largura !== t.largura || p.altura !== t.altura) {
    p.largura = t.largura;
    p.altura = t.altura;
    p.formato = Object.keys(FORMATOS).find((f) => FORMATOS[f].largura === t.largura && FORMATOS[f].altura === t.altura) ?? p.formato;
    gravarProjeto(p);
  }
}

// Primeira versão: materiais em sequência e narração. O Claude refaz os cortes e põe as legendas.
export function timelineInicial(p) {
  const clipes = [];
  const trilhaMusical = [];
  let t = 0;
  for (const m of p.materiais) {
    if (m.tipo === 'audio') {
      trilhaMusical.push({ id: novoId(), tipo: 'audio', arquivo: m.arquivo, inicio: 0, duracao: m.duracao ?? 10, corteInicio: 0, volume: 0.15 });
    } else {
      const duracao = m.tipo === 'video' ? m.duracao ?? 5 : 3;
      clipes.push({
        id: novoId(), tipo: m.tipo, arquivo: m.arquivo, inicio: t, duracao, ajuste: 'cover',
        ...(m.tipo === 'video' ? { corteInicio: 0, volume: p.narracao ? 0 : 1 } : {}),
      });
      t += duracao;
    }
  }
  const narracao = p.narracao
    ? [{ id: novoId(), tipo: 'audio', arquivo: p.narracao.arquivo, inicio: 0, duracao: p.narracao.duracao ?? 10, corteInicio: 0, volume: 1 }]
    : [];
  return {
    versao: 1,
    largura: p.largura,
    altura: p.altura,
    fps: p.fps,
    fundo: '#000000',
    trilhas: [
      { id: 'video', tipo: 'video', nome: 'Vídeo', itens: clipes },
      { id: 'graficos', tipo: 'sobreposicao', nome: 'Gráficos', itens: [] },
      { id: 'legendas', tipo: 'legenda', nome: 'Legendas', itens: [] },
      { id: 'narracao', tipo: 'audio', nome: 'Narração', itens: narracao },
      { id: 'trilha', tipo: 'audio', nome: 'Trilha', itens: trilhaMusical },
    ],
  };
}

// Copia a composição padrão para o projeto. blocos.tsx é do projeto e nunca é sobrescrito.
// Roda também ao abrir e ao renderizar: projetos antigos recebem a composição nova do app.
export function escreverModelo(p) {
  const src = path.join(caminhoProjeto(p.id), 'src');
  fs.mkdirSync(src, { recursive: true });
  for (const nome of MODELO) {
    const destino = path.join(src, nome);
    if (nome === 'blocos.tsx' && fs.existsSync(destino)) continue;
    const modelo = fs.readFileSync(path.join(aqui, 'modelo-timeline', nome));
    // Sem mudança não regrava, senão a prévia seria empacotada de novo a cada abertura.
    if (!fs.existsSync(destino) || !fs.readFileSync(destino).equals(modelo)) fs.writeFileSync(destino, modelo);
  }
}

export function criarTimeline(p) {
  escreverModelo(p);
  fs.writeFileSync(arquivoTimeline(p.id), JSON.stringify(timelineInicial(p), null, 2));
}

// ---------- legendas a partir da transcrição ----------

// Junta palavras em grupos curtos, quebrando em pontuação, em pausas e no limite de tamanho.
function agrupar(palavras, { maxPalavras, maxCaracteres }) {
  const grupos = [];
  let g = [];
  const fechar = () => {
    if (g.length) grupos.push(g);
    g = [];
  };
  for (const p of palavras) {
    const anterior = g.at(-1);
    const tamanho = g.reduce((s, x) => s + x.texto.length + 1, 0) + p.texto.length;
    if (anterior && (p.inicio - anterior.fim > 0.6 || g.length >= maxPalavras || tamanho > maxCaracteres)) fechar();
    g.push(p);
    if (/[.!?;:,]$/.test(p.texto) && g.length > 1) fechar();
  }
  fechar();
  return grupos;
}

// Gera a trilha de legendas seguindo os pedaços de narração que estão na timeline:
// se a narração foi cortada ou movida, as legendas acompanham.
export function gerarLegendas(id, { maxPalavras = 4, maxCaracteres = 26, estilo, x, y } = {}) {
  const projeto = lerProjeto(id);
  const caminho = path.join(caminhoProjeto(id), 'transcricao.json');
  if (!fs.existsSync(caminho)) throw new Error('Este projeto não tem transcrição.');
  if (!projeto.narracao) throw new Error('Este projeto não tem narração.');
  const { palavras } = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  const t = lerTimeline(id);
  const trilha = t.trilhas.find((tr) => tr.tipo === 'legenda');
  if (!trilha) throw new Error('A timeline não tem trilha de legendas.');
  const exemplo = trilha.itens[0];
  const pedacos = t.trilhas
    .filter((tr) => tr.tipo === 'audio')
    .flatMap((tr) => tr.itens)
    .filter((i) => i.arquivo === projeto.narracao.arquivo);

  const itens = [];
  for (const a of pedacos) {
    const corte = a.corteInicio ?? 0;
    const vel = a.velocidade ?? 1;
    const dentro = palavras
      .filter((w) => w.inicio >= corte && w.inicio < corte + a.duracao * vel)
      .map((w) => ({
        texto: w.texto,
        inicio: a.inicio + (w.inicio - corte) / vel,
        fim: Math.min(a.inicio + a.duracao, a.inicio + (w.fim - corte) / vel),
      }));
    for (const g of agrupar(dentro, { maxPalavras, maxCaracteres })) {
      const inicio = g[0].inicio;
      const duracao = Math.max(0.1, g.at(-1).fim - inicio);
      itens.push({
        id: novoId('l'),
        tipo: 'legenda',
        inicio,
        duracao,
        texto: g.map((w) => w.texto).join(' '),
        palavras: g.map((w) => ({ texto: w.texto, inicio: w.inicio - inicio, fim: w.fim - inicio })),
        estilo: estilo ?? exemplo?.estilo ?? { fonte: 'Montserrat', tamanho: Math.round(t.largura * 0.065), peso: 800, cor: '#ffffff', contorno: '#000000', contornoLargura: 6 },
        x: x ?? exemplo?.x ?? 0,
        y: y ?? exemplo?.y ?? Math.round(t.altura * 0.2),
      });
    }
  }
  // Uma legenda não invade a seguinte.
  itens.sort((a, b) => a.inicio - b.inicio);
  itens.forEach((it, n) => {
    const prox = itens[n + 1];
    if (prox && it.inicio + it.duracao > prox.inicio) it.duracao = Math.max(0.05, prox.inicio - it.inicio);
  });
  trilha.itens = itens;
  gravarTimeline(id, t);
  return itens.length;
}

// ---------- prévia ao vivo ----------

function maisRecente(pasta) {
  return fs.readdirSync(pasta, { withFileTypes: true }).reduce((m, d) => {
    const c = path.join(pasta, d.name);
    return Math.max(m, d.isDirectory() ? maisRecente(c) : fs.statSync(c).mtimeMs);
  }, 0);
}

// O player do app (Chromium) não toca ProRes e afins. Esses vídeos ganham uma cópia leve só para a prévia;
// o render continua usando o original. VP9 porque mantém a transparência de selos e overlays.
const CODECS_DO_PLAYER = ['h264', 'vp8', 'vp9', 'av1'];
const caminhoProxy = (id, arquivo) => path.join(caminhoProjeto(id), '.previa', 'proxy', arquivo + '.webm');

async function videosSemSuporte(id) {
  const p = lerProjeto(id);
  const videos = p.materiais.filter((m) => m.tipo === 'video');
  const infos = await Promise.all(videos.map((m) => infoVideo(path.join(caminhoProjeto(id), 'assets', m.arquivo))));
  return videos.filter((_, n) => !CODECS_DO_PLAYER.includes(infos[n].codec)).map((m) => m.arquivo);
}

async function gerarProxy(id, arquivo) {
  const saida = caminhoProxy(id, arquivo);
  if (fs.existsSync(saida)) return saida;
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  const parcial = saida + '.tmp.webm';
  const r = await rodar(carregar().ffmpegPath, [
    '-y', '-i', path.join(caminhoProjeto(id), 'assets', arquivo),
    '-vf', "scale='min(720,iw)':-2", '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
    '-deadline', 'realtime', '-cpu-used', '8', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', parcial,
  ]);
  if (r.codigo !== 0) {
    fs.rmSync(parcial, { force: true });
    throw new Error(r.cauda);
  }
  fs.renameSync(parcial, saida);
  return saida;
}

// Empacota a composição para o player do app. Só refaz quando o código do projeto mudou.
export async function prepararPrevia(id) {
  escreverModelo(lerProjeto(id));
  const dir = caminhoProjeto(id);
  const saida = path.join(dir, '.previa', 'previa.js');
  const src = path.join(dir, 'src');
  if (!fs.existsSync(saida) || fs.statSync(saida).mtimeMs < maisRecente(src)) {
    const ws = dirs().ws;
    let log = '';
    const r = await rodar(
      carregar().nodePath,
      [
        path.join(ws, 'node_modules', 'esbuild', 'bin', 'esbuild'),
        path.join(src, 'previa.tsx'),
        '--bundle', '--format=iife', '--platform=browser', '--target=chrome120', '--jsx=automatic', '--minify',
        '--define:process.env.NODE_ENV="production"',
        '--banner:js=window.process=window.process||{env:{}};',
        `--outfile=${saida}`, '--log-level=error',
      ],
      { cwd: ws, onLinha: (l) => (log += l + '\n') },
    );
    if (r.codigo !== 0) throw new Error(log || r.cauda);
  }
  // null = ainda sem cópia: a prévia mostra um aviso no lugar do vídeo até ela ficar pronta.
  const proxies = {};
  for (const arquivo of await videosSemSuporte(id)) {
    proxies[arquivo] = fs.existsSync(caminhoProxy(id, arquivo)) ? caminhoProxy(id, arquivo) : null;
  }
  return { arquivo: saida, versao: fs.statSync(saida).mtimeMs, assets: path.join(dir, 'assets'), proxies };
}

// ---------- mídia da timeline: miniaturas e forma de onda ----------

const PASSO_MINIATURA = (dur) => Math.max(1, Math.ceil(dur / 150));

// Gera (uma vez) a tira de miniaturas do vídeo ou a forma de onda do áudio.
export async function midiaDoArquivo(id, arquivo) {
  const p = lerProjeto(id);
  const dir = caminhoProjeto(id);
  const entrada = path.join(dir, 'assets', arquivo);
  const pasta = path.join(dir, '.previa', 'midia');
  fs.mkdirSync(pasta, { recursive: true });
  const m = [...p.materiais, ...(p.narracao ? [{ ...p.narracao, tipo: 'audio' }] : [])].find((x) => x.arquivo === arquivo);
  const duracao = m?.duracao ?? 0;
  const ff = carregar().ffmpegPath;
  const base = { arquivo, duracao, tipo: m?.tipo };

  if (m?.tipo === 'video' && duracao > 0) {
    const passo = PASSO_MINIATURA(duracao);
    const quadros = Math.ceil(duracao / passo);
    const altura = 44;
    const larguraQuadro = Math.round(altura * ((m.largura ?? 16) / (m.altura ?? 9)) / 2) * 2;
    const saida = path.join(pasta, `${arquivo}.tira.jpg`);
    // Só keyframes é bem mais rápido, mas falha em vídeos com poucos deles; aí decodifica tudo.
    for (const rapido of [['-skip_frame', 'nokey'], []]) {
      if (fs.existsSync(saida)) break;
      await rodar(ff, [
        '-y', ...rapido, '-i', entrada, '-an',
        '-vf', `fps=1/${passo},scale=${larguraQuadro}:${altura},tile=${quadros}x1`,
        '-frames:v', '1', '-q:v', '6', saida,
      ]);
    }
    const proxy = (await videosSemSuporte(id)).includes(arquivo) ? await gerarProxy(id, arquivo).catch(() => null) : null;
    return fs.existsSync(saida) ? { ...base, proxy, tira: saida, passo, larguraQuadro, altura, quadros } : { ...base, proxy };
  }
  if (m?.tipo === 'audio' && duracao > 0) {
    const saida = path.join(pasta, `${arquivo}.onda.png`);
    if (!fs.existsSync(saida)) {
      const largura = Math.min(8000, Math.max(200, Math.round(duracao * 30)));
      await rodar(ff, [
        '-y', '-i', entrada,
        '-filter_complex', `aformat=channel_layouts=mono,showwavespic=s=${largura}x48:colors=#7fd1b9`,
        '-frames:v', '1', saida,
      ]);
    }
    return fs.existsSync(saida) ? { ...base, onda: saida } : base;
  }
  return base;
}

// Traz arquivos novos para o projeto e devolve os materiais prontos para entrar na timeline.
export async function importarParaProjeto(id, caminhos, onLinha) {
  const p = lerProjeto(id);
  const usados = new Set([...p.materiais.map((m) => m.arquivo), p.narracao?.arquivo].filter(Boolean));
  const novos = [];
  for (const origem of listarMateriais(caminhos)) {
    const m = await importarMaterial(origem, path.join(caminhoProjeto(id), 'assets'), usados, onLinha);
    if (m) novos.push(m);
  }
  p.materiais.push(...novos);
  gravarProjeto(p);
  return novos;
}
