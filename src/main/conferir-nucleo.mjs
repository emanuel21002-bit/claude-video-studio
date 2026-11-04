// Compara o que foi dito num áudio (transcrição) com o roteiro, palavra por palavra (sem Electron).

const sem = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// [{ txt, k }]: txt como aparece, k sem acento, caixa e pontuação. Pedaços sem letra nem número somem.
export function palavras(texto) {
  const lista = [];
  for (const txt of texto.split(/\s+/)) {
    const k = sem(txt).replace(/[^a-z0-9]+/g, '');
    if (k) lista.push({ txt: txt.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || txt, k });
  }
  return lista;
}

// Distância de edição curta: grafias que o Whisper erra por uma letra contam como "quase".
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = cur;
  }
  return ant[b.length];
}

const LIMITE_CELULAS = 60_000_000;

// Alinhamento semi-global: o áudio inteiro contra o trecho do roteiro que melhor combina (o resto do roteiro é livre).
// Devolve { ops, inicio, fim } com ops = [{ t: 'ok'|'quase'|'troca'|'extra'|'falta', r, o }].
// r = palavra do roteiro, o = palavra ouvida; inicio/fim = faixa de palavras do roteiro usada.
export function alinhar(ouvido, roteiro) {
  const n = ouvido.length;
  const m = roteiro.length;
  if ((n + 1) * (m + 1) > LIMITE_CELULAS) throw new Error('Áudio e roteiro grandes demais para conferir juntos.');
  const W = m + 1;
  const custo = new Float32Array((n + 1) * W);
  const via = new Uint8Array((n + 1) * W); // 1 diagonal, 2 sobra (só no áudio), 3 falta (só no roteiro), 0 início livre
  for (let i = 1; i <= n; i++) {
    custo[i * W] = i;
    via[i * W] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const a = ouvido[i - 1].k;
      const b = roteiro[j - 1].k;
      const sub = a === b ? 0 : a.length >= 4 && b.length >= 4 && distancia(a, b) <= 1 ? 0.3 : 1;
      let melhor = custo[(i - 1) * W + j - 1] + sub;
      let v = 1;
      const sobra = custo[(i - 1) * W + j] + 1;
      if (sobra < melhor) {
        melhor = sobra;
        v = 2;
      }
      const falta = custo[i * W + j - 1] + 1;
      if (falta < melhor) {
        melhor = falta;
        v = 3;
      }
      custo[i * W + j] = melhor;
      via[i * W + j] = v;
    }
  }
  let fim = 0;
  for (let j = 1; j <= m; j++) if (custo[n * W + j] < custo[n * W + fim]) fim = j;
  const ops = [];
  let i = n;
  let j = fim;
  while (i > 0) {
    const v = j === 0 ? 2 : via[i * W + j];
    if (v === 1) {
      const a = ouvido[i - 1];
      const b = roteiro[j - 1];
      ops.push({ t: a.k === b.k ? 'ok' : custo[i * W + j] - custo[(i - 1) * W + j - 1] < 0.5 ? 'quase' : 'troca', r: b.txt, o: a.txt });
      i--;
      j--;
    } else if (v === 2) {
      ops.push({ t: 'extra', o: ouvido[i - 1].txt });
      i--;
    } else {
      ops.push({ t: 'falta', r: roteiro[j - 1].txt });
      j--;
    }
  }
  const inicio = j;
  ops.reverse();
  return { ops, inicio, fim };
}

export function conferir(textoOuvido, textoRoteiro) {
  const ouvido = palavras(textoOuvido);
  const roteiro = palavras(textoRoteiro);
  if (!ouvido.length) return { vazio: true, ouvidas: 0 };
  const { ops, inicio, fim } = alinhar(ouvido, roteiro);
  const cont = (t) => ops.filter((x) => x.t === t).length;
  const ok = cont('ok') + cont('quase');
  const trecho = fim - inicio;
  return {
    ouvidas: ouvido.length,
    trecho,
    inicio,
    fim,
    ok,
    trocas: cont('troca'),
    sobras: cont('extra'),
    faltas: cont('falta'),
    // 100% = o áudio diz exatamente o trecho do roteiro; sobra e falta descontam igual.
    acerto: Math.round((100 * ok) / Math.max(ouvido.length, trecho, 1)),
    ops,
  };
}

// Palavras do roteiro que nenhum áudio cobriu, em blocos seguidos.
export function trechosSemAudio(textoRoteiro, faixas, minimo = 4) {
  const roteiro = palavras(textoRoteiro);
  const coberta = new Uint8Array(roteiro.length);
  for (const [a, b] of faixas) for (let j = a; j < b; j++) coberta[j] = 1;
  const blocos = [];
  let ini = null;
  for (let j = 0; j <= roteiro.length; j++) {
    if (j < roteiro.length && !coberta[j]) ini ??= j;
    else if (ini != null) {
      if (j - ini >= minimo) blocos.push(roteiro.slice(ini, j).map((p) => p.txt).join(' '));
      ini = null;
    }
  }
  return { blocos, total: roteiro.length, cobertas: coberta.reduce((s, x) => s + x, 0) };
}
