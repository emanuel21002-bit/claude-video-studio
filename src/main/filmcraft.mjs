import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { carregar } from './settings.mjs';
import { recurso, temRecurso } from './recursos.mjs';
import { rodar, rodarOuFalhar } from './proc.mjs';
import { dirs, caminhoTimeline, caminhoAssets, relTimeline, lerProjeto, gravarProjeto } from './workspace.mjs';
import { lerTimeline, gravarTimeline, escreverModelo, importarParaProjeto, novoId, semDesativados } from './timeline.mjs';
import { paraOtio, deOtio, arquivosDeFora } from './otio.mjs';
import { pastaPublica } from './render.mjs';
import { infoVideo } from './transcodificar.mjs';
import { entradaDoRender } from './pacote-remotion.mjs';
import { graficosDaParte, CAMADAS_MESCLA } from './exportar-ffmpeg.mjs';

// Ponte com o Filmcraft (editor nativo, à parte). O app gera um projeto a partir de timeline.json,
// o usuário edita e salva lá, e "Trazer de volta" lê o que foi salvo.

const exe = () => recurso('filmcraft', 'filmcraft.exe');
export const cli = () => recurso('filmcraft', 'filmcraft-cli.exe');

export const filmcraftDisponivel = () => temRecurso('filmcraft', 'filmcraft.exe') && temRecurso('filmcraft', 'filmcraft-cli.exe');

const pasta = (id) => path.join(caminhoTimeline(id), 'filmcraft');
const projetoFc = (id) => path.join(pasta(id), 'projeto.fcproj');


const CAMADAS_GUARDADAS = 6; // frente e fundo de algumas versões
// Só texto e gráficos: mais quadros ao mesmo tempo aceleram bem (medido: 2 → 10 deixou a camada cerca de duas vezes mais rápida).
// Cada aba do Chrome desenhando 1080x1920 gasta uns 600 MB: o paralelo também respeita a memória livre (deixa 2 GB).
const paraleloCamada = () => Math.max(2, Math.min(10, os.cpus().length - 2, Math.floor((os.freemem() - 2 * 1024 ** 3) / (600 * 1024 ** 2))));

// Tudo o que muda o desenho da camada: os itens gráficos, o código do modelo e dos blocos e os arquivos que os blocos citam
// (logo, selo, música de fundo). Mexer só nos cortes dos vídeos não muda nada disso.
function hashDaCamada(id, soGraficos) {
  const src = path.join(caminhoTimeline(id), 'src');
  const h = crypto.createHash('sha1').update(JSON.stringify(soGraficos));
  let codigo = '';
  for (const n of ['index.ts', 'Root.tsx', 'TimelineVideo.tsx', 'lut.tsx', 'blocos.tsx']) {
    const c = path.join(src, n);
    if (!fs.existsSync(c)) continue;
    const txt = fs.readFileSync(c, 'utf8');
    codigo += txt;
    h.update(n).update(txt);
  }
  const assets = caminhoAssets(id);
  if (fs.existsSync(assets)) {
    for (const e of fs.readdirSync(assets, { withFileTypes: true })) {
      if (!e.isFile() || !codigo.includes(e.name)) continue;
      const info = fs.statSync(path.join(assets, e.name));
      h.update(`${e.name}:${info.size}:${info.mtimeMs}`);
    }
  }
  return h.digest('hex');
}

// As camadas do Remotion: { frente, fundo } ({ arquivo, duracao } ou null) e mescla, a lista das camadas em
// multiplicar/tela ({ arquivo, duracao, modo }), da de baixo para a de cima.
export async function renderizarCamadas(id, t, onLinha) {
  const fundo = await renderizarCamada(id, t, onLinha, { parte: 'fundo' });
  const mescla = [];
  for (const [parte, { modo }] of Object.entries(CAMADAS_MESCLA)) {
    const c = await renderizarCamada(id, t, onLinha, { parte });
    if (c) mescla.push({ ...c, modo });
  }
  const frente = await renderizarCamada(id, t, onLinha, { parte: 'frente' });
  return { frente, fundo, mescla };
}

const NOME_PARTE = { fundo: 'o fundo (gráficos por baixo dos vídeos)', multiplicar: 'os gráficos em multiplicar', tela: 'os gráficos em tela' };

// Texto, legendas e blocos são desenhados pelo Remotion: vão como um vídeo transparente, só para referência.
// parte: 'frente' (por cima dos vídeos, o padrão) ou 'fundo' (por baixo deles; ver graficosDaParte).
export async function renderizarCamada(id, t, onLinha, { parte = 'frente' } = {}) {
  const soGraficos = graficosDaParte(t, parte);
  const itens = soGraficos.trilhas.flatMap((tr) => tr.itens);
  if (!itens.length) return null;
  const hash = hashDaCamada(id, soGraficos);
  const saida = path.join(pasta(id), `camada-${hash.slice(0, 12)}.mov`);
  const duracao = Math.max(...itens.map((i) => i.inicio + i.duracao));
  if (fs.existsSync(saida)) {
    // Mesmo texto, legenda e efeito de antes: nada a renderizar. Marca o uso para o arquivo não ser descartado.
    fs.utimesSync(saida, new Date(), new Date());
    onLinha?.(NOME_PARTE[parte] ? `Camada com ${NOME_PARTE[parte]} igual à da última vez: reaproveitando a camada pronta.` : 'Textos, legendas e efeitos iguais aos da última vez: reaproveitando a camada pronta.');
    return { arquivo: saida, duracao };
  }
  // Guarda as últimas camadas: voltar a uma versão anterior (desfazer uma troca de cor, por exemplo) não renderiza de novo.
  const antigas = fs.readdirSync(pasta(id)).filter((n) => /^camada-.*\.mov$/.test(n))
    .map((n) => ({ n, t: fs.statSync(path.join(pasta(id), n)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { n } of antigas.slice(CAMADAS_GUARDADAS - 1)) fs.rmSync(path.join(pasta(id), n), { force: true });
  const props = path.join(pasta(id), 'camada-props.json');
  fs.writeFileSync(props, JSON.stringify({ timeline: soGraficos }));
  onLinha?.(NOME_PARTE[parte] ? `Renderizando ${NOME_PARTE[parte]} para o Filmcraft…` : 'Renderizando textos, legendas e efeitos para o Filmcraft…');
  const s = carregar();
  const { ws } = dirs();
  const parcial = saida + '.tmp.mov';
  const tmp = path.join(pasta(id), 'tmp');
  let soltar = () => {};
  try {
    const publica = await pastaPublica(id, soGraficos, path.join(tmp, 'publico'));
    // Pacote pronto da composição: sem empacotar com o webpack a cada render (ver pacote-remotion.mjs).
    const ent = await entradaDoRender(id, publica, onLinha);
    soltar = ent.soltar;
    await rodarOuFalhar(s.nodePath, [
      path.join(ws, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'), 'render',
      ent.entrada, 'Main', parcial,
      ...ent.publicDir, `--props=${props}`, `--concurrency=${paraleloCamada()}`, '--timeout=120000',
      '--codec=prores', '--prores-profile=4444', '--pixel-format=yuva444p10le', '--image-format=png', '--gl=angle',
      `--frames=0-${Math.ceil(duracao * t.fps) - 1}`,
    ], { cwd: ws, env: { TEMP: tmp, TMP: tmp } });
    fs.renameSync(parcial, saida);
  } finally {
    soltar();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { arquivo: saida, duracao };
}

const estado = (p) => p.filmcraft ?? {};

// Lê do arquivo o tamanho do que a timeline usa: o salvo em materiais pode faltar (logo que o Claude pôs em assets/)
// ou ser anterior à leitura da rotação, e a escala no Filmcraft sairia errada. Também diz se há material HDR.
// tamanhoAntigo: projeto salvo no Filmcraft antes disso, cujas escalas foram calculadas com o tamanho sem girar.
async function comTamanhos(projeto, t, { tamanhoAntigo = false } = {}) {
  const assets = caminhoAssets(projeto.id);
  const medidos = new Map();
  let hdr = false;
  for (const arquivo of new Set(t.trilhas.flatMap((tr) => tr.itens).map((i) => i.arquivo).filter(Boolean))) {
    if (projeto.narracao?.arquivo === arquivo || !fs.existsSync(path.join(assets, arquivo))) continue;
    const info = await infoVideo(path.join(assets, arquivo));
    hdr ||= info.hdr;
    if (!info.largura) continue;
    medidos.set(arquivo, tamanhoAntigo && info.girado ? { largura: info.altura, altura: info.largura } : { largura: info.largura, altura: info.altura });
  }
  const materiais = projeto.materiais.map((m) => {
    if (tamanhoAntigo && m.largura) medidos.delete(m.arquivo);
    return medidos.has(m.arquivo) ? { ...m, ...medidos.get(m.arquivo) } : m;
  });
  const conhecidos = new Set(materiais.map((m) => m.arquivo));
  const extras = [...medidos].filter(([a]) => !conhecidos.has(a)).map(([arquivo, tam]) => ({ arquivo, ...tam }));
  return { ...projeto, materiais: [...materiais, ...extras], hdr };
}

// Salvo no Filmcraft depois da última ida ou volta: abrir de novo descartaria essas edições.
function editadoLa(id) {
  const arq = projetoFc(id);
  if (!fs.existsSync(arq)) return false;
  return fs.statSync(arq).mtimeMs > (estado(lerProjeto(id)).sincronizadoEm ?? 0) + 1000;
}

function marcarSincronizado(id) {
  const p = lerProjeto(id);
  p.filmcraft = { ...estado(p), sincronizadoEm: fs.statSync(projetoFc(id)).mtimeMs, tamanhoGirado: true };
  gravarProjeto(p);
}

// Monta o projeto do Filmcraft a partir da timeline. Devolve o caminho do projeto e os avisos da conversão.
export async function prepararProjetoFilmcraft(id, destino, onLinha) {
  const projeto = lerProjeto(id);
  escreverModelo(projeto);
  const t = semDesativados(lerTimeline(id));
  fs.mkdirSync(pasta(id), { recursive: true });
  const { frente: camada, fundo: camadaFundo, mescla: camadasMescla } = await renderizarCamadas(id, t, onLinha);
  const comTam = await comTamanhos(projeto, t);
  const { otio, avisos } = paraOtio(t, comTam, { assets: caminhoAssets(id), camada, camadaFundo, camadasMescla, hdr: comTam.hdr });
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
  const { frente: camada, fundo: camadaFundo, mescla: camadasMescla } = await renderizarCamadas(id, t, onLinha);
  const comTam = await comTamanhos(projeto, t);
  const { otio, avisos } = paraOtio(t, comTam, { assets: caminhoAssets(id), camada, camadaFundo, camadasMescla, hdr: comTam.hdr });
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
  const assets = caminhoAssets(id);
  const mapaArquivos = {};
  for (const caminho of arquivosDeFora(otio, assets, pasta(id))) {
    if (!fs.existsSync(caminho)) continue;
    const [m] = await importarParaProjeto(id, [caminho], onLinha);
    if (m) mapaArquivos[caminho] = m.arquivo;
  }
  const atual = lerTimeline(id);
  const { timeline, avisos } = deOtio(otio, atual, await comTamanhos(lerProjeto(id), atual, { tamanhoAntigo: !estado(lerProjeto(id)).tamanhoGirado }), { novoId, mapaArquivos, base: pasta(id) });
  gravarTimeline(id, timeline);
  marcarSincronizado(id);
  return { avisos };
}
