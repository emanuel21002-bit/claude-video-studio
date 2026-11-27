// Música que abaixa sozinha sob a voz (ducking), como o "Ducking" do Premiere e o "Abaixar volume" do CapCut.
// Um item de áudio com "abaixar" (0 a 1) toca nesse volume enquanto houver voz; fora dela, no volume normal.
// Voz: qualquer outro som longo da timeline (narração, fala do vídeo). Sons curtos (whoosh, pop) não contam.
// A mesma conta está em modelo-timeline/TimelineVideo.tsx (prévia e render do Remotion).

export const VOZ_MINIMA = 1.5; // s: abaixo disso é efeito sonoro
export const JUNTAR = 0.5; // s: pausas menores que isso não deixam a música subir (não fica "bombeando")
export const RAMPA = 0.3; // s para descer e para subir

// [[início, fim], ...] em segundos da timeline, ordenados e já unidos.
export function intervalosDeVoz(t) {
  const brutos = [];
  for (const tr of t?.trilhas ?? []) {
    const audio = tr.tipo === 'audio';
    if (audio ? tr.muda : tr.oculta) continue;
    for (const i of tr.itens ?? []) {
      if (i.desativado || i.abaixar != null || !(i.duracao >= VOZ_MINIMA)) continue;
      const vol = i.tipo === 'audio' ? i.volume ?? 1 : i.tipo === 'video' ? i.volume ?? 0 : 0;
      if (vol > 0.05) brutos.push([i.inicio, i.inicio + i.duracao]);
    }
  }
  brutos.sort((a, b) => a[0] - b[0]);
  const juntos = [];
  for (const [a, b] of brutos) {
    const ultimo = juntos.at(-1);
    if (ultimo && a - ultimo[1] < JUNTAR) ultimo[1] = Math.max(ultimo[1], b);
    else juntos.push([a, b]);
  }
  return juntos;
}

const prender = (x) => Math.max(0, Math.min(1, x));

// Ganho (0 a 1) no segundo T da timeline.
export function ganhoAbaixado(vozes, T, nivel) {
  let w = 0;
  for (const [a, b] of vozes) {
    if (a - RAMPA > T) break;
    w = Math.max(w, prender((T - (a - RAMPA)) / RAMPA) * prender((b + RAMPA - T) / RAMPA));
  }
  return 1 - (1 - nivel) * w;
}

const n = (x) => Number(x.toFixed(4));

// Expressão do filtro volume do ffmpeg (eval=frame) para um item que começa em ini e dura total: t é o tempo do item.
// null quando nenhuma voz cruza o item.
export function expressaoAbaixar(vozes, ini, total, nivel) {
  const termos = vozes
    .filter(([a, b]) => a - RAMPA < ini + total && b + RAMPA > ini)
    .map(([a, b]) => `clip((t-(${n(a - RAMPA - ini)}))/${RAMPA},0,1)*clip(((${n(b + RAMPA - ini)})-t)/${RAMPA},0,1)`);
  if (!termos.length) return null;
  const max = termos.reduce((acc, x) => `max(${acc},${x})`);
  return `1-${n(1 - nivel)}*${max}`;
}
