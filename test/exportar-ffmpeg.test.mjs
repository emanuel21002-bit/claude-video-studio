import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motivosSemFfmpeg, planoFfmpeg } from '../src/main/exportar-ffmpeg.mjs';

const base = (itensV, extra = {}) => ({
  largura: 1080, altura: 1920, fps: 30, fundo: '#000',
  trilhas: [{ id: 'V1', tipo: 'video', itens: itensV, ...extra }, { id: 'A1', tipo: 'audio', itens: [{ id: 'n', tipo: 'audio', arquivo: 'n.mp3', inicio: 0, duracao: 4, volume: 1, fadeOut: 0.5 }] }],
});
const clipe = (id, inicio, extra = {}) => ({ id, tipo: 'video', arquivo: `${id}.mov`, inicio, duracao: 2, ajuste: 'cover', corteInicio: 1, volume: 0, ...extra });

test('o que o modo rápido não cobre vai para o Filmcraft', () => {
  assert.deepEqual(motivosSemFfmpeg(base([clipe('a', 0, { zoom: { de: 1, para: 1.06 }, efeitos: { cor: { contraste: 10 } } })])), []);
  assert.deepEqual(motivosSemFfmpeg(base([clipe('a', 0, { keyframes: { escala: [{ t: 0, v: 1 }] } })])), ['keyframes em clipe']);
  assert.deepEqual(motivosSemFfmpeg(base([clipe('a', 0), clipe('b', 2)], { transicoes: [{ id: 'x', tipo: 'push', duracao: 0.5, de: 'a', para: 'b' }] })), ['transição "push"']);
  assert.deepEqual(motivosSemFfmpeg(base([clipe('a', 0), clipe('b', 2)], { transicoes: [{ id: 'x', tipo: 'cross_dissolve', duracao: 0.5, de: 'a', para: 'b' }] })), []);
  const t = base([clipe('a', 0)]);
  t.trilhas.push({ id: 'V2', tipo: 'video', itens: [{ id: 'aj', tipo: 'ajuste', inicio: 0, duracao: 1, efeitos: {} }] });
  assert.deepEqual(motivosSemFfmpeg(t), ['camada de ajuste']);
});

test('grafo: corte, zoom, HDR, cor, mesclagem, camada e áudio', () => {
  const t = base([clipe('a', 0, { zoom: { de: 1, para: 1.1 }, efeitos: { cor: { saturacao: 120, lut: 'x.cube' } } }), clipe('b', 2, { velocidade: 2 })]);
  t.trilhas[0].itens.push({ id: 'logo', tipo: 'imagem', arquivo: 'l.png', inicio: 0, duracao: 4, largura: 300, y: 700, opacidade: 0.6, mesclagem: 'screen' });
  const p = planoFfmpeg(t, { infos: { 'a.mov': { hdr: true }, 'b.mov': {} }, assets: 'A', camada: { arquivo: 'cam.mov' }, tonemap: 'TONEMAP' });
  const args = p.entradas.map((e) => e.join(' '));
  assert.ok(args.some((a) => a.startsWith('-ss 1 -t 2.25 -i')), 'clipe a: corte 1 s, 2 s de arquivo');
  assert.ok(args.some((a) => a.startsWith('-ss 1 -t 4.25 -i')), 'clipe b: 2x pede 4 s de arquivo');
  assert.match(p.grafo, /TONEMAP/);
  assert.match(p.grafo, /scale=w='2\*ceil\(1080\*\(1\*\(1\+0\.1\*min\(1,max\(0,n-0\)\/60\)\)\)\/2\)'/);
  assert.match(p.grafo, /lut3d=file=lut0\.cube/);
  assert.match(p.grafo, /setpts=\(PTS-STARTPTS\)\/2/);
  assert.match(p.grafo, /blend=all_mode=screen:all_opacity=0\.6/);
  assert.match(p.grafo, /\[cam\]overlay/);
  assert.match(p.grafo, /afade=t=out:st=3\.5:d=0\.5/);
  assert.equal(p.temAudio, true);
  assert.deepEqual(p.auxiliares.map((a) => a.nome), ['lut0.cube']);
});
