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

// Ponte com o Filmcraft (editor nativo, à parte). O app gera um projeto a partir de timeline.json,
// o usuário edita e salva lá, e "Trazer de volta" lê o que foi salvo.

const exe = () => recurso('filmcraft', 'filmcraft.exe');
const cli = () => recurso('filmcraft', 'filmcraft-cli.exe');

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
  await rodarOuFalhar(s.nodePath, [
    path.join(ws, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'), 'render',
    path.join(projeto, 'src', 'index.ts'), 'Main', parcial,
    '--public-dir', path.join(projeto, 'assets'), `--props=${props}`,
    '--codec=prores', '--prores-profile=4444', '--pixel-format=yuva444p10le', '--image-format=png', '--gl=angle',
    `--frames=0-${Math.ceil(duracao * t.fps) - 1}`,
  ], { cwd: ws });
  fs.renameSync(parcial, saida);
  return { arquivo: saida, duracao };
}

const estado = (p) => p.filmcraft ?? {};

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

export async function abrirNoFilmcraft(id, { descartar = false } = {}, onLinha) {
  if (!filmcraftDisponivel()) throw new Error('O Filmcraft não está em recursos\\filmcraft.');
  if (!descartar && editadoLa(id)) return { pendente: true };
  const projeto = lerProjeto(id);
  escreverModelo(projeto);
  const t = lerTimeline(id);
  fs.mkdirSync(pasta(id), { recursive: true });
  const camada = await renderizarCamada(id, t, onLinha);
  const { otio, avisos } = paraOtio(t, projeto, { assets: path.join(caminhoProjeto(id), 'assets'), camada });
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
  const { timeline, avisos } = deOtio(otio, lerTimeline(id), lerProjeto(id), { novoId, mapaArquivos, base: pasta(id) });
  gravarTimeline(id, timeline);
  marcarSincronizado(id);
  return { avisos };
}
