// Compara o que foi dito num áudio (transcrição) com o roteiro, palavra por palavra (sem Electron).

const sem = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const chave = (txt) => sem(txt).replace(/[^a-z0-9]+/g, '');

// Para a legenda só saem aspas, parênteses e marcas de formatação: "R$", "%" e a pontuação fazem parte do que se lê.
const MARCAS = '"\'“”‘’()\\[\\]{}*_#<>«»';
const INICIO_MARCAS = new RegExp(`^[${MARCAS}\\-–—•]+`, 'u');
const MARCAS_FINAIS = new RegExp(`[${MARCAS}]+(?=[.,!?;:…]*[${MARCAS}]*$)`, 'gu');
const paraLegenda = (bruto) => bruto.replace(INICIO_MARCAS, '').replace(MARCAS_FINAIS, '');

// [{ txt, k, legenda }]: txt como aparece, k sem acento, caixa e pontuação, legenda = como escrever na tela.
// Pedaços sem letra nem número somem.
export function palavras(texto) {
  const lista = [];
  for (const bruto of texto.split(/\s+/)) {
    const k = chave(bruto);
    if (k) lista.push({ txt: bruto.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || bruto, k, legenda: paraLegenda(bruto) });
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
      ops.push({ t: a.k === b.k ? 'ok' : custo[i * W + j] - custo[(i - 1) * W + j - 1] < 0.5 ? 'quase' : 'troca', r: b.txt, o: a.txt, oi: i - 1, ri: j - 1 });
      i--;
      j--;
    } else if (v === 2) {
      ops.push({ t: 'extra', o: ouvido[i - 1].txt, oi: i - 1 });
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

// Abaixo disso o roteiro é de outro áudio, ou o locutor improvisou: melhor legendar o que foi dito.
const ACERTO_MINIMO = 50;
const casou = (op) => op?.t === 'ok' || op?.t === 'quase';

// Legendas: os tempos seguem o áudio; a grafia e a pontuação vêm do roteiro, onde ele e o áudio concordam.
// Uma palavra diferente só é trocada se estiver isolada entre palavras iguais (erro de transcrição, não fala mudada).
// O que está só no roteiro (indicação de cena, frase não gravada) não entra: legenda nenhuma sem fala.
export function corrigirPalavras(transcritas, textoRoteiro) {
  const ouvido = [];
  transcritas.forEach((w, idx) => {
    const k = chave(w.texto);
    if (k) ouvido.push({ txt: w.texto, k, idx });
  });
  const roteiro = palavras(textoRoteiro);
  if (!ouvido.length || !roteiro.length) return { usado: false, acerto: 0, palavras: transcritas };
  const { ops, inicio, fim } = alinhar(ouvido, roteiro);
  const iguais = ops.filter(casou).length;
  const acerto = Math.round((100 * iguais) / Math.max(ouvido.length, fim - inicio, 1));
  if (acerto < ACERTO_MINIMO) return { usado: false, acerto, palavras: transcritas };

  const saida = transcritas.map((w) => ({ ...w }));
  const removidas = new Set();
  const noAudio = (op) => saida[ouvido[op.oi].idx];
  // O Whisper às vezes parte uma palavra em duas ("vitro ficação"): as duas juntas parecem a do roteiro.
  const juntas = (a, b, r) => distancia(ouvido[a.oi].k + ouvido[b.oi].k, roteiro[r].k) <= 2;
  ops.forEach((op, n) => {
    if (casou(op)) noAudio(op).texto = roteiro[op.ri].legenda;
    if (op.t !== 'troca') return;
    const antes = ops[n - 1];
    const depois = ops[n + 1];
    if (depois?.t === 'extra' && juntas(op, depois, op.ri)) {
      noAudio(op).fim = noAudio(depois).fim;
      removidas.add(ouvido[depois.oi].idx);
    } else if (antes?.t === 'extra' && juntas(antes, op, op.ri)) {
      noAudio(op).inicio = noAudio(antes).inicio;
      removidas.add(ouvido[antes.oi].idx);
    } else if (!casou(antes) || !casou(depois)) return;
    noAudio(op).texto = roteiro[op.ri].legenda;
  });
  return { usado: true, acerto, inicio, fim, palavras: saida.filter((_, i) => !removidas.has(i)) };
}

// O trecho do roteiro que este áudio fala, para o Claude não precisar ler o roteiro inteiro.
export function trechoDoRoteiro(textoOuvido, textoRoteiro) {
  const r = conferir(textoOuvido, textoRoteiro);
  if (r.vazio || r.acerto < ACERTO_MINIMO) return null;
  return palavras(textoRoteiro).slice(r.inicio, r.fim).map((p) => p.legenda).join(' ');
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
