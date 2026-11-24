import test from 'node:test';
import assert from 'node:assert/strict';
import { planoFfmpeg } from '../src/main/exportar-ffmpeg.mjs';

const t = {
  largura: 1080, altura: 1920, fps: 30,
  trilhas: [{ id: 'v', tipo: 'video', itens: [
    { id: 'a', tipo: 'video', arquivo: 'a.mov', inicio: 0, duracao: 3, corteInicio: 0 },
    { id: 'b', tipo: 'video', arquivo: 'b.mov', inicio: 3, duracao: 3, corteInicio: 0, ajuste: 'contain' },
  ] }],
};
const infos = { 'a.mov': { largura: 3840, altura: 2160, hdr: true }, 'b.mov': { largura: 3840, altura: 2160, hdr: false } };

test('na placa: o vídeo que cobre o quadro reduz, corta e faz o tone mapping no libplacebo', () => {
  const p = planoFfmpeg(t, { infos, assets: 'C:/x', tonemap: 'TONEMAP_CPU', so: 'video', naPlaca: true });
  assert.match(p.grafo, /libplacebo=w=1080:h=1920:pad_crop_ratio=1:tonemapping=bt\.2390/);
  assert.deepEqual(p.globais, ['-init_hw_device', 'vulkan=vk', '-filter_hw_device', 'vk']);
  // "contain" continua na CPU (as barras precisam ser transparentes).
  assert.match(p.grafo, /force_original_aspect_ratio=decrease/);
  assert.doesNotMatch(p.grafo, /TONEMAP_CPU/);
});

test('sem a placa: tudo como antes, sem aparelho Vulkan', () => {
  const p = planoFfmpeg(t, { infos, assets: 'C:/x', tonemap: 'TONEMAP_CPU', so: 'video' });
  assert.doesNotMatch(p.grafo, /libplacebo/);
  assert.match(p.grafo, /TONEMAP_CPU/);
  assert.deepEqual(p.globais, []);
});

test('a camada de textos de um intervalo entra a partir do começo dele', () => {
  const p = planoFfmpeg(t, { infos, assets: 'C:/x', so: 'video', camada: { arquivo: 'cam.mov', duracao: 3, desde: 1.5 } });
  assert.ok(p.entradas.some((e) => e.join(' ') === '-ss 1.5 -t 6.1 -i cam.mov'), JSON.stringify(p.entradas));
});

test('mídia otimizada: a imagem lê a cópia SDR, sem tone mapping, e o som continua no original', () => {
  const tv = { ...t, trilhas: [{ id: 'v', tipo: 'video', itens: [{ id: 'a', tipo: 'video', arquivo: 'a.mov', inicio: 0, duracao: 3, corteInicio: 0, volume: 1 }] }] };
  const trocas = { 'a.mov': { caminho: 'C:/cache/otm.mp4', info: { largura: 1188, altura: 2112, hdr: false } } };
  const img = planoFfmpeg(tv, { infos: { 'a.mov': { largura: 2160, altura: 3840, hdr: true, temAudio: true } }, assets: 'C:/x', tonemap: 'TONEMAP_CPU', so: 'video', naPlaca: true, trocas });
  assert.ok(img.entradas.flat().includes('C:/cache/otm.mp4'));
  assert.doesNotMatch(img.grafo, /TONEMAP_CPU|libplacebo/); // já vem SDR e pequena: escala simples na CPU
  const som = planoFfmpeg(tv, { infos: { 'a.mov': { largura: 2160, altura: 3840, hdr: true, temAudio: true } }, assets: 'C:/x', so: 'audio', trocas });
  assert.ok(!som.entradas.flat().includes('C:/cache/otm.mp4'));
});
