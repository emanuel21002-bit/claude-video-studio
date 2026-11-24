import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duracaoDaImagem, ajustarAoArquivo, ajustarAGrade } from '../src/main/limites-fonte.mjs';
import { planoFfmpeg } from '../src/main/exportar-ffmpeg.mjs';

test('duração da imagem: a do fluxo de vídeo, nunca maior que o contêiner, arredondada para baixo', () => {
  // iPhone: contêiner (por causa de áudio e metadados) mais longo que o vídeo.
  const iphone = { format: { duration: '55.217007' }, streams: [{ codec_type: 'video', duration: '55.200000' }, { codec_type: 'audio', duration: '55.217007' }] };
  assert.equal(duracaoDaImagem(iphone), 55.2);
  // 1,568333 s: antes virava 1,57 (para cima) e o corte até lá ficava sem quadro.
  const curto = { format: { duration: '1.568333' }, streams: [{ codec_type: 'video', duration: '1.568333' }] };
  assert.equal(duracaoDaImagem(curto, 2), 1.56);
  assert.equal(duracaoDaImagem(curto), 1.568);
  // Sem vídeo (áudio): a do contêiner.
  assert.equal(duracaoDaImagem({ format: { duration: '29.1' }, streams: [{ codec_type: 'audio', duration: '29.1' }] }), 29.1);
  assert.equal(duracaoDaImagem({ format: {}, streams: [] }), 0);
});

test('clipe que passa do fim do arquivo volta para dentro dele, no mesmo lugar e com a mesma duração', () => {
  const t = {
    trilhas: [
      {
        id: 'V1', tipo: 'video', itens: [
          // DED 03: arquivo de 1,568 s com corte em 2 s (o clipe inteiro sem imagem).
          { id: 'a', tipo: 'video', arquivo: 'img_0128.mov', inicio: 0, duracao: 1.5, corteInicio: 2 },
          // Passa 0,02 s (contêiner maior que o vídeo).
          { id: 'b', tipo: 'video', arquivo: 'cajuru.mov', inicio: 1.5, duracao: 55.22, corteInicio: 0 },
          // Dentro do arquivo: não muda.
          { id: 'c', tipo: 'video', arquivo: 'img_0127.mov', inicio: 56.72, duracao: 1.5, corteInicio: 1 },
          // 2x: precisa de 3 s de arquivo.
          { id: 'd', tipo: 'video', arquivo: 'img_0127.mov', inicio: 58.22, duracao: 1.5, corteInicio: 8, velocidade: 2 },
          // Arquivo ainda não lido: fica como está.
          { id: 'e', tipo: 'video', arquivo: 'novo.mov', inicio: 59.72, duracao: 1, corteInicio: 50 },
        ],
      },
      { id: 'A1', tipo: 'audio', itens: [{ id: 'n', tipo: 'audio', arquivo: 'n.mp3', inicio: 0, duracao: 99, corteInicio: 0 }] },
    ],
  };
  const dur = { 'img_0128.mov': 1.568, 'cajuru.mov': 55.2, 'img_0127.mov': 9.766, 'n.mp3': 10 };
  const m = ajustarAoArquivo(t, (a) => dur[a] ?? null);
  const it = Object.fromEntries(t.trilhas[0].itens.map((i) => [i.id, i]));
  assert.equal(it.a.corteInicio, 0.068);
  assert.equal(it.a.inicio, 0);
  assert.equal(it.a.duracao, 1.5);
  assert.equal(it.b.corteInicio, 0, 'arquivo mais curto que o clipe: corte em 0 (a exportação segura o último quadro)');
  assert.equal(it.c.corteInicio, 1);
  assert.equal(it.d.corteInicio, 6.766);
  assert.equal(it.e.corteInicio, 50);
  assert.equal(t.trilhas[1].itens[0].corteInicio, 0, 'áudio não é mexido');
  assert.deepEqual(m.map((x) => x.id), ['a', 'd']);
});

test('exportação: segura o último quadro e faz o tone mapping depois de reduzir', () => {
  const t = {
    largura: 1080, altura: 1920, fps: 30,
    trilhas: [{ id: 'V1', tipo: 'video', itens: [{ id: 'a', tipo: 'video', arquivo: 'a.mov', inicio: 0, duracao: 1.5, ajuste: 'cover', corteInicio: 0 }] }],
  };
  const p = planoFfmpeg(t, { infos: { 'a.mov': { hdr: true } }, assets: 'A', tonemap: 'TONEMAP' });
  const linha = p.grafo.split('\n').find((l) => l.includes('TONEMAP'));
  assert.match(linha, /trim=end_frame=45,tpad=stop_mode=clone:stop=45,trim=end_frame=45/);
  assert.ok(linha.indexOf('crop=1080:1920') < linha.indexOf('TONEMAP'), 'reduz e recorta antes do tone mapping');
});

test('exportação: clipe fora da grade de quadros cobre do quadro inicial ao final, sem buraco no fim', () => {
  // DED 01: img_0124 de 6,52 s a 8,00 s (quadro 195,6 a 240). Antes saía em 6,5 s com 44 quadros e o 239 ficava preto.
  const t = {
    largura: 1080, altura: 1920, fps: 30,
    trilhas: [{ id: 'V1', tipo: 'video', itens: [
      { id: 'a', tipo: 'video', arquivo: 'a.mov', inicio: 6.52, duracao: 1.48, ajuste: 'cover', corteInicio: 0 },
      { id: 'b', tipo: 'video', arquivo: 'b.mov', inicio: 8, duracao: 1.5, ajuste: 'cover', corteInicio: 0 },
    ] }],
  };
  const g = planoFfmpeg(t, { infos: {}, assets: 'A' }).grafo;
  assert.match(g, /trim=end_frame=44,tpad=stop_mode=clone:stop=44/, 'quadros 196 a 239');
  assert.match(g, /setpts=N\+196\[p1\]/);
  assert.match(g, /enable='between\(t,6\.516667,7\.983333\)'/);
  assert.match(g, /setpts=N\+240\[p2\]/);
  assert.match(g, /enable='between\(t,7\.983333,9\.483333\)'/);
});

test('grade de quadros: vídeo e imagem vão para o quadro mais próximo; texto e áudio não mudam', () => {
  const t = {
    fps: 30,
    trilhas: [
      { id: 'V1', tipo: 'video', itens: [
        { id: 'a', tipo: 'video', inicio: 6.52, duracao: 1.48 },
        { id: 'b', tipo: 'video', inicio: 8, duracao: 1.5 },
        { id: 'c', tipo: 'imagem', inicio: 0, duracao: 0.01 },
        { id: 'l', tipo: 'legenda', inicio: 6.52, duracao: 0.81 },
      ] },
      { id: 'A1', tipo: 'audio', itens: [{ id: 'n', tipo: 'audio', inicio: 0.013, duracao: 29.1 }] },
    ],
  };
  assert.equal(ajustarAGrade(t), 2);
  const [a, b, c, l] = t.trilhas[0].itens;
  assert.deepEqual([a.inicio, a.duracao], [6.533333, 1.466667]);
  assert.equal(Math.round((a.inicio + a.duracao) * 30), 240, 'termina onde o próximo começa');
  assert.deepEqual([b.inicio, b.duracao], [8, 1.5]);
  assert.deepEqual([c.inicio, c.duracao], [0, 0.033333], 'no mínimo 1 quadro');
  assert.deepEqual([l.inicio, l.duracao], [6.52, 0.81]);
  assert.equal(t.trilhas[1].itens[0].inicio, 0.013);
});
