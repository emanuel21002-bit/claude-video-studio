import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarVoz, calcularSegmentos, montarFiltro, pausaCortavel, reducaoDeRuido, PADRAO, TAXA_ANALISE } from '../src/main/decupar-nucleo.mjs';

const R = TAXA_ANALISE;
let semente = 1;
const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;

// "Voz": tom de 140 Hz com harmônicos (periódico), com envelope de sílabas.
function voz(seg, amp = 0.2) {
  const n = Math.round(seg * R);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / R;
    const silaba = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * 140 * h * t) / h;
    x[i] = amp * silaba * s * 0.5;
  }
  return x;
}

function montar(partes) {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const x = new Float32Array(total);
  let o = 0;
  for (const p of partes) x.set(p, (o += p.length) - p.length);
  return x;
}

const vazio = (seg) => new Float32Array(Math.round(seg * R));
const somarRuido = (x, amp) => {
  for (let i = 0; i < x.length; i++) x[i] += amp * rnd();
  return x;
};
const dentro = (silencios, t) => silencios.some((s) => t >= s.inicio && t < s.fim);

test('acha as pausas mesmo com ruído de fundo forte', () => {
  // 1 s fala, 0,8 s pausa, 1 s fala, 0,8 s pausa, 1 s fala — com chiado branco por cima de tudo.
  const x = somarRuido(montar([voz(1), vazio(0.8), voz(1), vazio(0.8), voz(1)]), 0.1);
  const r = analisarVoz(x, R);
  assert.ok(r.ruido > -40, `ruído medido ${r.ruido}`);
  for (const t of [1.4, 3.2]) assert.ok(dentro(r.silencios, t), `pausa em ${t} s não achada`);
  for (const t of [0.5, 2.3, 4.1]) assert.ok(!dentro(r.silencios, t), `fala em ${t} s virou silêncio`);
});

test('um limiar fixo de -35 dB não acharia essas pausas', () => {
  // O chiado sozinho passa de -35 dB: é o caso em que o silencedetect antigo não cortava nada.
  const so = somarRuido(vazio(1), 0.1);
  const rms = Math.sqrt(so.reduce((s, v) => s + v * v, 0) / so.length);
  assert.ok(20 * Math.log10(rms) > -35);
});

test('clique, batida e respiração nas pausas são ruído, não fala', () => {
  const pausa = () => vazio(0.8);
  const clique = pausa();
  for (let i = 0; i < 30; i++) clique[3000 + i] = 0.6 * Math.sign(rnd());
  const respiro = pausa();
  let y = 0;
  for (let i = 0; i < 0.3 * R; i++) {
    y = 0.8 * y + 0.2 * rnd();
    respiro[1000 + i] = 0.5 * y * Math.sin((Math.PI * i) / (0.3 * R));
  }
  const x = somarRuido(montar([voz(1), clique, voz(1), respiro, voz(1)]), 0.005);
  const r = analisarVoz(x, R);
  assert.ok(r.ruidos >= 2, `ruídos descartados: ${r.ruidos}`);
  assert.ok(dentro(r.silencios, 1.4), 'o clique virou fala');
  assert.ok(dentro(r.silencios, 3.0), 'a respiração virou fala');
});

test('modo manual usa o limiar dado', () => {
  const x = montar([voz(1, 0.01), vazio(0.8), voz(1)]);
  // A primeira fala é baixa (~ -45 dB): com limiar -30 ela some; no automático, fica.
  assert.ok(dentro(analisarVoz(x, R, { automatico: false, limiar: -30 }).silencios, 0.5));
  assert.ok(!dentro(analisarVoz(x, R).silencios, 0.5));
});

test('palavra curta cresce para dentro do silêncio em vez de manter a pausa', () => {
  const o = { ...PADRAO, pausa: 0.05, sobreposicao: 0.2 };
  // fala 0–2 s, palavra de 0,2 s em 3 s, fala 4–6 s
  const segs = calcularSegmentos(
    [
      { inicio: 2, fim: 3 },
      { inicio: 3.2, fim: 4 },
    ],
    6,
    o,
  );
  assert.equal(segs.length, 3, 'a palavra curta foi juntada com a vizinha');
  for (const [a, b] of segs) assert.ok(b - a >= 2 * o.sobreposicao + 0.1 - 1e-9);
});

test('redução de ruído acompanha o fundo medido', () => {
  assert.equal(reducaoDeRuido(undefined, undefined), 'afftdn=nr=12:nf=-40');
  assert.match(reducaoDeRuido(-36, -14), /nr=17:nf=-36:tn=1/);
  assert.match(reducaoDeRuido(-90, -14), /nf=-80/);
});

// Regras medidas nas emendas feitas à mão no CapCut: pausa a partir de ~0,15 s sai; menor, só no fim de frase.
test('pausa curta é cortada e a emenda sobrepõe menos, para não comer fala', () => {
  const o = { ...PADRAO };
  const segs = calcularSegmentos([{ inicio: 2, fim: 2.18 }, { inicio: 5, fim: 6 }], 8, o);
  assert.equal(segs.length, 3);
  assert.equal(segs.sobreposicoes.length, 2);
  // Pausa de 0,18 s: fica inteira (0,09 de cada lado) e a emenda sobrepõe 0,13, sobrando o respiro de 0,05.
  assert.ok(Math.abs(segs[0][1] - 2.09) < 1e-9 && Math.abs(segs[1][0] - 2.09) < 1e-9);
  assert.ok(Math.abs(segs.sobreposicoes[0] - 0.13) < 1e-9);
  assert.equal(segs.sobreposicoes[1], o.sobreposicao);
  const filtro = montarFiltro(segs, o);
  assert.match(filtro, /acrossfade=d=0\.13:/);
  assert.match(filtro, /acrossfade=d=0\.2:/);
});

test('pausa entre palavras fica; a mesma pausa no fim de frase sai', () => {
  const o = { ...PADRAO };
  assert.equal(pausaCortavel({ inicio: 1, fim: 1.08 }, o), false);
  assert.equal(pausaCortavel({ inicio: 1, fim: 1.12, antes: -6 }, o), false, 'voz ainda forte: pausa entre palavras');
  assert.equal(pausaCortavel({ inicio: 1, fim: 1.12, antes: -18 }, o), true, 'voz caindo: fim de frase');
  assert.equal(pausaCortavel({ inicio: 1, fim: 1.16 }, o), true);
  assert.equal(calcularSegmentos([{ inicio: 1, fim: 1.08 }], 3, o).length, 1);
});

test('cada silêncio leva o nível de antes dele, e fala que cai marca o fim de frase', () => {
  // Fala forte, depois a mesma fala baixando (fim de frase), pausa de 0,5 s, fala.
  const caindo = voz(0.4, 0.2).map((v, i, x) => v * (1 - i / x.length) ** 2);
  const x = montar([voz(1), caindo, vazio(0.5), voz(1)]);
  const r = analisarVoz(x, R, PADRAO);
  const meio = r.silencios.find((s) => s.inicio > 0.5 && s.fim < 2.5);
  assert.ok(meio, 'a pausa do meio não foi achada');
  assert.ok(Number.isFinite(meio.antes) && meio.antes < -6, `nível antes da pausa: ${meio.antes}`);
});
