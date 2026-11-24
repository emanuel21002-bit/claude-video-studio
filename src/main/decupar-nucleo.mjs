// Cálculo puro da decupagem de narração (sem Electron): onde cortar e qual filtro do ffmpeg monta o resultado.
//
// O estilo é o do corte de narração no CapCut: tira as pausas deixando só um respiro curto e sobrepõe as emendas,
// cada trecho começando um pouco antes de o anterior terminar, para a fala não ficar travada nem robotizada.

export const PADRAO = {
  automatico: true, // mede o ruído de fundo e acha a voz sozinho (ver analisarVoz); false usa `limiar`
  limiar: -35, // modo manual: dB abaixo dos quais é silêncio
  pausa: 0.05, // respiro que sobra entre as falas, em segundos
  sobreposicao: 0.2, // quanto um trecho entra no outro, em segundos (6 frames a 30 fps)
  velocidade: 1.2,
  aprimorar: true,
  normalizar: true,
  ganho: 4, // dB depois da normalização
};

// ---------- detecção de voz ----------
//
// Um limiar fixo em dB falha com ruído: se o fundo passa do limiar, nenhuma pausa é achada; se um barulho solto
// (clique, batida, respiração, carro) passa, ele vira "fala". Aqui a análise roda sobre o áudio mono a 8 kHz,
// já filtrado na faixa da voz (100 a 3800 Hz) pelo ffmpeg:
//   1. energia em quadros de 10 ms; o ruído de fundo é o percentil baixo e a voz, o alto;
//   2. o limiar sai do meio entre os dois (com histerese: entra acima do alto, segue até cair do baixo);
//   3. cada trecho com energia só conta como fala se tiver voz de verdade: som periódico (cordas vocais),
//      medido pela autocorrelação na faixa do tom de voz (60 a 400 Hz). Ruído, sopro e clique não são periódicos.
// Consoantes como "s" e "f" não são periódicas, mas ficam dentro do trecho da palavra, que tem vogais.

export const TAXA_ANALISE = 8000;
const PASSO = 0.01; // s entre quadros
const JANELA = 256; // amostras (32 ms a 8 kHz)

function percentil(ordenado, p) {
  if (!ordenado.length) return -100;
  return ordenado[Math.min(ordenado.length - 1, Math.max(0, Math.floor(p * (ordenado.length - 1))))];
}

// Força da periodicidade de um quadro: pico da autocorrelação normalizada entre 60 e 400 Hz (0 a 1).
function periodicidade(x, ini, taxa) {
  const n = JANELA;
  const lagMin = Math.floor(taxa / 400);
  const lagMax = Math.min(n - 32, Math.ceil(taxa / 60));
  let melhor = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = ini, f = ini + n - lag; i < f; i++) {
      const a = x[i], b = x[i + lag];
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    const r = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    if (r > melhor) melhor = r;
  }
  return melhor;
}

// amostras: Float32Array mono. Devolve { silencios, ruido, voz, limiar, ruidos } — ruido/voz/limiar em dBFS,
// ruidos = quantos trechos com som foram descartados por não terem voz.
export function analisarVoz(amostras, taxa = TAXA_ANALISE, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes };
  const passo = Math.round(PASSO * taxa);
  const total = amostras.length;
  const duracao = total / taxa;
  const nq = Math.max(0, Math.floor((total - JANELA) / passo) + 1);
  if (nq < 3) return { silencios: [], ruido: -100, voz: -100, limiar: -100, ruidos: 0 };

  const db = new Float32Array(nq);
  for (let q = 0; q < nq; q++) {
    let soma = 0;
    for (let i = q * passo, f = i + JANELA; i < f; i++) soma += amostras[i] * amostras[i];
    db[q] = 10 * Math.log10(soma / JANELA + 1e-12);
  }
  // Suaviza 30 ms para uma sílaba não picotar.
  const suave = new Float32Array(nq);
  for (let q = 0; q < nq; q++) suave[q] = (db[Math.max(0, q - 1)] + db[q] + db[Math.min(nq - 1, q + 1)]) / 3;

  const ordenado = Array.from(suave).sort((a, b) => a - b);
  const ruido = percentil(ordenado, 0.1);
  const voz = percentil(ordenado, 0.95);
  let baixo, alto;
  if (o.automatico === false) {
    baixo = o.limiar;
    alto = o.limiar + 6;
  } else {
    const faixa = Math.max(0, voz - ruido);
    // Em gravação muito limpa o fundo é quase silêncio digital; abaixo de 35 dB da voz nada é audível, e um limiar
    // tão baixo emendaria a cauda da fala na respiração seguinte.
    baixo = Math.max(voz - 35, ruido + Math.max(3, 0.3 * faixa));
    alto = Math.min(voz - 3, Math.max(voz - 28, ruido + Math.max(6, 0.5 * faixa)));
    if (alto < baixo) alto = baixo;
  }

  // Núcleo de fala: quadro forte (acima de `alto`) ou com voz periódica um pouco acima do ruído. A periodicidade
  // salva sílabas baixas que, no meio do ruído, ficariam abaixo do limiar de energia.
  const per = new Float32Array(nq);
  const nucleo = new Uint8Array(nq);
  const pisoVoz = o.automatico === false ? baixo : Math.max(ruido + 3, baixo - 6);
  for (let q = 0; q < nq; q++) {
    if (suave[q] < pisoVoz) continue;
    per[q] = periodicidade(amostras, q * passo, taxa);
    if (suave[q] >= alto || per[q] >= 0.5) nucleo[q] = 1;
  }
  // Trecho: quadros acima de `baixo` ou de núcleo, encostados, com ao menos um núcleo. Vãos de até 60 ms
  // dentro da fala (oclusivas como "p", "t") não separam trechos.
  const dentro = (q) => nucleo[q] || suave[q] >= baixo;
  const emenda = Math.round(0.06 / PASSO);
  const trechos = [];
  for (let q = 0; q < nq; ) {
    if (!dentro(q)) {
      q++;
      continue;
    }
    let f = q;
    let tem = false;
    for (;;) {
      for (; f < nq && dentro(f); f++) if (nucleo[f]) tem = true;
      let g = f;
      while (g < nq && g - f <= emenda && !dentro(g)) g++;
      if (g < nq && g - f <= emenda && dentro(g)) f = g;
      else break;
    }
    if (tem) trechos.push([q, f]);
    q = f;
  }

  // Só fica o que tem voz: ao menos 40 ms de quadros periódicos e 80 ms de duração. O resto é ruído solto
  // (clique, batida, respiração, sopro).
  const minVoz = Math.ceil(0.04 / PASSO);
  const minDur = Math.ceil(0.08 / PASSO);
  const falas = [];
  let ruidos = 0;
  for (const [a, b] of trechos) {
    let vozeados = 0;
    if (b - a >= minDur) for (let q = a; q < b; q++) if (per[q] >= 0.55) vozeados++;
    if (vozeados >= minVoz) falas.push([a, b]);
    else ruidos++;
  }

  // Tempo de cada quadro = centro da janela.
  const t = (q) => Math.min(duracao, Math.max(0, (q * passo + JANELA / 2) / taxa));
  const silencios = [];
  let fimAnterior = 0;
  for (const [a, b] of falas) {
    const ini = t(a) - PASSO;
    if (ini > fimAnterior) silencios.push({ inicio: fimAnterior, fim: ini });
    fimAnterior = t(b) + PASSO;
  }
  if (!falas.length) silencios.push({ inicio: 0, fim: duracao });
  else if (fimAnterior < duracao) silencios.push({ inicio: fimAnterior, fim: duracao });
  const r1 = (x) => Math.round(x * 10) / 10;
  return { silencios, ruido: r1(ruido), voz: r1(voz), limiar: r1(baixo), ruidos };
}

// Lê a saída do silencedetect e devolve [{ inicio, fim }].
export function lerSilencios(linhas, duracao) {
  const silencios = [];
  let inicio = null;
  for (const l of linhas) {
    const ini = l.match(/silence_start:\s*(-?[\d.]+)/);
    if (ini) inicio = Math.max(0, Number(ini[1]));
    const fim = l.match(/silence_end:\s*(-?[\d.]+)/);
    if (fim && inicio != null) {
      silencios.push({ inicio, fim: Number(fim[1]) });
      inicio = null;
    }
  }
  if (inicio != null) silencios.push({ inicio, fim: duracao });
  return silencios;
}

// Cada pausa cortada deixa `pad` de cada lado; na emenda os dois `pad` se sobrepõem em `sobreposicao`,
// então o respiro que sobra é 2*pad - sobreposicao (= `pausa`). Pausas menores que 2*pad ficam como estão.
export function padDe({ pausa, sobreposicao }) {
  return (pausa + sobreposicao) / 2;
}

export function calcularSegmentos(silencios, duracao, opcoes) {
  const pad = padDe(opcoes);
  const cortes = silencios.filter((s) => s.fim - s.inicio >= 2 * pad && s.fim > s.inicio);
  const falas = [];
  let a = 0;
  for (const c of cortes) {
    if (c.inicio > a + 0.001) falas.push([a, c.inicio]);
    a = c.fim;
  }
  if (duracao > a + 0.001) falas.push([a, duracao]);
  let segs = falas.map(([x, y]) => [Math.max(0, x - pad), Math.min(duracao, y + pad)]);
  if (!segs.length) segs = [[0, duracao]];
  // Trecho curto demais não aguenta a sobreposição (uma palavra solta, "é", "tá"). Primeiro ele cresce para dentro
  // do silêncio em volta; só se não houver espaço é juntado com o vizinho, mantendo a pausa que havia entre eles.
  const minimo = 2 * opcoes.sobreposicao + 0.1;
  for (let i = 0; i < segs.length && segs.length > 1; ) {
    const falta = minimo - (segs[i][1] - segs[i][0]);
    if (falta <= 0) {
      i++;
      continue;
    }
    const livreAntes = segs[i][0] - (i > 0 ? segs[i - 1][1] : 0);
    const livreDepois = (i < segs.length - 1 ? segs[i + 1][0] : duracao) - segs[i][1];
    if (livreAntes + livreDepois >= falta) {
      const antes = Math.min(livreAntes, Math.max(falta / 2, falta - livreDepois));
      segs[i] = [segs[i][0] - antes, segs[i][1] + (falta - antes)];
      i++;
      continue;
    }
    if (i < segs.length - 1) segs.splice(i, 2, [segs[i][0], segs[i + 1][1]]);
    else segs.splice(i - 1, 2, [segs[i - 1][0], segs[i][1]]);
  }
  return segs;
}

const n = (x) => Number(x.toFixed(3));

// Redução de ruído na medida do fundo medido: quanto menor a distância entre voz e ruído, mais forte.
// Sem medição, fica a leve de antes.
export function reducaoDeRuido(ruido, voz) {
  if (!Number.isFinite(ruido) || !Number.isFinite(voz)) return 'afftdn=nr=12:nf=-40';
  const snr = voz - ruido;
  const nr = Math.round(Math.min(30, Math.max(10, 12 + (30 - snr) * 0.6)));
  const nf = Math.round(Math.min(-20, Math.max(-80, ruido)));
  return `afftdn=nr=${nr}:nf=${nf}:tn=1`;
}

// Script de filtro: corta os trechos, emenda com acrossfade (curva de potência igual) e aplica velocidade, voz e volume.
export function montarFiltro(segs, opcoes) {
  const o = { ...PADRAO, ...opcoes };
  const linhas = [];
  const N = segs.length;
  if (N === 1) linhas.push(`[0:a]atrim=start=${n(segs[0][0])}:end=${n(segs[0][1])},asetpts=PTS-STARTPTS[x]`);
  else {
    linhas.push(`[0:a]asplit=${N}${segs.map((_, i) => `[s${i}]`).join('')}`);
    segs.forEach(([a, b], i) => linhas.push(`[s${i}]atrim=start=${n(a)}:end=${n(b)},asetpts=PTS-STARTPTS[t${i}]`));
    let atual = 't0';
    for (let i = 1; i < N; i++) {
      const saida = i === N - 1 ? 'x' : `x${i}`;
      linhas.push(`[${atual}][t${i}]acrossfade=d=${o.sobreposicao}:c1=qsin:c2=qsin[${saida}]`);
      atual = saida;
    }
  }
  const pos = [];
  if (o.velocidade && o.velocidade !== 1) pos.push(`atempo=${o.velocidade}`);
  if (o.aprimorar) pos.push('highpass=f=80', reducaoDeRuido(o.ruidoMedido, o.vozMedida), 'acompressor=threshold=-18dB:ratio=3:attack=5:release=80');
  if (o.normalizar) pos.push('loudnorm=I=-16:TP=-1.5:LRA=11', `volume=${o.ganho}dB`, 'alimiter=limit=0.97');
  pos.push('aresample=48000');
  linhas.push(`[x]${pos.join(',')}[saida]`);
  return linhas.join(';\n');
}
