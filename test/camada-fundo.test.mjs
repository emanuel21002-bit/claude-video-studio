import test from 'node:test';
import assert from 'node:assert/strict';
import { graficosDaParte, primeiraTrilhaComMidia, planoFfmpeg } from '../src/main/exportar-ffmpeg.mjs';
import { paraOtio } from '../src/main/otio.mjs';

// Como o vídeo 02 da Premium Detailers: um papel de fundo na primeira trilha (embaixo de tudo), os vídeos por cima,
// e pôsteres e legendas por cima dos vídeos.
const timeline = () => ({
  largura: 1080,
  altura: 1920,
  fps: 30,
  trilhas: [
    { id: 'papel', tipo: 'video', itens: [{ id: 'bg', tipo: 'bloco', componente: 'Papel', inicio: 0, duracao: 4 }] },
    { id: 'video', tipo: 'video', itens: [{ id: 'v1', tipo: 'video', arquivo: 'a.mov', inicio: 0, duracao: 4, corteInicio: 0 }] },
    { id: 'poster', tipo: 'video', itens: [{ id: 'p1', tipo: 'bloco', componente: 'Poster', inicio: 0, duracao: 2 }] },
    { id: 'legendas', tipo: 'video', itens: [{ id: 'l1', tipo: 'legenda', texto: 'oi', inicio: 0, duracao: 1 }] },
    { id: 'narracao', tipo: 'audio', itens: [{ id: 'n', tipo: 'audio', arquivo: 'n.mp3', inicio: 0, duracao: 4 }] },
  ],
});
const ids = (t) => t.trilhas.flatMap((tr) => tr.itens.map((i) => i.id));

test('gráfico abaixo dos vídeos vai para a camada de fundo, o resto para a de frente', () => {
  const t = timeline();
  assert.equal(primeiraTrilhaComMidia(t), 1);
  assert.deepEqual(ids(graficosDaParte(t, 'fundo')), ['bg']);
  assert.deepEqual(ids(graficosDaParte(t, 'frente')), ['p1', 'l1']);
});

test('sem vídeo nem imagem, tudo fica na frente', () => {
  const t = timeline();
  t.trilhas.splice(1, 1);
  assert.deepEqual(ids(graficosDaParte(t, 'fundo')), []);
  assert.deepEqual(ids(graficosDaParte(t, 'frente')), ['bg', 'p1', 'l1']);
});

test('trilha de vídeo oculta não conta como mídia', () => {
  const t = timeline();
  t.trilhas[1].oculta = true;
  assert.deepEqual(ids(graficosDaParte(t, 'fundo')), []);
});

test('modo rápido: o fundo entra antes dos vídeos e a frente depois', () => {
  const plano = planoFfmpeg(timeline(), {
    infos: { 'a.mov': { largura: 1080, altura: 1920 } },
    assets: 'C:/assets',
    camada: { arquivo: 'frente.mov', duracao: 4 },
    camadaFundo: { arquivo: 'fundo.mov', duracao: 4 },
    so: 'video',
  });
  const g = plano.grafo;
  const fundo = g.indexOf('[b0][camf]overlay');
  const video = g.search(/\[bf\]\[[^\]]+\]overlay/);
  const frente = g.indexOf('[cam]overlay');
  assert.ok(fundo >= 0, 'a camada de fundo não entrou');
  assert.ok(video > fundo, 'o vídeo não foi posto sobre o fundo');
  assert.ok(frente > video, 'a frente não ficou por cima do vídeo');
  assert.ok(plano.entradas.flat().includes('fundo.mov'));
});

test('Filmcraft: a camada de fundo é a primeira trilha (a de baixo) e a de frente a última de vídeo', () => {
  const { otio } = paraOtio(timeline(), { materiais: [] }, {
    assets: 'C:/assets',
    camada: { arquivo: 'C:/x/frente.mov', duracao: 4 },
    camadaFundo: { arquivo: 'C:/x/fundo.mov', duracao: 4 },
  });
  const videos = otio.tracks.children.filter((c) => c.kind === 'Video');
  assert.equal(videos[0].name, 'Camada Remotion · fundo');
  assert.equal(videos.at(-1).name, 'Camada Remotion');
});

// Círculo em "multiplicar" por cima do vídeo, como os do vídeo 02.
const comMultiplicar = () => {
  const t = timeline();
  t.trilhas.splice(2, 0, { id: 'graficos', tipo: 'video', itens: [{ id: 'c1', tipo: 'bloco', componente: 'Circulo', mesclagem: 'multiply', inicio: 0, duracao: 2 }, { id: 'c2', tipo: 'bloco', componente: 'Circulo', mesclagem: 'screen', inicio: 2, duracao: 1 }] });
  return t;
};

test('gráfico em multiplicar ou tela sai da frente e vai para a camada dele, sobre fundo neutro', () => {
  const t = comMultiplicar();
  const mult = graficosDaParte(t, 'multiplicar');
  const tela = graficosDaParte(t, 'tela');
  assert.deepEqual(ids(mult), ['c1']);
  assert.equal(mult.fundo, '#ffffff');
  assert.deepEqual(ids(tela), ['c2']);
  assert.equal(tela.fundo, '#000000');
  assert.deepEqual(ids(graficosDaParte(t, 'frente')), ['p1', 'l1']);
  assert.equal(graficosDaParte(t, 'frente').fundo, 'transparent');
});

test('modo rápido: a camada de multiplicar é misturada com blend multiply, antes da frente', () => {
  const g = planoFfmpeg(comMultiplicar(), {
    infos: { 'a.mov': { largura: 1080, altura: 1920 } },
    assets: 'C:/assets',
    camada: { arquivo: 'frente.mov', duracao: 4 },
    camadasMescla: [{ arquivo: 'mult.mov', duracao: 2, modo: 'multiply' }],
    so: 'video',
  }).grafo;
  const mistura = g.indexOf('blend=all_mode=multiply:eof_action=pass');
  assert.ok(mistura >= 0);
  assert.ok(g.indexOf('[cam]overlay') > mistura, 'a frente tem de vir depois da mistura');
});

test('Filmcraft: a camada de multiplicar vai com a mesclagem multiplicar (3), abaixo da frente', () => {
  const { otio } = paraOtio(timeline(), { materiais: [] }, {
    assets: 'C:/assets',
    camada: { arquivo: 'C:/x/frente.mov', duracao: 4 },
    camadasMescla: [{ arquivo: 'C:/x/mult.mov', duracao: 2, modo: 'multiply' }],
  });
  const videos = otio.tracks.children.filter((c) => c.kind === 'Video');
  const k = videos.findIndex((v) => v.name === 'Camada Remotion · multiplicar');
  assert.equal(k, videos.length - 2);
  assert.match(JSON.stringify(videos[k]), /"blend":\{"value":\{"Choice":3\}\}/);
});
