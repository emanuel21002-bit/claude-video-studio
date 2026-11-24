import fs from 'node:fs';
import path from 'node:path';
import { lerTimeline, semDesativados } from './timeline.mjs';
import { lerProjeto, caminhoTimeline } from './workspace.mjs';
import { transcreverVideo, transcricaoDoArquivo } from './transcricao-video.mjs';
import { transcricaoDaTimeline } from './transcricao-nucleo-timeline.mjs';

const arquivoResultado = (id) => path.join(caminhoTimeline(id), 'transcricao-timeline.json');

// O que toca de verdade, como no render: clipes de vídeo com volume e áudios de faixas que não estão mudas nem ocultas.
export function itensComSom(t, projeto) {
  const comAudio = new Set(projeto.materiais.filter((m) => m.tipo === 'video' && m.temAudio).map((m) => m.arquivo));
  const itens = [];
  for (const tr of t.trilhas) {
    if (tr.muda || tr.oculta) continue;
    for (const i of tr.itens) {
      if (!i.arquivo) continue;
      const toca = tr.tipo === 'audio' ? i.tipo === 'audio' && (i.volume ?? 1) > 0 : i.tipo === 'video' && (i.volume ?? 0) > 0 && comAudio.has(i.arquivo);
      if (toca) itens.push(i);
    }
  }
  return itens;
}

export function lerTranscricaoDaTimeline(id) {
  try {
    const r = JSON.parse(fs.readFileSync(arquivoResultado(id), 'utf8'));
    return { ...r, desatualizada: fs.statSync(path.join(caminhoTimeline(id), 'timeline.json')).mtimeMs > r.timelineMtime + 1 };
  } catch {
    return null;
  }
}

// Transcreve o áudio de tudo o que toca na timeline, com os tempos da timeline. Cada arquivo é transcrito uma vez
// (fica guardado no projeto); refazer depois de mexer nos cortes só remapeia os tempos. `fila` serializa o Whisper.
export async function transcreverTimeline(id, onLinha, sinal, fila = (fn) => fn()) {
  const projeto = lerProjeto(id);
  const t = semDesativados(lerTimeline(id));
  const itens = itensComSom(t, projeto);
  if (!itens.length) throw new Error('Nenhum clipe com som nesta timeline: os vídeos estão sem volume ou mudos e não há áudios.');
  const duracoes = new Map([...projeto.materiais, ...(projeto.narracoes ?? [])].map((m) => [m.arquivo, m.duracao]));
  const arquivos = [...new Set(itens.map((i) => i.arquivo))];
  const transcricoes = {};
  for (const [n, arquivo] of arquivos.entries()) {
    if (sinal?.aborted) throw new Error('Cancelado.');
    const rotulo = `${n + 1} de ${arquivos.length}: ${arquivo}`;
    let tr = transcricaoDoArquivo(id, arquivo);
    if (!tr) {
      onLinha?.(`Transcrevendo ${rotulo}`);
      await fila(() => transcreverVideo(id, { arquivo, duracao: duracoes.get(arquivo) ?? 0 }, (l) => onLinha?.(`${rotulo} — ${l}`), sinal));
      tr = transcricaoDoArquivo(id, arquivo);
    }
    if (tr) transcricoes[arquivo] = tr;
  }
  const { segmentos, palavras } = transcricaoDaTimeline(itens, transcricoes);
  const resultado = {
    geradoEm: new Date().toISOString(),
    timelineMtime: fs.statSync(path.join(caminhoTimeline(id), 'timeline.json')).mtimeMs,
    arquivos,
    segmentos,
    palavras,
  };
  fs.writeFileSync(arquivoResultado(id), JSON.stringify(resultado, null, 2));
  return { ...resultado, desatualizada: false };
}
