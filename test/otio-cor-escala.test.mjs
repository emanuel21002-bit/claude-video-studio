import test from 'node:test';
import assert from 'node:assert/strict';
import { paraOtio, tamanhoVisivel } from '../src/main/otio.mjs';

const t = { largura: 1080, altura: 1920, fps: 30, trilhas: [{ id: 'v', tipo: 'video', itens: [{ id: 'a', tipo: 'video', arquivo: 'img.mov', inicio: 0, duracao: 1, ajuste: 'cover' }] }] };
const ida = (largura, altura, opcoes) => paraOtio(t, { materiais: [{ arquivo: 'img.mov', largura, altura }] }, { assets: 'D:/a', ...opcoes }).otio;
const escalaDe = (o) => o.tracks.children[0].children[0].metadata.filmcraft.effects[0].params.scale.value.Float;

test('vídeo em pé rotacionado usa o tamanho já girado', () => {
  const v = { width: 3840, height: 2160, side_data_list: [{ rotation: -90 }] };
  assert.deepEqual(tamanhoVisivel(v), { largura: 2160, altura: 3840, girado: true });
  assert.deepEqual(tamanhoVisivel({ width: 3840, height: 2160, tags: { rotate: '180' } }), { largura: 3840, altura: 2160, girado: false });
});

test('4K em pé preenche o quadro vertical sem sobrar', () => {
  assert.equal(escalaDe(ida(2160, 3840)), 50);
});

test('projeto fica em Rec. 709 com tone mapping e BT.2020 só com HDR', () => {
  const cor = (o) => o.metadata.filmcraft.settings.color;
  assert.deepEqual(cor(ida(2160, 3840, { hdr: true })), { auto_tone_map: true, wide_gamut: true, working: 'Rec709' });
  assert.deepEqual(cor(ida(2160, 3840)), { auto_tone_map: true, wide_gamut: false, working: 'Rec709' });
});
