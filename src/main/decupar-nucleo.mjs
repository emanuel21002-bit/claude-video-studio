// Cálculo puro da decupagem de narração (sem Electron): onde cortar e qual filtro do ffmpeg monta o resultado.
//
// O estilo é o do corte de narração no CapCut: tira as pausas deixando só um respiro curto e sobrepõe as emendas,
// cada trecho começando um pouco antes de o anterior terminar, para a fala não ficar travada nem robotizada.

export const PADRAO = {
  limiar: -35, // dB abaixo dos quais é silêncio
  pausa: 0.15, // respiro que sobra entre as falas, em segundos
  sobreposicao: 0.2, // quanto um trecho entra no outro, em segundos (6 frames a 30 fps)
  velocidade: 1.2,
  aprimorar: true,
  normalizar: true,
  ganho: 4, // dB depois da normalização
};

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
  // Trecho curto demais não aguenta a sobreposição: junta com o vizinho, mantendo a pausa que havia entre eles.
  const minimo = 2 * opcoes.sobreposicao + 0.1;
  for (let i = 0; i < segs.length && segs.length > 1; ) {
    if (segs[i][1] - segs[i][0] >= minimo) {
      i++;
      continue;
    }
    if (i < segs.length - 1) segs.splice(i, 2, [segs[i][0], segs[i + 1][1]]);
    else segs.splice(i - 1, 2, [segs[i - 1][0], segs[i][1]]);
  }
  return segs;
}

const n = (x) => Number(x.toFixed(3));

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
  if (o.aprimorar) pos.push('highpass=f=80', 'afftdn=nr=12:nf=-40', 'acompressor=threshold=-18dB:ratio=3:attack=5:release=80');
  if (o.normalizar) pos.push('loudnorm=I=-16:TP=-1.5:LRA=11', `volume=${o.ganho}dB`, 'alimiter=limit=0.97');
  pos.push('aresample=48000');
  linhas.push(`[x]${pos.join(',')}[saida]`);
  return linhas.join(';\n');
}
