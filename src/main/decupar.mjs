import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';
import { infoVideo } from './transcodificar.mjs';
import { unirAudios } from './workspace.mjs';
import { PADRAO, lerSilencios, calcularSegmentos, montarFiltro } from './decupar-nucleo.mjs';

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
  const antes = (await infoVideo(entrada)).duracao;
  if (!(antes > 0)) throw new Error('Não consegui ler a duração do áudio.');

  const linhas = [];
  const minimoSilencio = Math.max(0.2, 2 * ((o.pausa + o.sobreposicao) / 2));
  await rodar(ffmpeg, ['-hide_banner', '-nostats', '-i', entrada, '-vn', '-af', `silencedetect=noise=${o.limiar}dB:d=${minimoSilencio.toFixed(3)}`, '-f', 'null', '-'], {
    sinal,
    onLinha: (l) => linhas.push(l),
  });
  if (sinal?.aborted) throw new Error('Decupagem cancelada.');
  onProgresso?.(0.1);

  const segs = calcularSegmentos(lerSilencios(linhas, antes), antes, o);
  const esperado = Math.max(1, (segs.reduce((s, [a, b]) => s + (b - a), 0) - (segs.length - 1) * o.sobreposicao) / (o.velocidade || 1));
  const script = path.join(tmp, 'filtro.txt');
  fs.writeFileSync(script, montarFiltro(segs, o));
  const saida = grupo ? nomeSaida(grupo.pasta, o.formato, o.pastaSaida, true) : nomeSaida(entrada, o.formato, o.pastaSaida);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  try {
    // ffmpeg 7 e anteriores usam -filter_complex_script; o 8 em diante, -/filter_complex.
    let r;
    for (const opcao of ['-/filter_complex', '-filter_complex_script']) {
      r = await rodar(ffmpeg, ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', entrada, opcao, script, '-map', '[saida]', ...codec, saida], {
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
  return { saida, cortes: segs.length - 1, antes, depois, segundos: Math.round((Date.now() - inicio) / 1000) };
}
