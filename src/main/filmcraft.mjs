import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { carregar } from './settings.mjs';
import { recurso, temRecurso } from './recursos.mjs';
import { rodar, rodarOuFalhar } from './proc.mjs';
import { dirs, caminhoProjeto, lerProjeto, gravarProjeto } from './workspace.mjs';
import { lerTimeline, gravarTimeline, escreverModelo, importarParaProjeto, novoId } from './timeline.mjs';
import { paraOtio, deOtio, arquivosDeFora } from './otio.mjs';
import { pastaPublica } from './render.mjs';
import { infoVideo } from './transcodificar.mjs';

// Ponte com o Filmcraft (editor nativo, à parte). O app gera um projeto a partir de timeline.json,
// o usuário edita e salva lá, e "Trazer de volta" lê o que foi salvo.

const exe = () => recurso('filmcraft', 'filmcraft.exe');
export const cli = () => recurso('filmcraft', 'filmcraft-cli.exe');

export const filmcraftDisponivel = () => temRecurso('filmcraft', 'filmcraft.exe') && temRecurso('filmcraft', 'filmcraft-cli.exe');

const pasta = (id) => path.join(caminhoProjeto(id), 'filmcraft');
const projetoFc = (id) => path.join(pasta(id), 'projeto.fcproj');

const temCamada = (i) => !i.arquivo;

// Texto, legendas e blocos são desenhados pelo Remotion: vão como um vídeo transparente, só para referência.
async function renderizarCamada(id, t, onLinha) {
  const soGraficos = {
    ...t,
    fundo: 'transparent',
    trilhas: t.trilhas.map((tr) => ({ ...tr, transicoes: undefined, itens: tr.itens.filter(temCamada) })),
  };
  const itens = soGraficos.trilhas.flatMap((tr) => tr.itens);
  if (!itens.length) return null;
  const blocos = path.join(caminhoProjeto(id), 'src', 'blocos.tsx');
  const hash = crypto.createHash('sha1')
    .update(JSON.stringify(soGraficos))
    .update(fs.existsSync(blocos) ? fs.readFileSync(blocos) : '')
    .digest('hex');
  const saida = path.join(pasta(id), `camada-${hash.slice(0, 12)}.mov`);
  const duracao = Math.max(...itens.map((i) => i.inicio + i.duracao));
  if (fs.existsSync(saida)) return { arquivo: saida, duracao };
  for (const n of fs.readdirSync(pasta(id))) if (/^camada-.*\.mov$/.test(n)) fs.rmSync(path.join(pasta(id), n), { force: true });
  const props = path.join(pasta(id), 'camada-props.json');
  fs.writeFileSync(props, JSON.stringify({ timeline: soGraficos }));
  onLinha?.('Renderizando textos, legendas e efeitos para o Filmcraft…');
  const s = carregar();
  const { ws } = dirs();
  const projeto = path.join('projetos', id);
  const parcial = saida + '.tmp.mov';
  const tmp = path.join(pasta(id), 'tmp');
  try {
    const publica = await pastaPublica(id, soGraficos, path.join(tmp, 'publico'));
    await rodarOuFalhar(s.nodePath, [
      path.join(ws, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'), 'render',
      path.join(projeto, 'src', 'index.ts'), 'Main', parcial,
      '--public-dir', publica, `--props=${props}`, '--concurrency=2', '--timeout=120000',
      '--codec=prores', '--prores-profile=4444', '--pixel-format=yuva444p10le', '--image-format=png', '--gl=angle',
      `--frames=0-${Math.ceil(duracao * t.fps) - 1}`,
    ], { cwd: ws, env: { TEMP: tmp, TMP: tmp } });
    fs.renameSync(parcial, saida);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { arquivo: saida, duracao };
}

const estado = (p) => p.filmcraft ?? {};

// O Claude pode pôr em assets/ arquivos que não estão em materiais (logo, por exemplo). Sem o tamanho deles,
// a escala no Filmcraft sairia errada.
async function comTamanhos(projeto, t) {
  const conhecidos = new Set(projeto.materiais.map((m) => m.arquivo));
  const assets = path.join(caminhoProjeto(projeto.id), 'assets');
  const extras = [];
  for (const arquivo of new Set(t.trilhas.flatMap((tr) => tr.itens).map((i) => i.arquivo).filter(Boolean))) {
    if (conhecidos.has(arquivo) || projeto.narracao?.arquivo === arquivo || !fs.existsSync(path.join(assets, arquivo))) continue;
    const { largura, altura } = await infoVideo(path.join(assets, arquivo));
    if (largura) extras.push({ arquivo, largura, altura });
  }
  return { ...projeto, materiais: [...projeto.materiais, ...extras] };
}

// Salvo no Filmcraft depois da última ida ou volta: abrir de novo descartaria essas edições.
function editadoLa(id) {
  const arq = projetoFc(id);
  if (!fs.existsSync(arq)) return false;
  return fs.statSync(arq).mtimeMs > (estado(lerProjeto(id)).sincronizadoEm ?? 0) + 1000;
}

function marcarSincronizado(id) {
  const p = lerProjeto(id);
  p.filmcraft = { ...estado(p), sincronizadoEm: fs.statSync(projetoFc(id)).mtimeMs };
  gravarProjeto(p);
}

// Monta o projeto do Filmcraft a partir da timeline. Devolve o caminho do projeto e os avisos da conversão.
export async function prepararProjetoFilmcraft(id, destino, onLinha) {
  const projeto = lerProjeto(id);
  escreverModelo(projeto);
  const t = lerTimeline(id);
  fs.mkdirSync(pasta(id), { recursive: true });
  const camada = await renderizarCamada(id, t, onLinha);
  const { otio, avisos } = paraOtio(t, await comTamanhos(projeto, t), { assets: path.join(caminhoProjeto(id), 'assets'), camada });
  const arqOtio = path.join(pasta(id), 'ida.otio');
  fs.writeFileSync(arqOtio, JSON.stringify(otio, null, 1));
  fs.rmSync(destino, { force: true });
  await rodarOuFalhar(cli(), ['--compact', '--save-as', destino, 'exec', 'file.import', JSON.stringify({ paths: [arqOtio] })], { cwd: pasta(id) });
  return { avisos };
}

export async function abrirNoFilmcraft(id, { descartar = false } = {}, onLinha) {
  if (!filmcraftDisponivel()) throw new Error('O Filmcraft não está em recursos\\filmcraft.');
  if (!descartar && editadoLa(id)) return { pendente: true };
  const projeto = lerProjeto(id);
  escreverModelo(projeto);
  const t = lerTimeline(id);
  fs.mkdirSync(pasta(id), { recursive: true });
  const camada = await renderizarCamada(id, t, onLinha);
  const { otio, avisos } = paraOtio(t, await comTamanhos(projeto, t), { assets: path.join(caminhoProjeto(id), 'assets'), camada });
  const arqOtio = path.join(pasta(id), 'ida.otio');
  fs.writeFileSync(arqOtio, JSON.stringify(otio, null, 1));
  onLinha?.('Preparando o projeto do Filmcraft…');
  const destino = projetoFc(id);
  if (fs.existsSync(destino)) fs.copyFileSync(destino, destino + '.anterior');
  fs.rmSync(destino, { force: true });
  await rodarOuFalhar(cli(), ['--compact', '--save-as', destino, 'exec', 'file.import', JSON.stringify({ paths: [arqOtio] })], { cwd: pasta(id) });
  marcarSincronizado(id);
  spawn(exe(), [destino], { cwd: pasta(id), detached: true, stdio: 'ignore', windowsHide: false }).unref();
  return { avisos };
}

export async function trazerDoFilmcraft(id, onLinha) {
  if (!filmcraftDisponivel()) throw new Error('O Filmcraft não está em recursos\\filmcraft.');
  const destino = projetoFc(id);
  if (!fs.existsSync(destino)) throw new Error('Este vídeo ainda não foi aberto no Filmcraft.');
  const volta = path.join(pasta(id), 'volta.otio');
  fs.rmSync(volta, { force: true });
  onLinha?.('Lendo o projeto salvo no Filmcraft…');
  const r = await rodar(cli(), ['--compact', '--project', destino, 'exec', 'file.exportOtio', JSON.stringify({ path: volta })], { cwd: pasta(id) });
  if (r.codigo !== 0 || !fs.existsSync(volta)) throw new Error('O Filmcraft não exportou o projeto:\n' + r.cauda);
  const otio = JSON.parse(fs.readFileSync(volta, 'utf8'));
  // Mídia nova que o usuário importou lá entra em assets/ como qualquer outro material.
  const assets = path.join(caminhoProjeto(id), 'assets');
  const mapaArquivos = {};
  for (const caminho of arquivosDeFora(otio, assets, pasta(id))) {
    if (!fs.existsSync(caminho)) continue;
    const [m] = await importarParaProjeto(id, [caminho], onLinha);
    if (m) mapaArquivos[caminho] = m.arquivo;
  }
  const atual = lerTimeline(id);
  const { timeline, avisos } = deOtio(otio, atual, await comTamanhos(lerProjeto(id), atual), { novoId, mapaArquivos, base: pasta(id) });
  gravarTimeline(id, timeline);
  marcarSincronizado(id);
  return { avisos };
}
