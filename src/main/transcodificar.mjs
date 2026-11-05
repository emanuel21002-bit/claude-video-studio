import fs from 'node:fs';
import path from 'node:path';
import { carregar, arquivoDoApp } from './settings.mjs';
import { rodar } from './proc.mjs';
import { tamanhoVisivel } from './otio.mjs';
import { CODIFICADORES, AUDIO, cpuDoCodec } from './codificadores.mjs';

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

// ---------- leitura dos vídeos (ffprobe) ----------
// Abrir um processo trava o processo principal por alguns milissegundos: com dezenas de materiais, trava o app.
// Cada arquivo é lido uma vez só (guardado em disco, valendo enquanto o arquivo não mudar) e poucos de cada vez.
const LIMITE_SONDAGENS = 4;
const MAX_GUARDADAS = 5000;
let guardadas = null;
let timerGuardar = null;
const emAndamento = new Map();
const espera = [];
let ativas = 0;

const arquivoGuardadas = () => arquivoDoApp('videos-lidos.json');

function lerGuardadas() {
  if (guardadas) return guardadas;
  try {
    guardadas = new Map(Object.entries(JSON.parse(fs.readFileSync(arquivoGuardadas(), 'utf8'))));
  } catch {
    guardadas = new Map();
  }
  return guardadas;
}

function guardarDepois() {
  clearTimeout(timerGuardar);
  timerGuardar = setTimeout(() => {
    while (guardadas.size > MAX_GUARDADAS) guardadas.delete(guardadas.keys().next().value);
    fs.promises.writeFile(arquivoGuardadas(), JSON.stringify(Object.fromEntries(guardadas))).catch(() => {});
  }, 2000);
}

const pegarVaga = () => (ativas < LIMITE_SONDAGENS ? (ativas++, Promise.resolve()) : new Promise((ok) => espera.push(ok)));
function soltarVaga() {
  const proximo = espera.shift();
  if (proximo) proximo();
  else ativas--;
}

// Codec, duração, tamanho na tela e se é HDR (HLG/PQ de celular), para decidir o tone mapping.
export function infoVideo(arquivo) {
  let chave;
  try {
    const st = fs.statSync(arquivo);
    chave = `${path.resolve(arquivo)}|${st.size}|${Math.round(st.mtimeMs)}`;
  } catch {
    return sondarVideo(arquivo);
  }
  const pronta = lerGuardadas().get(chave);
  if (pronta) return Promise.resolve(pronta);
  if (emAndamento.has(chave)) return emAndamento.get(chave);
  const tarefa = sondarVideo(arquivo).then((info) => {
    emAndamento.delete(chave);
    // Leitura que falhou não é guardada: o arquivo pode só estar sendo gravado.
    if (info.codec) {
      guardadas.set(chave, info);
      guardarDepois();
    }
    return info;
  });
  emAndamento.set(chave, tarefa);
  return tarefa;
}

async function sondarVideo(arquivo) {
  await pegarVaga();
  let saida = '';
  try {
    await rodar(
      ffprobePath(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo],
      { onLinha: (l) => (saida += l + '\n') },
    );
  } finally {
    soltarVaga();
  }
  try {
    const j = JSON.parse(saida);
    const v = j.streams?.find((s) => s.codec_type === 'video');
    return {
      codec: v?.codec_name ?? null,
      ...tamanhoVisivel(v),
      duracao: Number(j.format?.duration ?? v?.duration ?? 0),
      pixFmt: v?.pix_fmt ?? null,
      hdr: ['arib-std-b67', 'smpte2084'].includes(v?.color_transfer),
      temAudio: !!j.streams?.find((s) => s.codec_type === 'audio'),
    };
  } catch {
    return { codec: null, duracao: 0, hdr: false, temAudio: false };
  }
}

// HDR → SDR BT.709; sem isso vídeo de iPhone/Android em HLG fica lavado depois da conversão.
export const TONEMAP =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
export const TONEMAP_GPU =
  'libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p';

// Resoluções de saída (largura x altura). Sem ela, o vídeo mantém o tamanho do original.
export const RESOLUCOES = {
  '1080x1920': [1080, 1920],
  '720x1280': [720, 1280],
  '2160x3840': [2160, 3840],
  '1920x1080': [1920, 1080],
  '1280x720': [1280, 720],
  '3840x2160': [3840, 2160],
  '1080x1080': [1080, 1080],
  '1080x1350': [1080, 1350],
};

// "barras": cabe inteiro e completa com preto; "preencher": ocupa o quadro todo e corta o que sobra.
function filtroResolucao(resolucao, ajuste) {
  const r = RESOLUCOES[resolucao];
  if (!r) return '';
  const [w, h] = r;
  return ajuste === 'preencher'
    ? `,scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1`
    : `,scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
}

export function nomeSaida(entrada, formato, pastaSaida, sufixo = 'h264') {
  const base = path.basename(entrada, path.extname(entrada));
  return path.join(pastaSaida || path.dirname(entrada), `${base}_${sufixo}.${formato}`);
}

// Converte para 8-bit (yuv420p). Sem `codificador` é o caminho de sempre: H.264 em MP4 ou MOV, modo 'gpu' (NVENC ou AMF)
// ou 'cpu' (libx264). Com `codificador` (id de CODIFICADORES) vale a escolha do conversor: codec, qualidade (RF),
// velocidade (0 a 2) e áudio (id de AUDIO).
export async function transcodificar(entrada, { formato = 'mp4', modo = 'gpu', saida, pastaSaida, codificador, qualidade, velocidade = 1, audio = 'aac', resolucao = null, ajuste = 'barras' } = {}, onProgresso, sinal) {
  if (resolucao && !RESOLUCOES[resolucao]) throw new Error(`Resolução desconhecida: ${resolucao}`);
  const info = await infoVideo(entrada);
  const escolhido = codificador ? CODIFICADORES[codificador] : null;
  if (codificador && !escolhido) throw new Error(`Codificador desconhecido: ${codificador}`);
  const som = AUDIO[audio];
  if (!som) throw new Error(`Áudio desconhecido: ${audio}`);
  if (escolhido) {
    if (!escolhido.formatos.includes(formato)) throw new Error(`${escolhido.nome} não cabe em ${formato.toUpperCase()}.`);
    if (!som.formatos.includes(formato)) throw new Error(`${som.nome} não cabe em ${formato.toUpperCase()}.`);
  }
  saida ??= nomeSaida(entrada, formato, pastaSaida, [escolhido?.codec ?? 'h264', resolucao].filter(Boolean).join('_'));
  if (path.resolve(saida) === path.resolve(entrada)) throw new Error('A saída seria igual ao arquivo original.');
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  const encoder = ENCODERS_GPU[await encoderGpu()];
  if (escolhido) modo = escolhido.tipo;
  else if (!encoder) modo = 'cpu';
  const hwaccel = escolhido ? escolhido.hwaccel : encoder?.hwaccel;

  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  // HDR na GPU: tone mapping pelo libplacebo (Vulkan), ~2,5x mais rápido que o zscale da CPU.
  const placebo = modo === 'gpu' && info.hdr;
  if (placebo) args.push('-init_hw_device', 'vulkan');
  else if (modo === 'gpu') args.push('-hwaccel', hwaccel);
  args.push('-i', entrada, '-map', '0:v:0', '-map', '0:a?');
  args.push('-vf', (placebo ? TONEMAP_GPU : info.hdr ? TONEMAP : 'format=yuv420p') + filtroResolucao(resolucao, ajuste));
  if (escolhido) {
    args.push(...escolhido.args(qualidade ?? escolhido.q.padrao, velocidade).map(String));
    // O Apple e a maioria dos editores só leem H.265 em MP4/MOV com a etiqueta hvc1.
    if (escolhido.codec === 'h265' && formato !== 'mkv') args.push('-tag:v', 'hvc1');
  } else if (modo === 'gpu') args.push(...encoder.args);
  else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high');
  args.push('-c:a', som.enc, ...som.args);
  if (formato !== 'mkv') args.push('-movflags', '+faststart');
  args.push(saida);

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
    if (modo === 'gpu') {
      const cpu = escolhido ? { codificador: cpuDoCodec(escolhido.codec), velocidade, audio } : { modo: 'cpu' };
      if (!cpu.codificador && escolhido) throw new Error(`ffmpeg falhou (código ${r.codigo}):\n${r.cauda}`);
      return transcodificar(entrada, { formato, saida, resolucao, ajuste, ...cpu }, onProgresso, sinal);
    }
    throw new Error(`ffmpeg falhou (código ${r.codigo}):\n${r.cauda}`);
  }
  onProgresso?.(1);
  return { saida, modo, hdr: info.hdr, segundos: Math.round((Date.now() - inicio) / 1000), codificador: escolhido?.nome };
}
