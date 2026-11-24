// Leva a transcrição de cada arquivo para o tempo da timeline, respeitando o corte e a velocidade de cada clipe.
// itens: [{ id, arquivo, inicio, duracao, corteInicio, velocidade }]; transcricoes: { arquivo: { segmentos, palavras } } (segundos do arquivo).
export function transcricaoDaTimeline(itens, transcricoes) {
  const segmentos = [];
  const palavras = [];
  for (const i of [...itens].sort((a, b) => a.inicio - b.inicio)) {
    const t = transcricoes[i.arquivo];
    if (!t) continue;
    const corte = i.corteInicio ?? 0;
    const vel = i.velocidade ?? 1;
    const fimClipe = i.inicio + i.duracao;
    const dentro = (x) => x >= corte && x < corte + i.duracao * vel;
    const noTempo = (x) => i.inicio + (x - corte) / vel;
    for (const s of t.segmentos ?? []) {
      if (dentro(s.inicio)) segmentos.push({ inicio: noTempo(s.inicio), fim: Math.min(fimClipe, noTempo(s.fim)), texto: s.texto, arquivo: i.arquivo, item: i.id });
    }
    for (const w of t.palavras ?? []) {
      if (dentro(w.inicio)) palavras.push({ inicio: noTempo(w.inicio), fim: Math.min(fimClipe, noTempo(w.fim)), texto: w.texto });
    }
  }
  const porInicio = (a, b) => a.inicio - b.inicio;
  return { segmentos: segmentos.sort(porInicio), palavras: palavras.sort(porInicio) };
}
