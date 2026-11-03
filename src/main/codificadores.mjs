import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';

// Codificadores do conversor, nos moldes do HandBrake: o mesmo conjunto de codecs, em software (CPU) e em hardware
// (NVIDIA NVENC, AMD AMF/VCN, Intel QSV). A qualidade é o "RF" do HandBrake: nos codificadores de CRF, menor é melhor.
// A velocidade tem três níveis (0 rápido, 1 equilibrado, 2 melhor compressão) que cada codificador traduz para o seu preset.

export const NIVEIS_VELOCIDADE = ['Rápido', 'Equilibrado', 'Melhor compressão'];

const Q = (min, max, padrao, maiorMelhor = false) => ({ min, max, padrao, maiorMelhor });
const escolher = (lista) => (v) => lista[Math.min(lista.length - 1, Math.max(0, v))];

const NV = escolher(['p3', 'p5', 'p7']);
const AMF = escolher(['speed', 'balanced', 'quality']);
const X26 = escolher(['veryfast', 'medium', 'slower']);
const QSV = escolher(['veryfast', 'medium', 'veryslow']);

const nvenc = (codec, q) => (qual, v) => ['-c:v', `${codec}_nvenc`, '-preset', NV(v), '-rc', 'vbr', '-cq', qual, '-b:v', '0', ...q];
const amf = (codec, extra = []) => (qual, v) => ['-c:v', `${codec}_amf`, '-usage', 'transcoding', '-quality', AMF(v), '-rc', 'cqp', '-qp_i', qual, '-qp_p', qual, ...extra];
const qsv = (codec, q = []) => (qual, v) => ['-c:v', `${codec}_qsv`, '-preset', QSV(v), '-global_quality', qual, ...q];

const MP4_MOV_MKV = ['mp4', 'mov', 'mkv'];

export const CODIFICADORES = {
  // H.264
  libx264: { codec: 'h264', nome: 'H.264 (x264)', tipo: 'cpu', formatos: MP4_MOV_MKV, q: Q(0, 51, 18), args: (q, v) => ['-c:v', 'libx264', '-preset', X26(v), '-crf', q, '-profile:v', 'high'] },
  h264_nvenc: { codec: 'h264', nome: 'H.264 (NVIDIA NVENC)', tipo: 'gpu', hwaccel: 'cuda', formatos: MP4_MOV_MKV, q: Q(0, 51, 19), args: nvenc('h264', ['-profile:v', 'high']) },
  h264_amf: { codec: 'h264', nome: 'H.264 (AMD VCN)', tipo: 'gpu', hwaccel: 'd3d11va', formatos: MP4_MOV_MKV, q: Q(0, 51, 19), args: (q, v) => amf('h264', ['-qp_b', q + 2, '-profile:v', 'high'])(q, v) },
  h264_qsv: { codec: 'h264', nome: 'H.264 (Intel QSV)', tipo: 'gpu', hwaccel: 'qsv', formatos: MP4_MOV_MKV, q: Q(1, 51, 20), args: qsv('h264', ['-profile:v', 'high']) },
  // H.265
  libx265: { codec: 'h265', nome: 'H.265 (x265)', tipo: 'cpu', formatos: MP4_MOV_MKV, q: Q(0, 51, 20), args: (q, v) => ['-c:v', 'libx265', '-preset', X26(v), '-crf', q, '-x265-params', 'log-level=error'] },
  hevc_nvenc: { codec: 'h265', nome: 'H.265 (NVIDIA NVENC)', tipo: 'gpu', hwaccel: 'cuda', formatos: MP4_MOV_MKV, q: Q(0, 51, 22), args: nvenc('hevc', []) },
  hevc_amf: { codec: 'h265', nome: 'H.265 (AMD VCN)', tipo: 'gpu', hwaccel: 'd3d11va', formatos: MP4_MOV_MKV, q: Q(0, 51, 22), args: amf('hevc') },
  hevc_qsv: { codec: 'h265', nome: 'H.265 (Intel QSV)', tipo: 'gpu', hwaccel: 'qsv', formatos: MP4_MOV_MKV, q: Q(1, 51, 22), args: qsv('hevc') },
  // AV1
  libsvtav1: { codec: 'av1', nome: 'AV1 (SVT-AV1)', tipo: 'cpu', formatos: ['mp4', 'mkv'], q: Q(0, 63, 28), args: (q, v) => ['-c:v', 'libsvtav1', '-preset', ['10', '6', '3'][v], '-crf', q] },
  av1_nvenc: { codec: 'av1', nome: 'AV1 (NVIDIA NVENC)', tipo: 'gpu', hwaccel: 'cuda', formatos: ['mp4', 'mkv'], q: Q(0, 51, 30), args: nvenc('av1', []) },
  av1_amf: { codec: 'av1', nome: 'AV1 (AMD VCN)', tipo: 'gpu', hwaccel: 'd3d11va', formatos: ['mp4', 'mkv'], q: Q(0, 255, 110), args: amf('av1') },
  av1_qsv: { codec: 'av1', nome: 'AV1 (Intel QSV)', tipo: 'gpu', hwaccel: 'qsv', formatos: ['mp4', 'mkv'], q: Q(1, 51, 28), args: qsv('av1') },
  // Outros
  'libvpx-vp9': { codec: 'vp9', nome: 'VP9', tipo: 'cpu', formatos: ['mp4', 'mkv'], q: Q(0, 63, 31), args: (q, v) => ['-c:v', 'libvpx-vp9', '-crf', q, '-b:v', '0', '-deadline', 'good', '-row-mt', '1', '-cpu-used', ['5', '2', '1'][v]] },
  libvpx: { codec: 'vp8', nome: 'VP8', tipo: 'cpu', formatos: ['mkv'], q: Q(4, 63, 12), args: (q, v) => ['-c:v', 'libvpx', '-crf', q, '-b:v', '20M', '-deadline', 'good', '-cpu-used', ['5', '2', '0'][v]] },
  mpeg4: { codec: 'mpeg4', nome: 'MPEG-4', tipo: 'cpu', formatos: MP4_MOV_MKV, q: Q(1, 31, 3), args: (q) => ['-c:v', 'mpeg4', '-q:v', q] },
  mpeg2video: { codec: 'mpeg2', nome: 'MPEG-2', tipo: 'cpu', formatos: ['mkv', 'mp4'], q: Q(1, 31, 3), args: (q) => ['-c:v', 'mpeg2video', '-q:v', q] },
  libtheora: { codec: 'theora', nome: 'Theora', tipo: 'cpu', formatos: ['mkv'], q: Q(0, 10, 7, true), args: (q) => ['-c:v', 'libtheora', '-q:v', q] },
};

// Encoder de CPU de cada codec, para onde a conversão volta quando o de GPU falha.
const CPU_DO_CODEC = Object.fromEntries(Object.entries(CODIFICADORES).filter(([, e]) => e.tipo === 'cpu').map(([id, e]) => [e.codec, id]));
export const cpuDoCodec = (codec) => CPU_DO_CODEC[codec];

export const AUDIO = {
  aac: { nome: 'AAC', enc: 'aac', args: ['-b:a', '320k'], formatos: MP4_MOV_MKV },
  opus: { nome: 'Opus', enc: 'libopus', args: ['-b:a', '192k', '-strict', '-2'], formatos: ['mp4', 'mkv'] },
  ac3: { nome: 'AC3', enc: 'ac3', args: ['-b:a', '448k'], formatos: MP4_MOV_MKV },
  mp3: { nome: 'MP3', enc: 'libmp3lame', args: ['-b:a', '320k'], formatos: MP4_MOV_MKV },
  flac: { nome: 'FLAC', enc: 'flac', args: ['-strict', '-2'], formatos: ['mp4', 'mkv'] },
  vorbis: { nome: 'Vorbis', enc: 'libvorbis', args: ['-b:a', '256k'], formatos: ['mkv'] },
  copy: { nome: 'Copiar o áudio original', enc: 'copy', args: [], formatos: MP4_MOV_MKV },
};

// Os de hardware são testados em uma imagem de teste por vendedor: se o primeiro codec do vendedor não abre, a placa não é dele.
const VENDEDORES = ['nvenc', 'amf', 'qsv'];

async function testar(id) {
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=30:d=0.3', '-pix_fmt', 'yuv420p', ...CODIFICADORES[id].args(CODIFICADORES[id].q.padrao, 1).map(String), '-f', 'null', '-'];
  try {
    const r = await rodar(carregar().ffmpegPath, args, { sinal: AbortSignal.timeout(20000) });
    return r.codigo === 0;
  } catch {
    return false;
  }
}

let cache;
// { video: [{id, codec, nome, tipo, formatos, q}], audio: [{id, nome, formatos}] } só com o que este ffmpeg e esta placa realmente têm.
export function codificadoresDisponiveis() {
  cache ??= (async () => {
    const compilados = new Set();
    await rodar(carregar().ffmpegPath, ['-hide_banner', '-encoders'], {
      onLinha: (l) => {
        const m = l.match(/^\s*[VAS][.\w]{5}\s+(\S+)/);
        if (m) compilados.add(m[1]);
      },
    }).catch(() => {});
    const video = [];
    const bloqueados = new Set();
    for (const [id, e] of Object.entries(CODIFICADORES)) {
      if (!compilados.has(id)) continue;
      if (e.tipo === 'gpu') {
        const vend = VENDEDORES.find((v) => id.endsWith(v));
        if (bloqueados.has(vend)) continue;
        const ok = await testar(id);
        // Um erro no h264 do vendedor (o codec que toda placa dele tem) elimina o vendedor inteiro.
        if (!ok && e.codec === 'h264') bloqueados.add(vend);
        if (!ok) continue;
      }
      video.push({ id, codec: e.codec, nome: e.nome, tipo: e.tipo, formatos: e.formatos, q: e.q });
    }
    const audio = Object.entries(AUDIO)
      .filter(([, a]) => a.enc === 'copy' || compilados.has(a.enc))
      .map(([id, a]) => ({ id, nome: a.nome, formatos: a.formatos }));
    return { video, audio, velocidades: NIVEIS_VELOCIDADE };
  })();
  return cache;
}
