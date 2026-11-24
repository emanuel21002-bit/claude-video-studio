import test from 'node:test';
import assert from 'node:assert/strict';
import { transcricaoDaTimeline } from '../src/main/transcricao-nucleo-timeline.mjs';

const arquivo = { segmentos: [{ inicio: 0, fim: 4, texto: 'primeira' }, { inicio: 10, fim: 14, texto: 'segunda' }], palavras: [{ inicio: 10, fim: 10.5, texto: 'segunda' }] };

test('o trecho usado do arquivo vai para o tempo do clipe na timeline', () => {
  // Clipe começa em 20 s na timeline e mostra o arquivo a partir de 10 s.
  const r = transcricaoDaTimeline([{ id: 'a', arquivo: 'v.mp4', inicio: 20, duracao: 5, corteInicio: 10 }], { 'v.mp4': arquivo });
  assert.deepEqual(r.segmentos.map((s) => [s.texto, s.inicio, s.fim]), [['segunda', 20, 24]]);
  assert.equal(r.palavras[0].inicio, 20);
});

test('a velocidade encurta os tempos e o fim não passa do clipe', () => {
  const r = transcricaoDaTimeline([{ id: 'a', arquivo: 'v.mp4', inicio: 0, duracao: 2, corteInicio: 10, velocidade: 2 }], { 'v.mp4': arquivo });
  assert.equal(r.segmentos[0].inicio, 0);
  assert.equal(r.segmentos[0].fim, 2);
});

test('o que ficou de fora do corte não aparece, e os clipes saem em ordem', () => {
  const r = transcricaoDaTimeline(
    [{ id: 'b', arquivo: 'v.mp4', inicio: 30, duracao: 4 }, { id: 'a', arquivo: 'v.mp4', inicio: 0, duracao: 4, corteInicio: 10 }],
    { 'v.mp4': arquivo },
  );
  assert.deepEqual(r.segmentos.map((s) => [s.texto, s.inicio]), [['segunda', 0], ['primeira', 30]]);
});

test('arquivo sem transcrição é ignorado', () => {
  assert.equal(transcricaoDaTimeline([{ id: 'a', arquivo: 'x.mp4', inicio: 0, duracao: 4 }], {}).segmentos.length, 0);
});
