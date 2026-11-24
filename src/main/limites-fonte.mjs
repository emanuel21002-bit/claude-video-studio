// Quanto de imagem cada vídeo tem de verdade, e clipes que pedem mais do que isso.
//
// Clipe que pede imagem depois do fim do arquivo (corteInicio + duracao * velocidade além do último quadro) aparece
// como faixa preta no fim do take: na exportação pelo ffmpeg o fundo da timeline aparece por baixo, e na prévia o
// player fica sem quadro. Acontecia quando o corte era escolhido pela duração do contêiner, que no iPhone pode passar
// da imagem (faixas de áudio e metadados mais longas, e o arredondamento para 2 casas sempre para cima), ou quando o
// corte passava do tamanho do arquivo (um clipe de 1,57 s com corteInicio 2).

// Duração da imagem a partir do JSON do ffprobe (-show_format -show_streams): a do fluxo de vídeo, nunca maior que a
// do contêiner. Sem fluxo de vídeo, a do contêiner. Arredonda para baixo: um corte até aqui sempre tem quadro.
export function duracaoDaImagem(j, casas = 3) {
  const v = j?.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const formato = Number(j?.format?.duration);
  const fluxo = Number(v?.duration);
  const candidatos = [fluxo, formato].filter((x) => Number.isFinite(x) && x > 0);
  if (!candidatos.length) return 0;
  const d = v && Number.isFinite(fluxo) && fluxo > 0 ? Math.min(...candidatos) : candidatos[0];
  const f = 10 ** casas;
  return Math.floor(d * f + 1e-6) / f;
}

// Clipes de vídeo e imagem na grade de quadros, como a tela já faz ao editar (o Claude grava tempos como 6,52 s, que
// a 30 fps é o quadro 195,6). Fora da grade, cada motor arredonda de um jeito: no ffmpeg o clipe começava em 6,5 s e
// saía com um quadro a menos, e o último quadro do take ficava com o fundo preto. Início e fim vão para o quadro mais
// próximo (no mínimo 1 quadro). Textos, legendas e áudio não mudam. Muda t no lugar e devolve quantos itens mudaram.
export function ajustarAGrade(t) {
  const fps = t?.fps;
  if (!(fps > 0)) return 0;
  let n = 0;
  const q = (x) => Number(x.toFixed(6));
  for (const tr of t.trilhas ?? []) {
    if (tr.tipo === 'audio') continue;
    for (const i of tr.itens ?? []) {
      if (i.tipo !== 'video' && i.tipo !== 'imagem') continue;
      if (!Number.isFinite(i.inicio) || !Number.isFinite(i.duracao)) continue;
      const f0 = Math.round(i.inicio * fps);
      const f1 = Math.max(f0 + 1, Math.round((i.inicio + i.duracao) * fps));
      const inicio = q(f0 / fps);
      const duracao = q((f1 - f0) / fps);
      if (Math.abs(inicio - i.inicio) < 1e-6 && Math.abs(duracao - i.duracao) < 1e-6) continue;
      i.inicio = inicio;
      i.duracao = duracao;
      n++;
    }
  }
  return n;
}

const MARGEM = 0.001;
const arred = (x) => Math.max(0, Math.floor(x * 1000 + 1e-6) / 1000);

// Traz para dentro do arquivo os clipes de vídeo que passam do fim: o corte anda para trás (o clipe continua no mesmo
// lugar e com a mesma duração, só mostra um trecho um pouco anterior). Se o arquivo é mais curto que o clipe, o corte
// vai para 0 e a exportação segura o último quadro (ver tpad em exportar-ffmpeg.mjs).
// duracaoDe(arquivo) -> segundos de imagem, ou null se ainda não se sabe (aí o clipe fica como está).
// Muda t no lugar e devolve a lista do que mudou: [{ id, arquivo, de, para, falta }].
export function ajustarAoArquivo(t, duracaoDe) {
  const mudancas = [];
  for (const tr of t?.trilhas ?? []) {
    if (tr.tipo === 'audio') continue;
    for (const i of tr.itens ?? []) {
      if (i.tipo !== 'video' || !i.arquivo) continue;
      const D = duracaoDe(i.arquivo);
      if (!(D > 0)) continue;
      const vel = i.velocidade ?? 1;
      const corte = i.corteInicio ?? 0;
      const precisa = i.duracao * vel;
      if (corte + precisa <= D + MARGEM) continue;
      const novo = arred(D - precisa);
      if (novo === corte) continue;
      i.corteInicio = novo;
      mudancas.push({ id: i.id, arquivo: i.arquivo, de: corte, para: novo, falta: Math.max(0, precisa - D) });
    }
  }
  return mudancas;
}
