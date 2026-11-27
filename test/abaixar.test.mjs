import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intervalosDeVoz, ganhoAbaixado, expressaoAbaixar } from '../src/main/abaixar-nucleo.mjs';

const t = {
  trilhas: [
    { tipo: 'video', itens: [{ tipo: 'video', inicio: 0, duracao: 10, volume: 0 }] },
    { tipo: 'audio', itens: [
      { tipo: 'audio', inicio: 1, duracao: 3 },
      { tipo: 'audio', inicio: 4.2, duracao: 2 },
      { tipo: 'audio', inicio: 8, duracao: 0.8 },
    ] },
    { tipo: 'audio', itens: [{ tipo: 'audio', inicio: 0, duracao: 10, volume: 0.15, abaixar: 0.3 }] },
  ],
};

test('voz junta pausas curtas e ignora efeitos, vídeo mudo e a própria música', () => {
  assert.deepEqual(intervalosDeVoz(t), [[1, 6.2]]);
});

test('faixa silenciada não conta como voz', () => {
  const m = structuredClone(t);
  m.trilhas[1].muda = true;
  assert.deepEqual(intervalosDeVoz(m), []);
});

test('ganho desce na voz, com rampa, e volta depois', () => {
  const v = intervalosDeVoz(t);
  assert.equal(ganhoAbaixado(v, 0, 0.3), 1);
  assert.ok(Math.abs(ganhoAbaixado(v, 3, 0.3) - 0.3) < 1e-9);
  assert.ok(Math.abs(ganhoAbaixado(v, 0.85, 0.3) - 0.65) < 1e-9);
  assert.equal(ganhoAbaixado(v, 7, 0.3), 1);
});

test('expressão do ffmpeg usa o tempo do item e some sem voz', () => {
  const v = intervalosDeVoz(t);
  const e = expressaoAbaixar(v, 0, 10, 0.3);
  assert.match(e, /^1-0\.7\*clip\(\(t-\(0\.7\)\)\/0\.3,0,1\)\*clip\(\(\(6\.5\)-t\)\/0\.3,0,1\)$/);
  assert.equal(expressaoAbaixar(v, 7, 2, 0.3), null);
});
