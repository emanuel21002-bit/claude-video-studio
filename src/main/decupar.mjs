import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';
import { infoVideo } from './transcodificar.mjs';
import { unirAudios } from './workspace.mjs';
import { PADRAO, TAXA_ANALISE, analisarVoz, calcularSegmentos, montarFiltro } from './decupar-nucleo.mjs';

export const FORMATOS_DECUPAGEM = {
  wav: ['-c:a', 'pcm_s16le'],
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  m4a: ['-c:a', 'aac', '-b:a', '192k'],
};

// `entrada` pode ser um arquivo ou uma pasta (narração em vários áudios): o resultado fica ao lado, com o nome dela.
function nomeSaida(entrada, formato, pastaSaida, ehPasta) {
  const base = ehPasta ? path.basename(entrada) : path.basename(entrada, path.extname(entrada));
  const dir = pastaSaida || path.dirname(entrada);
  let saida = path.join(dir, `${base} (decupado).${formato}`);
  for (let i = 2; fs.existsSync(saida); i++) saida = path.join(dir, `${base} (decupado ${i}).${formato}`);
  return saida;
}

// Tira as pausas da narração e sobrepõe as emendas (ver decupar-nucleo.mjs). Devolve { saida, cortes, antes, depois, segundos }.
// `entrada` é um arquivo ou { pasta, arquivos }: os arquivos da pasta são juntados, na ordem, antes de decupar.
export async function decuparAudio(entrada, opcoes = {}, onProgresso, sinal) {
  const grupo = typeof entrada === 'object' ? entrada : null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-decupar-'));
  try {
    let origem = grupo ? grupo.arquivos[0] : entrada;
    if (grupo && grupo.arquivos.length > 1) {
      origem = path.join(tmp, 'narracao-junta.wav');
      await unirAudios(grupo.arquivos, origem);
    }
    const r = await decuparUm(origem, opcoes, onProgresso, sinal, tmp, grupo ? { pasta: grupo.pasta } : null);
    return r;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function decuparUm(entrada, opcoes, onProgresso, sinal, tmp, grupo) {
  const o = { ...PADRAO, formato: 'wav', ...opcoes };
  const codec = FORMATOS_DECUPAGEM[o.formato];
  if (!codec) throw new Error(`Formato desconhecido: ${o.formato}`);
  const ffmpeg = carregar().ffmpegPath;
  const inicio = Date.now();

  // Áudio mono a 8 kHz só na faixa da voz, em float cru, para a detecção de voz (ver analisarVoz).
  const bruto = path.join(tmp, 'analise.f32');
  const ra = await rodar(ffmpeg, ['-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-i', entrada, '-map', '0:a:0', '-vn', '-af', `highpass=f=100,lowpass=f=3800,aresample=${TAXA_ANALISE}`, '-ac', '1', '-f', 'f32le', bruto], { sinal });
  if (sinal?.aborted) throw new Error('Decupagem cancelada.');
  if (ra.codigo !== 0) {
    if (/matches no streams/i.test(ra.cauda)) throw new Error('Este arquivo não tem faixa de áudio.');
    throw new Error(`O ffmpeg não conseguiu ler o som deste arquivo (código ${ra.codigo}):\n${ra.cauda}`);
  }
  const buf = fs.readFileSync(bruto);
  const amostras = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  if (amostras.length < TAXA_ANALISE / 10) throw new Error('Não achei som neste arquivo.');
  // A duração vem do som decodificado: num vídeo, a do arquivo é a da imagem, e o áudio pode ser mais longo.
  const duracaoSom = amostras.length / TAXA_ANALISE;
  const analise = analisarVoz(amostras, TAXA_ANALISE, o);
  fs.rmSync(bruto, { force: true });
  onProgresso?.(0.1);

  o.ruidoMedido = analise.ruido;
  o.vozMedida = analise.voz;
  const segs = calcularSegmentos(analise.silencios, duracaoSom, o);
  const sobreposto = segs.sobreposicoes?.reduce((s, x) => s + x, 0) ?? (segs.length - 1) * o.sobreposicao;
  const esperado = Math.max(1, (segs.reduce((s, [a, b]) => s + (b - a), 0) - sobreposto) / (o.velocidade || 1));
  const script = path.join(tmp, 'filtro.txt');
  fs.writeFileSync(script, montarFiltro(segs, o));
  const saida = grupo ? nomeSaida(grupo.pasta, o.formato, o.pastaSaida, true) : nomeSaida(entrada, o.formato, o.pastaSaida);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  try {
    // ffmpeg 7 e anteriores usam -filter_complex_script; o 8 em diante, -/filter_complex.
    let r;
    for (const opcao of ['-/filter_complex', '-filter_complex_script']) {
      r = await rodar(ffmpeg, ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', entrada, opcao, script, '-map', '[saida]', '-vn', ...codec, saida], {
        sinal,
        onLinha: (l) => {
          const m = l.match(/^out_time_us=(\d+)/);
          if (m) onProgresso?.(0.1 + 0.9 * Math.min(1, Number(m[1]) / 1e6 / esperado));
        },
      });
      if (sinal?.aborted || r.codigo === 0 || !/Unrecognized option/i.test(r.cauda)) break;
    }
    if (sinal?.aborted) throw new Error('Decupagem cancelada.');
    if (r.codigo !== 0) throw new Error(`ffmpeg falhou (código ${r.codigo}):\n${r.cauda}`);
  } catch (e) {
    fs.rmSync(saida, { force: true });
    throw e;
  }
  const depois = (await infoVideo(saida)).duracao;
  return { saida, cortes: segs.length - 1, antes: duracaoSom, depois, segundos: Math.round((Date.now() - inicio) / 1000), ruido: analise.ruido, voz: analise.voz, limiar: analise.limiar, ruidos: analise.ruidos };
}
