import fs from 'node:fs';
import path from 'node:path';
import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';

function ffprobePath() {
  const ff = carregar().ffmpegPath;
  return ff === 'ffmpeg' ? 'ffprobe' : path.join(path.dirname(ff), 'ffprobe.exe');
}

// Encoders de GPU, na ordem de preferência.
export const ENCODERS_GPU = {
  nvenc: {
    nome: 'NVENC',
    hwaccel: 'cuda',
    args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-profile:v', 'high'],
  },
  amf: {
    nome: 'AMF',
    hwaccel: 'd3d11va',
    // QP constante: no AMF da RX 570 o nível do QVBR não muda nada e a qualidade fica presa ao bitrate.
    args: ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '19', '-qp_b', '21', '-profile:v', 'high'],
  },
};

// O ffmpeg lista todo encoder compilado, com ou sem a placa: só um teste real diz qual funciona aqui.
async function encoderFunciona(id) {
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:r=30:d=0.2', '-c:v', `h264_${id}`, '-f', 'null', '-'];
  try {
    const r = await rodar(carregar().ffmpegPath, args, { sinal: AbortSignal.timeout(15000) });
    return r.codigo === 0;
  } catch {
    return false;
  }
}

let encoderCache;
// 'nvenc', 'amf' ou null (sem GPU utilizável: só CPU).
export function encoderGpu() {
  encoderCache ??= (async () => {
    for (const id of Object.keys(ENCODERS_GPU)) if (await encoderFunciona(id)) return id;
    return null;
  })();
  return encoderCache;
}

// Codec, duração e se é HDR (HLG/PQ de celular), para decidir o tone mapping.
export async function infoVideo(arquivo) {
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
      codec: v?.codec_name ?? null,
      largura: v?.width ?? null,
      altura: v?.height ?? null,
      duracao: Number(j.format?.duration ?? v?.duration ?? 0),
      hdr: ['arib-std-b67', 'smpte2084'].includes(v?.color_transfer),
      temAudio: !!j.streams?.find((s) => s.codec_type === 'audio'),
    };
  } catch {
    return { codec: null, duracao: 0, hdr: false, temAudio: false };
  }
}

// HDR → SDR BT.709; sem isso vídeo de iPhone/Android em HLG fica lavado depois da conversão.
const TONEMAP =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
const TONEMAP_GPU =
  'libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p';

export function nomeSaida(entrada, formato, pastaSaida) {
  const base = path.basename(entrada, path.extname(entrada));
  return path.join(pastaSaida || path.dirname(entrada), `${base}_h264.${formato}`);
}

// Converte para H.264 8-bit (yuv420p) em MP4 ou MOV. modo: 'gpu' (NVENC ou AMF) ou 'cpu' (libx264).
export async function transcodificar(entrada, { formato = 'mp4', modo = 'gpu', saida, pastaSaida } = {}, onProgresso, sinal) {
  const info = await infoVideo(entrada);
  saida ??= nomeSaida(entrada, formato, pastaSaida);
  if (path.resolve(saida) === path.resolve(entrada)) throw new Error('A saída seria igual ao arquivo original.');
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  const encoder = ENCODERS_GPU[await encoderGpu()];
  if (!encoder) modo = 'cpu';

  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  // HDR na GPU: tone mapping pelo libplacebo (Vulkan), ~2,5x mais rápido que o zscale da CPU.
  const placebo = modo === 'gpu' && info.hdr;
  if (placebo) args.push('-init_hw_device', 'vulkan');
  else if (modo === 'gpu') args.push('-hwaccel', encoder.hwaccel);
  args.push('-i', entrada, '-map', '0:v:0', '-map', '0:a?');
  args.push('-vf', placebo ? TONEMAP_GPU : info.hdr ? TONEMAP : 'format=yuv420p');
  if (modo === 'gpu') args.push(...encoder.args);
  else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high');
  args.push('-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', saida);

  const inicio = Date.now();
  const r = await rodar(carregar().ffmpegPath, args, {
    sinal,
    onLinha: (l) => {
      const m = l.match(/^out_time_us=(\d+)/);
      if (m && info.duracao > 0) onProgresso?.(Math.min(1, Number(m[1]) / 1e6 / info.duracao));
    },
  });
  if (sinal?.aborted) {
    fs.rmSync(saida, { force: true });
    throw new Error('Conversão cancelada.');
  }
  if (r.codigo !== 0) {
    fs.rmSync(saida, { force: true });
    // O decodificador de GPU não abre alguns arquivos (ex.: 4:2:2 10-bit); tenta de novo na CPU.
    if (modo === 'gpu') return transcodificar(entrada, { formato, modo: 'cpu', saida }, onProgresso, sinal);
    throw new Error(`ffmpeg falhou (código ${r.codigo}):\n${r.cauda}`);
  }
  onProgresso?.(1);
  return { saida, modo, hdr: info.hdr, segundos: Math.round((Date.now() - inicio) / 1000) };
}
