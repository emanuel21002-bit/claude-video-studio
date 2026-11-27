import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achatarAninhadas, itensProfundos, aninhadaSimples, recortarItem } from '../src/main/aninhada-nucleo.mjs';

const aninhada = (extra = {}) => ({
  id: 'n1', tipo: 'aninhada', nome: 'Gancho', inicio: 10, duracao: 4, corteInicio: 1,
  trilhas: [
    { id: 'v', tipo: 'video', itens: [{ id: 'a', tipo: 'video', arquivo: 'a.mp4', inicio: 0, duracao: 3, corteInicio: 2 }, { id: 'b', tipo: 'texto', texto: 'oi', inicio: 3, duracao: 3 }] },
    { id: 's', tipo: 'audio', itens: [{ id: 'c', tipo: 'audio', arquivo: 'c.mp3', inicio: 0.5, duracao: 1 }] },
  ],
  ...extra,
});
const t = (n) => ({ fps: 30, trilhas: [{ id: 'V1', tipo: 'video', itens: [{ id: 'x', tipo: 'video', arquivo: 'x.mp4', inicio: 0, duracao: 10 }] }, { id: 'V2', tipo: 'video', itens: [n] }, { id: 'A1', tipo: 'audio', itens: [] }] });

test('desmonta a aninhada simples no lugar dela, recortada pelo corte de dentro', () => {
  const r = achatarAninhadas(t(aninhada()));
  assert.deepEqual(r.trilhas.map((tr) => tr.id), ['V1', 'V2', 'n1~v', 'A1', 'n1~s']);
  const [a, b] = r.trilhas[2].itens;
  assert.deepEqual([a.inicio, a.duracao, a.corteInicio], [10, 2, 3]);
  assert.deepEqual([b.inicio, b.duracao], [12, 2]);
  assert.deepEqual([r.trilhas[4].itens[0].inicio, r.trilhas[4].itens[0].duracao], [10, 0.5]);
  assert.equal(r.trilhas[1].itens.length, 0);
});

test('com movimento só desmonta quando pedido, e avisa', () => {
  const comEscala = t(aninhada({ escala: 1.2 }));
  assert.equal(aninhadaSimples(comEscala.trilhas[1].itens[0]), false);
  assert.equal(achatarAninhadas(comEscala).trilhas[1].itens[0].tipo, 'aninhada');
  const avisos = [];
  achatarAninhadas(comEscala, { todas: true, avisos });
  assert.equal(avisos.length, 1);
});

test('acha os arquivos de dentro e recorta legenda e keyframes', () => {
  assert.deepEqual(itensProfundos(t(aninhada())).map((i) => i.id), ['x', 'n1', 'a', 'b', 'c']);
  const r = recortarItem({ id: 'l', tipo: 'legenda', inicio: 0, duracao: 4, palavras: [{ texto: 'a', inicio: 0, fim: 1 }, { texto: 'b', inicio: 2, fim: 3 }], keyframes: { x: [{ t: 2, v: 5 }] } }, 1.5, 4);
  assert.deepEqual(r.palavras.map((p) => [p.texto, p.inicio]), [['b', 0.5]]);
  assert.equal(r.keyframes.x[0].t, 0.5);
});
