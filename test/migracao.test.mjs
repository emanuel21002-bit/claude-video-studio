import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrarProjetos, agrupar, PASTA_ANTIGOS } from '../src/main/migracao.mjs';

const escrever = (c, dados) => {
  fs.mkdirSync(path.dirname(c), { recursive: true });
  fs.writeFileSync(c, dados);
};

function antigo(projetos, id, { indice, narracao, extra = {}, grupo = { id: 'g1', nome: 'Cliente' }, nome }) {
  const dir = path.join(projetos, id);
  const assetsPosix = path.join(dir, 'assets').replace(/\\/g, '/');
  const nomeFinal = nome ?? `Cliente — Áudio ${indice}`;
  escrever(path.join(dir, 'assets', 'clipe.mp4'), 'mesmo video');
  escrever(path.join(dir, 'assets', 'narracao.mp3'), narracao);
  escrever(path.join(dir, 'referencia', 'ref.mp4'), 'referencia');
  for (const [n, c] of Object.entries(extra)) escrever(path.join(dir, 'assets', n), c);
  escrever(path.join(dir, 'renders', 'video.mp4'), 'render ' + indice);
  escrever(path.join(dir, 'src', 'blocos.tsx'), 'staticFile("narracao.mp3"); staticFile("minha-narracao.mp3");');
  escrever(path.join(dir, 'BRIEFING.md'), 'Arquivo: `narracao.mp3`');
  escrever(path.join(dir, 'transcricao.json'), '{"palavras":[]}');
  escrever(path.join(dir, '.previa', 'previa.js'), 'cache');
  escrever(path.join(dir, 'filmcraft', 'projeto.fcproj'), JSON.stringify({ a: `${assetsPosix}/narracao.mp3`, b: `${dir.replace(/\\/g, '/')}/filmcraft/camada.mov` }));
  escrever(path.join(dir, 'filmcraft', 'ida.otio'), JSON.stringify({ a: pathToFileURL(path.join(dir, 'assets', 'narracao.mp3')).href }));
  const velho = new Date('2026-01-01T10:00:00Z');
  fs.utimesSync(path.join(dir, 'filmcraft', 'projeto.fcproj'), velho, velho);
  escrever(path.join(dir, 'timeline.json'), JSON.stringify({
    largura: 1080, altura: 1920, fps: 30,
    trilhas: [
      { id: 'video', tipo: 'video', itens: [{ id: 'a', tipo: 'video', arquivo: 'clipe.mp4', inicio: 0, duracao: 2 }] },
      { id: 'narracao', tipo: 'audio', itens: [{ id: 'b', tipo: 'audio', arquivo: 'narracao.mp3', inicio: 0, duracao: 2 }] },
    ],
  }));
  escrever(path.join(dir, 'projeto.json'), JSON.stringify({
    id, nome: nomeFinal, criadoEm: `2026-01-0${indice}T00:00:00Z`, engine: 'remotion', formato: '9:16', largura: 1080, altura: 1920, fps: 30, timeline: true,
    materiais: [{ arquivo: 'clipe.mp4', tipo: 'video', original: 'X:/clipe.mp4', pasta: 'Feed' }],
    referencias: [{ arquivo: 'ref.mp4', tipo: 'video' }],
    audiosInstrucao: [],
    narracao: { arquivo: 'narracao.mp3', duracao: 2 },
    lote: { indice, total: 2 },
    grupo,
    sessionId: 'sessao-' + indice,
    renders: [{ arquivo: path.join(dir, 'renders', 'video.mp4'), modo: 'gpu', segundos: 1 }],
    chat: [{ de: 'usuario', texto: 'oi ' + indice }],
    filmcraft: { sincronizadoEm: velho.getTime() },
  }));
  return dir;
}

function preparar() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-migracao-'));
  const projetos = path.join(ws, 'projetos');
  antigo(projetos, '20260101000000-cliente-a', { indice: 1, narracao: 'fala um', extra: { 'musica.mp3': 'igual', 'igual-1.mp3': 'mesma coisa' } });
  antigo(projetos, '20260102000000-cliente-b', { indice: 2, narracao: 'fala dois', extra: { 'musica.mp3': 'igual', 'igual.mp3': 'mesma coisa' } });
  return { ws, projetos };
}

test('junta as timelines de um grupo num projeto só, com os materiais uma vez', async () => {
  const { ws, projetos } = preparar();
  const r = await migrarProjetos(ws);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.migrados, ['20260101000000-cliente']);
  assert.deepEqual(fs.readdirSync(projetos), ['20260101000000-cliente']);

  const raiz = path.join(projetos, '20260101000000-cliente');
  const p = JSON.parse(fs.readFileSync(path.join(raiz, 'projeto.json'), 'utf8'));
  assert.equal(p.nome, 'Cliente');
  assert.deepEqual(p.timelines.map((t) => t.rotulo), ['Áudio 1', 'Áudio 2']);
  assert.deepEqual(p.materiais.map((m) => m.arquivo), ['clipe.mp4']);
  assert.equal(p.materiais[0].pasta, 'Feed');
  assert.equal(p.referencias.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(raiz, 'assets')).sort(), ['clipe.mp4', 'igual.mp3', 'musica.mp3', 'narracao-2.mp3', 'narracao.mp3']);
  assert.equal(fs.readFileSync(path.join(raiz, 'assets', 'narracao.mp3'), 'utf8'), 'fala um');
  assert.equal(fs.readFileSync(path.join(raiz, 'assets', 'narracao-2.mp3'), 'utf8'), 'fala dois');
});

test('a segunda timeline passa a apontar para a própria narração em todo lugar', async () => {
  const { ws, projetos } = preparar();
  await migrarProjetos(ws);
  const raiz = path.join(projetos, '20260101000000-cliente');
  const p = JSON.parse(fs.readFileSync(path.join(raiz, 'projeto.json'), 'utf8'));
  const [t1, t2] = p.timelines;
  assert.equal(t1.narracao.arquivo, 'narracao.mp3');
  assert.equal(t2.narracao.arquivo, 'narracao-2.mp3');
  const dir2 = path.join(raiz, 'timelines', t2.id);
  const tl = JSON.parse(fs.readFileSync(path.join(dir2, 'timeline.json'), 'utf8'));
  assert.equal(tl.trilhas[1].itens[0].arquivo, 'narracao-2.mp3');
  assert.equal(fs.readFileSync(path.join(dir2, 'src', 'blocos.tsx'), 'utf8'), 'staticFile("narracao-2.mp3"); staticFile("minha-narracao.mp3");');
  assert.equal(fs.readFileSync(path.join(dir2, 'BRIEFING.md'), 'utf8'), 'Arquivo: `narracao-2.mp3`');
  // A pasta antiga não pode continuar referenciada nos arquivos do Filmcraft.
  const assetsNovos = path.join(raiz, 'assets').replace(/\\/g, '/');
  const fc = JSON.parse(fs.readFileSync(path.join(dir2, 'filmcraft', 'projeto.fcproj'), 'utf8'));
  assert.equal(fc.a, `${assetsNovos}/narracao-2.mp3`);
  assert.equal(fc.b, `${dir2.replace(/\\/g, '/')}/filmcraft/camada.mov`);
  const otio = JSON.parse(fs.readFileSync(path.join(dir2, 'filmcraft', 'ida.otio'), 'utf8'));
  assert.equal(otio.a, pathToFileURL(path.join(raiz, 'assets', 'narracao-2.mp3')).href);
  // Sem isso, abrir no Filmcraft acharia que há edição não trazida (ou perderia uma que existe).
  assert.equal(fs.statSync(path.join(dir2, 'filmcraft', 'projeto.fcproj')).mtimeMs, new Date('2026-01-01T10:00:00Z').getTime());
  assert.equal(t2.sessionId, 'sessao-2');
  assert.equal(t2.chat[0].texto, 'oi 2');
  assert.equal(t2.renders[0].arquivo, path.join(dir2, 'renders', 'video.mp4'));
  assert.ok(fs.existsSync(t2.renders[0].arquivo));
  assert.ok(!fs.existsSync(path.join(dir2, '.previa')));
});

test('nomes diferentes com o mesmo conteúdo viram um arquivo só', async () => {
  const { ws, projetos } = preparar();
  await migrarProjetos(ws);
  const raiz = path.join(projetos, '20260101000000-cliente');
  assert.ok(fs.existsSync(path.join(raiz, 'assets', 'igual.mp3')));
  assert.ok(!fs.existsSync(path.join(raiz, 'assets', 'igual-1.mp3')));
});

test('não apaga nada: os originais vão intactos para projetos-antigos, e editar o novo não os altera', async () => {
  const { ws, projetos } = preparar();
  const antes = fs.readFileSync(path.join(projetos, '20260102000000-cliente-b', 'timeline.json'), 'utf8');
  await migrarProjetos(ws);
  const backup = path.join(ws, PASTA_ANTIGOS, '20260102000000-cliente-b');
  assert.equal(fs.readFileSync(path.join(backup, 'timeline.json'), 'utf8'), antes);
  assert.equal(fs.readFileSync(path.join(backup, 'assets', 'narracao.mp3'), 'utf8'), 'fala dois');
  const raiz = path.join(projetos, '20260101000000-cliente');
  const p = JSON.parse(fs.readFileSync(path.join(raiz, 'projeto.json'), 'utf8'));
  fs.writeFileSync(path.join(raiz, 'timelines', p.timelines[1].id, 'timeline.json'), '{}');
  assert.equal(fs.readFileSync(path.join(backup, 'timeline.json'), 'utf8'), antes);
  // O material continua no projeto novo depois de apagar o backup.
  fs.rmSync(path.join(ws, PASTA_ANTIGOS), { recursive: true, force: true });
  assert.equal(fs.readFileSync(path.join(raiz, 'assets', 'narracao-2.mp3'), 'utf8'), 'fala dois');
});

test('rodar de novo não muda nada', async () => {
  const { ws, projetos } = preparar();
  await migrarProjetos(ws);
  const r = await migrarProjetos(ws);
  assert.deepEqual(r, { migrados: [], erros: [] });
  assert.deepEqual(fs.readdirSync(projetos), ['20260101000000-cliente']);
});

test('projeto de uma timeline só, com o mesmo nome da pasta antiga', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-migracao-'));
  const projetos = path.join(ws, 'projetos');
  const id = '20260101000000-solo';
  antigo(projetos, id, { indice: 1, narracao: 'fala', grupo: { id, nome: 'Solo' }, nome: 'Solo' });
  const r = await migrarProjetos(ws);
  assert.deepEqual(r.migrados, [id]);
  const p = JSON.parse(fs.readFileSync(path.join(projetos, id, 'projeto.json'), 'utf8'));
  assert.deepEqual(p.timelines.map((t) => t.rotulo), ['Timeline 1']);
  assert.ok(fs.existsSync(path.join(ws, PASTA_ANTIGOS, id, 'projeto.json')));
});

test('completa uma migração interrompida depois que a pasta nova ficou pronta', async () => {
  const { ws, projetos } = preparar();
  await migrarProjetos(ws);
  const final = path.join(projetos, '20260101000000-cliente');
  const antigos = path.join(ws, PASTA_ANTIGOS);
  // Como se o app fechasse logo antes de mover as pastas.
  fs.renameSync(final, path.join(projetos, '.novo-20260101000000-cliente'));
  fs.renameSync(path.join(antigos, '20260101000000-cliente-a'), path.join(projetos, '20260101000000-cliente-a'));
  const r = await migrarProjetos(ws);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(fs.readdirSync(projetos), ['20260101000000-cliente']);
  assert.ok(fs.existsSync(path.join(antigos, '20260101000000-cliente-a')));
});

test('descarta uma pasta temporária incompleta', async () => {
  const { ws, projetos } = preparar();
  escrever(path.join(projetos, '.novo-x', 'assets', 'a.mp4'), 'parcial');
  await migrarProjetos(ws);
  assert.ok(!fs.existsSync(path.join(projetos, '.novo-x')));
});

test('agrupa projetos sem grupo pela sequência do lote', () => {
  const base = { criadoEm: '2026-01-01' };
  const g = agrupar([
    { ...base, id: 'a', nome: 'X — 1', lote: { indice: 1, total: 2 } },
    { ...base, id: 'b', nome: 'X — 2', lote: { indice: 2, total: 2 } },
    { ...base, id: 'c', nome: 'Solto' },
  ]);
  assert.deepEqual(g.map((x) => x.membros.map((m) => m.id)), [['a', 'b'], ['c']]);
});
