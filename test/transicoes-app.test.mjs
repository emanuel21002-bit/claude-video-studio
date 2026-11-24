import test from 'node:test';
import assert from 'node:assert/strict';
import { paraOtio, deOtio } from '../src/main/otio.mjs';
import { motivosSemFfmpeg } from '../src/main/exportar-ffmpeg.mjs';

const timeline = (tipo, extra = {}) => ({
  largura: 1080, altura: 1920, fps: 30,
  trilhas: [{
    id: 'v', tipo: 'video',
    itens: [
      { id: 'a', tipo: 'video', arquivo: 'a.mov', inicio: 0, duracao: 2, corteInicio: 1 },
      { id: 'b', tipo: 'video', arquivo: 'b.mov', inicio: 2, duracao: 2, corteInicio: 1 },
    ],
    transicoes: [{ id: 'x', tipo, duracao: 0.5, alinhamento: 'centro', de: 'a', para: 'b', ...extra }],
  }],
});

test('transição só do app vai ao Filmcraft como a mais parecida e volta com o tipo do app', () => {
  const t = timeline('app_girar');
  const { otio } = paraOtio(t, { materiais: [] }, { assets: 'C:/assets' });
  const txt = JSON.stringify(otio);
  assert.match(txt, /"effect":"cross_zoom"/);
  assert.doesNotMatch(txt, /"effect":"app_girar"/);
  const volta = deOtio(otio, t, { materiais: [] }, { novoId: () => 'n', mapaArquivos: new Map(), base: 'C:/x' });
  assert.equal(volta.timeline.trilhas[0].transicoes[0].tipo, 'app_girar');
});

test('modo rápido não desenha as do app nem as com direção: sai pelo Remotion', () => {
  assert.deepEqual(motivosSemFfmpeg(timeline('app_luz')), ['transição "app_luz"']);
  assert.deepEqual(motivosSemFfmpeg(timeline('cross_dissolve', { direcao: 'cima' })), ['transição "cross_dissolve"']);
});
