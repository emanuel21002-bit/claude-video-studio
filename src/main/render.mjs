import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';
import { dirs, caminhoProjeto, hyperframesBin, lerProjeto, gravarProjeto, carimbo } from './workspace.mjs';
import { infoVideo, nvencDisponivel, transcodificar } from './transcodificar.mjs';
import { lerTimeline, validarTimeline } from './timeline.mjs';

// Progresso vem como "123/900" (frames) ou "45%" nas linhas dos CLIs.
function lerProgresso(linha) {
  const pct = linha.match(/(\d{1,3}(?:\.\d+)?)\s?%/);
  if (pct) return Math.min(100, Number(pct[1])) / 100;
  const fr = linha.match(/\b(\d+)\s?\/\s?(\d+)\b/);
  if (fr && Number(fr[2]) > 1) return Math.min(1, Number(fr[1]) / Number(fr[2]));
  return null;
}

async function etapa(nome, cmd, args, { cwd, onEvento, sinal, peso = [0, 1] }) {
  onEvento?.({ etapa: nome, progresso: peso[0] });
  const r = await rodar(cmd, args, {
    cwd,
    sinal,
    onLinha: (l) => {
      onEvento?.({ log: l });
      const p = lerProgresso(l);
      if (p != null) onEvento?.({ etapa: nome, progresso: peso[0] + p * (peso[1] - peso[0]) });
    },
  });
  if (sinal?.aborted) throw new Error('Render cancelado.');
  if (r.codigo !== 0) throw new Error(`${nome} falhou (código ${r.codigo}):\n${r.cauda}`);
}

// Recodifica com NVENC (GPU). O contêiner sai pela extensão do destino (.mp4 ou .mov).
function argsNvenc(entrada, saida) {
  return [
    '-y', '-hide_banner', '-i', entrada,
    '-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k',
    '-movflags', '+faststart', saida,
  ];
}

export async function renderizar(id, { modo, formato } = {}, onEvento, sinal) {
  const s = carregar();
  modo ??= s.renderModo;
  formato ??= s.renderFormato;
  const projeto = lerProjeto(id);
  if (projeto.timeline) {
    const erros = validarTimeline(id, lerTimeline(id));
    if (erros.length) throw new Error('A timeline tem problemas:\n' + erros.join('\n'));
  }
  const dir = caminhoProjeto(id);
  const quando = carimbo();
  const saida = path.join(dir, 'renders', `${projeto.id.split('-').slice(1).join('-') || 'video'}-${quando}.${formato}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-render-'));
  const inicio = Date.now();
  const opts = { cwd: dirs().ws, onEvento, sinal };

  try {
    if (projeto.engine === 'remotion') {
      const cli = path.join(dirs().ws, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
      const entrada = path.join('projetos', id, 'src', 'index.ts');
      const base = [cli, 'render', entrada, 'Main', '--public-dir', path.join('projetos', id, 'assets')];
      if (modo === 'gpu') {
        // Chrome desenha os quadros com a GPU (ANGLE); intermediário rápido e quase sem perda; final em NVENC.
        const inter = path.join(tmp, 'inter.mp4');
        await etapa('Renderizando quadros (GPU)', s.nodePath,
          [...base, inter, '--gl=angle', '--codec=h264', '--crf=12', '--x264-preset=veryfast'],
          { ...opts, peso: [0, 0.85] });
        await etapa('Codificando com NVENC', s.ffmpegPath, argsNvenc(inter, saida), { ...opts, peso: [0.85, 1] });
      } else if (formato === 'mov') {
        await etapa('Renderizando (CPU, ProRes)', s.nodePath,
          [...base, saida, '--gl=swangle', '--codec=prores', '--prores-profile=hq'], opts);
      } else {
        await etapa('Renderizando (CPU)', s.nodePath,
          [...base, saida, '--gl=swangle', '--codec=h264', '--crf=18'], opts);
      }
    } else {
      const bin = hyperframesBin();
      const gpuFlags = modo === 'gpu' ? ['--gpu', '--browser-gpu'] : ['--no-browser-gpu'];
      if (formato === 'mov' && modo === 'gpu') {
        // ProRes não tem encoder de GPU: renderiza H.264 em NVENC e só troca o contêiner.
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
    await transcodificar(saida, { formato: 'mp4', modo: (await nvencDisponivel()) ? 'gpu' : 'cpu', saida: preview });
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
