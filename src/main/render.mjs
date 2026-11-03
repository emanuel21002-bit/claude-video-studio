import fs from 'node:fs';
import path from 'node:path';
import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';
import { dirs, caminhoProjeto, hyperframesBin, lerProjeto, gravarProjeto, carimbo, tipoDe } from './workspace.mjs';
import { ENCODERS_GPU, encoderGpu, infoVideo, transcodificar } from './transcodificar.mjs';
import { escreverModelo, lerTimeline, validarTimeline } from './timeline.mjs';

// Progresso vem como "123/900" (frames) ou "45%" nas linhas dos CLIs.
function lerProgresso(linha) {
  const pct = linha.match(/(\d{1,3}(?:\.\d+)?)\s?%/);
  if (pct) return Math.min(100, Number(pct[1])) / 100;
  const fr = linha.match(/\b(\d+)\s?\/\s?(\d+)\b/);
  if (fr && Number(fr[2]) > 1) return Math.min(1, Number(fr[1]) / Number(fr[2]));
  return null;
}

// As saídas dos CLIs vêm coloridas, e o erro vai para o chat.
const semCores = (texto) => texto.replace(/\x1b\[[0-9;]*m/g, '');

async function etapa(nome, cmd, args, { cwd, env, onEvento, sinal, peso = [0, 1] }) {
  onEvento?.({ etapa: nome, progresso: peso[0] });
  const r = await rodar(cmd, args, {
    cwd,
    env,
    sinal,
    onLinha: (l) => {
      onEvento?.({ log: l });
      const p = lerProgresso(l);
      if (p != null) onEvento?.({ etapa: nome, progresso: peso[0] + p * (peso[1] - peso[0]) });
    },
  });
  if (sinal?.aborted) throw new Error('Render cancelado.');
  if (r.codigo !== 0) throw new Error(`${nome} falhou (código ${r.codigo}):\n${semCores(r.cauda)}`);
}

// ---------- pasta pública do render ----------

// Maior escala que o item usa, para a cópia leve não perder nitidez nos zooms.
function escalaMaxima(item) {
  const valores = [item.escala ?? 1, ...(item.keyframes?.escala ?? []).map((k) => k.v)];
  const zoom = Math.max(item.zoom?.de ?? 1, item.zoom?.para ?? 1);
  return Math.max(1, ...valores) * zoom;
}

// Vídeo bem maior que o quadro trava o Chrome na hora de buscar cada quadro (delayRender) e não melhora o resultado.
const CODECS_COM_COPIA = ['h264', 'hevc'];
const PROPORCAO_MINIMA = 0.9;

async function copiaLeve(id, arquivo, t, itens, opts) {
  const dir = caminhoProjeto(id);
  const origem = path.join(dir, 'assets', arquivo);
  const info = await infoVideo(origem);
  if (!info.largura || !CODECS_COM_COPIA.includes(info.codec)) return origem;
  const base = Math.max(t.largura / info.largura, t.altura / info.altura);
  const proporcao = base * Math.max(...itens.map(escalaMaxima));
  if (proporcao >= PROPORCAO_MINIMA) return origem;
  const destino = path.join(dir, '.previa', 'render', `${Math.round(proporcao * 100)}-${arquivo}`);
  if (fs.existsSync(destino) && fs.statSync(destino).mtimeMs >= fs.statSync(origem).mtimeMs) return destino;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const par = (x) => Math.round((x * proporcao) / 2) * 2;
  const encoder = ENCODERS_GPU[await encoderGpu()];
  const parcial = destino + '.tmp.mp4';
  await etapa(opts.nome, carregar().ffmpegPath, [
    '-y', '-hide_banner', '-i', origem, '-map', '0:v:0', '-map', '0:a?', '-vf', `scale=${par(info.largura)}:${par(info.altura)}`,
    ...(encoder ? encoder.args : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17']),
    // Quadro-chave a cada 0,5 s: buscar um quadro no meio do clipe fica bem mais rápido.
    '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', parcial,
  ], opts);
  fs.renameSync(parcial, destino);
  return destino;
}

function ligar(origem, destino) {
  try {
    fs.linkSync(origem, destino);
  } catch {
    fs.copyFileSync(origem, destino);
  }
}

// O Remotion copia a pasta pública inteira a cada render. Em vez de assets/, ele recebe uma pasta só com o que
// o vídeo usa, ligada (sem ocupar disco), com cópias leves no lugar dos clipes grandes.
export async function pastaPublica(id, t, destino, opts = {}) {
  const assets = path.join(caminhoProjeto(id), 'assets');
  const blocos = path.join(caminhoProjeto(id), 'src', 'blocos.tsx');
  const codigo = fs.existsSync(blocos) ? fs.readFileSync(blocos, 'utf8') : '';
  const porArquivo = new Map();
  for (const i of t.trilhas.flatMap((tr) => tr.itens)) {
    if (i.tipo !== 'video') continue;
    if (!porArquivo.has(i.arquivo)) porArquivo.set(i.arquivo, []);
    porArquivo.get(i.arquivo).push(i);
  }
  fs.mkdirSync(destino, { recursive: true });
  const entradas = fs.readdirSync(assets, { withFileTypes: true });
  const clipes = [...porArquivo.keys()];
  let feitos = 0;
  for (const e of entradas) {
    const origem = path.join(assets, e.name);
    if (e.isDirectory()) {
      fs.cpSync(origem, path.join(destino, e.name), { recursive: true });
      continue;
    }
    const itens = porArquivo.get(e.name);
    if (itens) {
      const nome = `Preparando clipes (${++feitos} de ${clipes.length})`;
      ligar(await copiaLeve(id, e.name, t, itens, { ...opts, nome, peso: [0, 0.1] }), path.join(destino, e.name));
      continue;
    }
    // Vídeo fora da timeline fica de fora, a não ser que um bloco o use pelo nome.
    if (tipoDe(e.name) === 'video' && !codigo.includes(e.name)) continue;
    ligar(origem, path.join(destino, e.name));
  }
  return destino;
}

// Recodifica com o encoder da GPU. O contêiner sai pela extensão do destino (.mp4 ou .mov).
function argsGpu(encoder, entrada, saida) {
  return [
    '-y', '-hide_banner', '-i', entrada,
    ...encoder.args,
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k',
    '-movflags', '+faststart', saida,
  ];
}

export async function renderizar(id, { modo, formato } = {}, onEvento, sinal) {
  const s = carregar();
  modo ??= s.renderModo;
  formato ??= s.renderFormato;
  const encoder = ENCODERS_GPU[await encoderGpu()];
  if (!encoder) modo = 'cpu';
  const projeto = lerProjeto(id);
  if (projeto.timeline) {
    const erros = validarTimeline(id, lerTimeline(id));
    if (erros.length) throw new Error('A timeline tem problemas:\n' + erros.join('\n'));
    escreverModelo(projeto);
  }
  const dir = caminhoProjeto(id);
  const quando = carimbo();
  const saida = path.join(dir, 'renders', `${projeto.id.split('-').slice(1).join('-') || 'video'}-${quando}.${formato}`);
  // Temporários no mesmo disco dos projetos: o C: costuma estar cheio e os arquivos ligados não cruzam discos.
  const raizTmp = path.join(dirs().ws, '.tmp');
  fs.mkdirSync(raizTmp, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(raizTmp, 'render-'));
  const inicio = Date.now();
  const opts = { cwd: dirs().ws, env: { TEMP: tmp, TMP: tmp }, onEvento, sinal };

  try {
    if (projeto.engine === 'remotion') {
      const cli = path.join(dirs().ws, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
      const entrada = path.join('projetos', id, 'src', 'index.ts');
      const publica = projeto.timeline
        ? await pastaPublica(id, lerTimeline(id), path.join(tmp, 'publico'), opts)
        : path.join('projetos', id, 'assets');
      // A RX 570 tem 4 GB: mais quadros ao mesmo tempo não acelera e estoura o limite de busca de cada quadro.
      const base = [cli, 'render', entrada, 'Main', '--public-dir', publica, '--concurrency=2', '--timeout=120000'];
      if (modo === 'gpu') {
        // Chrome desenha os quadros com a GPU (ANGLE); intermediário rápido e quase sem perda; final no encoder da GPU.
        const inter = path.join(tmp, 'inter.mp4');
        await etapa('Renderizando quadros (GPU)', s.nodePath,
          [...base, inter, '--gl=angle', '--codec=h264', '--crf=12', '--x264-preset=veryfast'],
          { ...opts, peso: [0.1, 0.85] });
        await etapa(`Codificando com ${encoder.nome}`, s.ffmpegPath, argsGpu(encoder, inter, saida), { ...opts, peso: [0.85, 1] });
      } else if (formato === 'mov') {
        await etapa('Renderizando (CPU, ProRes)', s.nodePath,
          [...base, saida, '--gl=swangle', '--codec=prores', '--prores-profile=hq'], { ...opts, peso: [0.1, 1] });
      } else {
        await etapa('Renderizando (CPU)', s.nodePath,
          [...base, saida, '--gl=swangle', '--codec=h264', '--crf=18'], { ...opts, peso: [0.1, 1] });
      }
    } else {
      const bin = hyperframesBin();
      const gpuFlags = modo === 'gpu' ? ['--gpu', '--browser-gpu'] : ['--no-browser-gpu'];
      if (formato === 'mov' && modo === 'gpu') {
        // ProRes não tem encoder de GPU: renderiza H.264 na GPU e só troca o contêiner.
        const inter = path.join(tmp, 'inter.mp4');
        await etapa('Renderizando (GPU)', s.nodePath, [bin, 'render', dir, '-o', inter, ...gpuFlags], { ...opts, peso: [0, 0.95] });
        await etapa('Gerando MOV', s.ffmpegPath, ['-y', '-i', inter, '-c', 'copy', saida], { ...opts, peso: [0.95, 1] });
      } else if (formato === 'mov') {
        await etapa('Renderizando (CPU, ProRes)', s.nodePath,
          [bin, 'render', dir, '-o', saida, '--format', 'mov', '--prores-profile', 'hq', ...gpuFlags], opts);
      } else {
        await etapa(modo === 'gpu' ? 'Renderizando (GPU)' : 'Renderizando (CPU)', s.nodePath,
          [bin, 'render', dir, '-o', saida, ...gpuFlags], opts);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const segundos = Math.round((Date.now() - inicio) / 1000);
  let preview;
  if ((await infoVideo(saida)).codec === 'prores') {
    // O player do app (Chromium) não toca ProRes: gera uma cópia H.264 só para assistir.
    onEvento?.({ etapa: 'Gerando prévia', progresso: 1 });
    preview = path.join(dir, 'renders', '.previa', path.basename(saida, '.mov') + '.mp4');
    await transcodificar(saida, { formato: 'mp4', modo: encoder ? 'gpu' : 'cpu', saida: preview });
  }
  const atual = lerProjeto(id);
  atual.renders.unshift({ arquivo: saida, preview, modo, formato, data: new Date().toISOString(), segundos });
  gravarProjeto(atual);
  onEvento?.({ etapa: 'Pronto', progresso: 1 });
  return { arquivo: saida, preview, segundos };
}

// Extrai quadros do último render para o Claude conferir o resultado visualmente.
export async function extrairQuadros(id, segundos) {
  const projeto = lerProjeto(id);
  const ultimo = projeto.renders[0]?.arquivo;
  if (!ultimo || !fs.existsSync(ultimo)) throw new Error('Ainda não há render. Chame renderizar primeiro.');
  const pasta = path.join(caminhoProjeto(id), 'renders', 'quadros');
  fs.mkdirSync(pasta, { recursive: true });
  const saidas = [];
  for (const t of segundos) {
    const arq = path.join(pasta, `t${String(t).replace('.', '_')}.png`);
    const r = await rodar(carregar().ffmpegPath, ['-y', '-ss', String(t), '-i', ultimo, '-frames:v', '1', '-vf', 'scale=540:-2', arq]);
    if (r.codigo === 0 && fs.existsSync(arq)) saidas.push(arq);
  }
  return saidas;
}
