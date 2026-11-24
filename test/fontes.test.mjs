import test from 'node:test';
import assert from 'node:assert/strict';
import { nomesDaFonte, FONTE_DE_SIMBOLOS } from '../src/main/fontes-nucleo.mjs';

const utf16 = (s) => Buffer.from(s, 'utf16le').swap16();

// Monta uma fonte mínima (só a tabela "name"). nomes: [{ plataforma, idioma, id, texto }]
function sfnt(nomes, inicio = 0) {
  const textos = nomes.map((n) => (n.plataforma === 1 ? Buffer.from(n.texto, 'latin1') : utf16(n.texto)));
  const cabecalhos = 6 + nomes.length * 12;
  const tabela = Buffer.alloc(cabecalhos + textos.reduce((s, t) => s + t.length, 0));
  tabela.writeUInt16BE(0, 0);
  tabela.writeUInt16BE(nomes.length, 2);
  tabela.writeUInt16BE(cabecalhos, 4);
  let off = 0;
  nomes.forEach((n, i) => {
    const r = 6 + i * 12;
    tabela.writeUInt16BE(n.plataforma, r);
    tabela.writeUInt16BE(n.plataforma === 1 ? 0 : 1, r + 2);
    tabela.writeUInt16BE(n.idioma, r + 4);
    tabela.writeUInt16BE(n.id, r + 6);
    tabela.writeUInt16BE(textos[i].length, r + 8);
    tabela.writeUInt16BE(off, r + 10);
    textos[i].copy(tabela, cabecalhos + off);
    off += textos[i].length;
  });
  const cab = Buffer.alloc(28);
  cab.writeUInt32BE(0x00010000, 0);
  cab.writeUInt16BE(1, 4);
  cab.write('name', 12, 'latin1');
  cab.writeUInt32BE(inicio + 28, 20);
  cab.writeUInt32BE(tabela.length, 24);
  return Buffer.concat([cab, tabela]);
}

const leitor = (buf) => (pos, tam) => buf.subarray(pos, pos + tam);

test('lê família e estilo da tabela name (Windows, UTF-16)', () => {
  const buf = sfnt([
    { plataforma: 3, idioma: 0x409, id: 1, texto: 'Cal Sans' },
    { plataforma: 3, idioma: 0x409, id: 2, texto: 'SemiBold' },
  ]);
  assert.deepEqual(nomesDaFonte(leitor(buf)), [{ familia: 'Cal Sans', estilo: 'SemiBold' }]);
});

test('a família tipográfica (id 16) vale mais que a do id 1', () => {
  const buf = sfnt([
    { plataforma: 3, idioma: 0x409, id: 1, texto: 'Poppins Light' },
    { plataforma: 3, idioma: 0x409, id: 16, texto: 'Poppins' },
    { plataforma: 3, idioma: 0x409, id: 17, texto: 'Light' },
  ]);
  assert.deepEqual(nomesDaFonte(leitor(buf)), [{ familia: 'Poppins', estilo: 'Light' }]);
});

test('nome em inglês dos EUA vence outro idioma; Mac serve quando é o único', () => {
  const duas = sfnt([
    { plataforma: 3, idioma: 0x416, id: 1, texto: 'Fonte PT' },
    { plataforma: 3, idioma: 0x409, id: 1, texto: 'Font EN' },
  ]);
  assert.equal(nomesDaFonte(leitor(duas))[0].familia, 'Font EN');
  const mac = sfnt([{ plataforma: 1, idioma: 0, id: 1, texto: 'Old Mac' }]);
  assert.equal(nomesDaFonte(leitor(mac))[0].familia, 'Old Mac');
});

test('coleção TTC devolve cada fonte dela', () => {
  const a = sfnt([{ plataforma: 3, idioma: 0x409, id: 1, texto: 'Familia A' }], 24);
  const b = sfnt([{ plataforma: 3, idioma: 0x409, id: 1, texto: 'Familia B' }], 24 + a.length);
  const cab = Buffer.alloc(20);
  cab.write('ttcf', 0, 'latin1');
  cab.writeUInt32BE(0x00010000, 4);
  cab.writeUInt32BE(2, 8);
  cab.writeUInt32BE(24, 12);
  cab.writeUInt32BE(24 + a.length, 16);
  const buf = Buffer.concat([cab, Buffer.alloc(4), a, b]);
  assert.deepEqual(nomesDaFonte(leitor(buf)).map((f) => f.familia), ['Familia A', 'Familia B']);
});

test('arquivo que não é fonte devolve lista vazia', () => {
  assert.deepEqual(nomesDaFonte(leitor(Buffer.from('isto não é uma fonte de verdade'))), []);
});

test('símbolos e ícones ficam fora da lista de fontes de texto', () => {
  for (const n of ['Wingdings 2', 'Webdings', 'Segoe MDL2 Assets', 'Segoe UI Emoji']) assert.ok(FONTE_DE_SIMBOLOS.test(n), n);
  for (const n of ['Arial', 'Segoe UI', 'Cal Sans']) assert.ok(!FONTE_DE_SIMBOLOS.test(n), n);
});
