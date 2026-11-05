import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarSaida, kbpsDe, argsVideo, limparNome } from '../src/main/exportacao.mjs';

const reels = { largura: 1080, altura: 1920, fps: 30 };

test('configuração antiga continua igual: MOV é ProRes e MP4 é H.264', () => {
  assert.deepEqual(normalizarSaida({ formato: 'mov' }), { codec: 'prores', formato: 'mov' });
  assert.deepEqual(normalizarSaida({ formato: 'mp4' }), { codec: 'h264', formato: 'mp4' });
});

test('HEVC e H.264 aceitam os dois contêineres; ProRes só MOV', () => {
  assert.deepEqual(normalizarSaida({ codec: 'hevc', formato: 'mov' }), { codec: 'hevc', formato: 'mov' });
  assert.deepEqual(normalizarSaida({ codec: 'h264', formato: 'mov' }), { codec: 'h264', formato: 'mov' });
  assert.deepEqual(normalizarSaida({ codec: 'prores', formato: 'mp4' }), { codec: 'prores', formato: 'mov' });
});

test('o Recomendado em HEVC bate com o do CapCut: cerca de 6 Mbit/s em 1080p', () => {
  assert.equal(kbpsDe({ codec: 'hevc', qualidade: 'recomendado', ...reels }), 6000);
  assert.equal(kbpsDe({ codec: 'h264', qualidade: 'recomendado', ...reels }), 10000);
  // A qualidade antiga "média" vira o recomendado.
  assert.equal(kbpsDe({ codec: 'h264', qualidade: 'media', ...reels }), 10000);
});

test('a taxa acompanha resolução e fps', () => {
  const taxa = (o) => kbpsDe({ codec: 'hevc', qualidade: 'recomendado', ...reels, ...o });
  // O valor é arredondado de 100 em 100: a proporção é quase exata.
  assert.ok(Math.abs(taxa({ fps: 60 }) / taxa() - 2) < 0.02);
  assert.ok(Math.abs(taxa({ largura: 2160, altura: 3840 }) / taxa() - 4) < 0.02);
});

test('cada codificador recebe o codec certo', () => {
  const texto = (o) => argsVideo({ kbps: 6000, ...o }).join(' ');
  assert.match(texto({ codec: 'hevc', encoderId: 'amf' }), /hevc_amf .*-b:v 6000k.*-tag:v hvc1/);
  assert.match(texto({ codec: 'hevc', encoderId: 'nvenc' }), /hevc_nvenc/);
  assert.match(texto({ codec: 'hevc' }), /libx265/);
  assert.match(texto({ codec: 'h264', encoderId: 'amf' }), /h264_amf/);
  assert.doesNotMatch(texto({ codec: 'h264' }), /hvc1/);
  assert.match(texto({ codec: 'prores' }), /prores_ks/);
});

test('nome de arquivo sem caracteres proibidos', () => {
  assert.equal(limparNome('Cliente: Black / 05.11?'), 'Cliente Black 05.11');
  assert.equal(limparNome('   '), '');
});
