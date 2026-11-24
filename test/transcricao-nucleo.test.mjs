import test from 'node:test';
import assert from 'node:assert/strict';
import { limparTranscricao, resumoDaFala } from '../src/main/transcricao-nucleo.mjs';

// Segmentos de 4 s com 12 palavras cada, um colado no outro a partir de `ini`.
const fala = (n, ini = 0) =>
  Array.from({ length: n }, (_, i) => ({ inicio: ini + i * 4, fim: ini + i * 4 + 4, texto: `trecho ${i} com doze palavras faladas pela pessoa na câmera agora mesmo ok` }));
const palavrasDe = (segs) => segs.flatMap((s) => s.texto.split(' ').map((t, k) => ({ texto: t, inicio: s.inicio + k * 0.3, fim: s.inicio + k * 0.3 + 0.25 })));
const com = (segmentos) => ({ segmentos, palavras: palavrasDe(segmentos) });

test('vídeo falado do começo ao fim é narração', () => {
  const r = resumoDaFala(com(fala(8)), 32);
  assert.equal(r.veredito, 'narracao');
  assert.ok(r.cobertura > 0.9);
});

test('duas frases num vídeo longo é fala curta', () => {
  const r = resumoDaFala(com(fala(2)), 60);
  assert.equal(r.veredito, 'fala-curta');
});

test('música: marcas e frases inventadas do Whisper não contam como fala', () => {
  const segs = [
    { inicio: 0, fim: 5, texto: '[Música]' },
    { inicio: 5, fim: 10, texto: '♪' },
    { inicio: 10, fim: 15, texto: 'Legendas pela comunidade Amara.org' },
  ];
  const r = resumoDaFala(com(segs), 30);
  assert.equal(r.veredito, 'sem-fala');
  assert.equal(r.palavras, 0);
});

test('frase repetida em loop (alucinação) é descartada', () => {
  const rep = Array.from({ length: 5 }, (_, i) => ({ inicio: i * 3, fim: i * 3 + 3, texto: 'Tchau, tchau' }));
  assert.equal(limparTranscricao(com(rep)).segmentos.length, 0);
});

test('segmentos sobrepostos não passam de 100% do vídeo', () => {
  const segs = [{ inicio: 0, fim: 10, texto: 'um dois três quatro cinco seis sete oito nove dez onze doze' }, { inicio: 2, fim: 12, texto: 'treze catorze quinze dezesseis dezessete dezoito dezenove vinte' }];
  assert.ok(resumoDaFala(com(segs), 10).cobertura <= 1);
});
