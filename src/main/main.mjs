import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usarBinariosEmbutidos } from './recursos.mjs';
import { carregar, salvar } from './settings.mjs';
import { todosEstilos, excluirEstilo, FORMATOS } from './presets.mjs';
import {
  workspacePronto, prepararWorkspace, criarProjeto, listarProjetos, lerProjeto, gravarProjeto,
  escreverBriefing, caminhoProjeto, tipoDe, resolverNarracoes,
} from './workspace.mjs';
import { whisperDisponivel, transcrever } from './transcricao.mjs';
import { renderizar } from './render.mjs';
import { conversar, cancelar, primeiraMensagem, claudeExe } from './agente.mjs';
import { rodar } from './proc.mjs';
import { abrirNoFilmcraft, trazerDoFilmcraft, filmcraftDisponivel } from './filmcraft.mjs';
import { encoderGpu, infoVideo, transcodificar } from './transcodificar.mjs';
import { lerTimeline, gravarTimeline, gerarLegendas, prepararPrevia, midiaDoArquivo, importarParaProjeto } from './timeline.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
usarBinariosEmbutidos();
let janela;
const rendersManuais = new Map(); // id -> AbortController

function enviar(canal, dados) {
  if (janela && !janela.isDestroyed()) janela.webContents.send(canal, dados);
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1013',
    title: 'Claude Video Studio',
    icon: path.join(aqui, '..', '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(aqui, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      // Captura de teste: renderização offscreen não depende de a janela estar visível.
      offscreen: !!process.env.CVS_SCREENSHOT,
    },
  });
  janela.loadFile(path.join(aqui, '..', 'renderer', 'index.html'));

  // Para testes: CVS_SCREENSHOT=<arquivo.png> salva uma captura da janela e fecha o app.
  if (process.env.CVS_SCREENSHOT) {
    janela.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        if (process.env.CVS_SCREENSHOT_JS) {
          await janela.webContents.executeJavaScript(process.env.CVS_SCREENSHOT_JS);
          await new Promise((r) => setTimeout(r, 1500));
        }
        janela.webContents.invalidate();
        await new Promise((r) => setTimeout(r, 300));
        const img = await janela.webContents.capturePage();
        fs.writeFileSync(process.env.CVS_SCREENSHOT, img.toPNG());
        app.quit();
      }, Number(process.env.CVS_SCREENSHOT_ESPERA ?? 4000)),
    );
  }
}

// ---------- verificação do ambiente ----------

async function existeComando(cmd, args = ['-version']) {
  try {
    const r = await rodar(cmd, args, { shell: false });
    return r.codigo === 0;
  } catch {
    return false;
  }
}

async function statusClaude() {
  const s = carregar();
  if (s.apiKey) return { conectado: true, metodo: 'Chave de API' };
  const exe = claudeExe();
  if (!exe) return { conectado: false, metodo: 'Claude Code não encontrado' };
  let saida = '';
  await rodar(exe, ['auth', 'status'], { onLinha: (l) => (saida += l + '\n') });
  try {
    const j = JSON.parse(saida);
    return { conectado: !!j.loggedIn, metodo: j.loggedIn ? (j.authMethod === 'claude.ai' ? 'Conta Claude' : j.authMethod) : 'Não conectado', email: j.email };
  } catch {
    return { conectado: false, metodo: 'Não conectado' };
  }
}

ipcMain.handle('ambiente', async () => {
  const [node, ffmpeg, encoder, claude] = await Promise.all([
    existeComando(carregar().nodePath, ['--version']),
    existeComando(carregar().ffmpegPath),
    encoderGpu(),
    statusClaude(),
  ]);
  return {
    workspace: carregar().workspaceDir,
    workspacePronto: workspacePronto(),
    node,
    ffmpeg,
    encoderGpu: encoder,
    filmcraft: filmcraftDisponivel(),
    whisper: whisperDisponivel(),
    claude,
  };
});

ipcMain.handle('claude:login', () => {
  const exe = claudeExe();
  spawn('cmd.exe', ['/c', `start "Entrar no Claude" "${exe}" auth login`], {
    windowsVerbatimArguments: true,
    detached: true,
    stdio: 'ignore',
  }).unref();
});

ipcMain.handle('claude:status', () => statusClaude());

ipcMain.handle('workspace:preparar', async () => {
  await prepararWorkspace((l) => enviar('log', l));
  return workspacePronto();
});

// ---------- configurações ----------

ipcMain.handle('config:ler', () => carregar());
ipcMain.handle('config:salvar', (_e, parcial) => salvar(parcial));
ipcMain.handle('catalogo', () => ({ estilos: todosEstilos(), formatos: Object.keys(FORMATOS) }));
ipcMain.handle('estilo:excluir', (_e, id) => excluirEstilo(id));

// ---------- arquivos ----------

ipcMain.handle('escolher', async (_e, { tipo, multiplos }) => {
  const filtros = {
    materiais: [{ name: 'Vídeos, imagens e áudios', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp3', 'wav', 'm4a'] }],
    narracao: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }],
    videos: [{ name: 'Vídeos', extensions: ['mp4', 'mov', 'mkv', 'm4v', 'hevc', 'webm', 'avi'] }],
  }[tipo];
  const r = await dialog.showOpenDialog(janela, {
    properties: multiplos ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: filtros,
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('escolherPasta', async () => {
  const r = await dialog.showOpenDialog(janela, { properties: ['openDirectory'] });
  if (r.canceled) return [];
  const pasta = r.filePaths[0];
  return fs
    .readdirSync(pasta, { withFileTypes: true })
    .filter((d) => d.isFile() && tipoDe(d.name) !== 'outro')
    .map((d) => path.join(pasta, d.name));
});

ipcMain.handle('escolherPastas', async () => {
  const r = await dialog.showOpenDialog(janela, { properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('narracoes:resolver', (_e, caminhos) => resolverNarracoes(caminhos));

ipcMain.handle('tipoArquivo', (_e, arquivo) => tipoDe(arquivo));
ipcMain.handle('mostrarNaPasta', (_e, arquivo) => shell.showItemInFolder(arquivo));
ipcMain.handle('abrirPasta', (_e, id) => shell.openPath(caminhoProjeto(id)));

// ---------- projetos ----------

ipcMain.handle('projetos', () => listarProjetos());
ipcMain.handle('projeto', (_e, id) => lerProjeto(id));

function registrarChat(id, item) {
  const p = lerProjeto(id);
  p.chat.push({ ...item, em: new Date().toISOString() });
  gravarProjeto(p);
}

function turnoClaude(id, mensagem) {
  enviar('agente', { id, tipo: 'inicio' });
  return conversar(id, mensagem, (e) => {
    if (e.tipo === 'texto') registrarChat(id, { de: 'claude', texto: e.texto });
    if (e.tipo === 'acao') registrarChat(id, { de: 'acao', texto: e.texto });
    if (e.tipo === 'erro') registrarChat(id, { de: 'erro', texto: e.texto });
    enviar('agente', { id, ...e });
  }).finally(() => enviar('agente', { id, tipo: 'parado' }));
}

// ---------- fila de montagem ----------

// Os vídeos são montados um de cada vez: GPU de 4 GB, limite de uso do Claude e o Whisper não aguentam vários juntos.
const fila = [];
let filaAtiva = false;
let preparando = null;
const desistidos = new Set();

function entrarNaFila(id) {
  fila.push(id);
  enviar('agente', { id, tipo: 'fila' });
  rodarFila();
}

async function rodarFila() {
  if (filaAtiva) return;
  filaAtiva = true;
  while (fila.length) {
    const id = fila.shift();
    try {
      await montarProjeto(id);
    } catch (e) {
      registrarChat(id, { de: 'erro', texto: e.message });
      enviar('agente', { id, tipo: 'erro', texto: e.message });
      enviar('agente', { id, tipo: 'parado' });
    }
  }
  filaAtiva = false;
}

async function montarProjeto(id) {
  const projeto = lerProjeto(id);
  const pendente = projeto.pendente ?? {};
  preparando = id;
  enviar('agente', { id, tipo: 'inicio' });
  let transcricao = null;
  if (projeto.narracao && whisperDisponivel()) {
    try {
      transcricao = await transcrever(projeto, (l) => enviar('agente', { id, tipo: 'preparo', texto: l }));
    } catch (e) {
      registrarChat(id, { de: 'erro', texto: 'Não consegui transcrever: ' + e.message.split('\n')[0] });
      enviar('agente', { id, tipo: 'erro', texto: 'Não consegui transcrever: ' + e.message.split('\n')[0] });
    }
  }
  escreverBriefing(projeto, transcricao);
  preparando = null;
  if (desistidos.delete(id)) {
    enviar('agente', { id, tipo: 'parado' });
    return;
  }
  const atual = lerProjeto(id);
  delete atual.pendente;
  gravarProjeto(atual);
  registrarChat(id, { de: 'usuario', texto: 'Monte o vídeo a partir do briefing.' });
  await turnoClaude(id, primeiraMensagem(atual, pendente.salvarEstilo, pendente.referencia));
}

// Um projeto por narração; sem narração (ou só motion), um projeto só.
ipcMain.handle('projeto:criar', async (_e, dados) => {
  const log = (l) => enviar('log', l);
  const narracoes = dados.narracoes?.length ? dados.narracoes : [null];
  const convertidos = new Map();
  const criados = [];
  for (const [n, narr] of narracoes.entries()) {
    const total = narracoes.length;
    if (total > 1) log(`Preparando o vídeo ${n + 1} de ${total}…`);
    const projeto = await criarProjeto(
      {
        ...dados,
        nome: total > 1 ? [dados.nome, narr.nome].filter(Boolean).join(' — ') : dados.nome,
        narracao: narr?.arquivos ?? null,
        lote: total > 1 ? { indice: n + 1, total } : null,
        convertidos,
      },
      log,
    );
    // Fica gravado até o Claude começar: se o app fechar antes, dá para continuar a fila depois.
    projeto.pendente = { salvarEstilo: n === 0 && dados.salvarEstilo, referencia: n > 0 ? criados[0].id : null };
    gravarProjeto(projeto);
    criados.push(projeto);
  }
  criados.forEach((p) => entrarNaFila(p.id));
  return criados.map((p) => lerProjeto(p.id));
});

ipcMain.handle('fila:pendentes', () => listarProjetos().filter((p) => p.pendente && !fila.includes(p.id) && preparando !== p.id).map((p) => p.id));
ipcMain.handle('fila:retomar', (_e, ids) => ids.forEach(entrarNaFila));
ipcMain.handle('fila:descartar', (_e, ids) => {
  for (const id of ids) {
    const p = lerProjeto(id);
    delete p.pendente;
    gravarProjeto(p);
  }
});

ipcMain.handle('chat:enviar', (_e, { id, texto, contexto }) => {
  registrarChat(id, { de: 'usuario', texto });
  turnoClaude(id, contexto ? `${texto}\n\n[Timeline: ${contexto}]` : texto);
});

ipcMain.handle('chat:cancelar', (_e, id) => {
  const naFila = fila.indexOf(id);
  if (naFila >= 0) {
    fila.splice(naFila, 1);
    const p = lerProjeto(id);
    delete p.pendente;
    gravarProjeto(p);
    enviar('agente', { id, tipo: 'parado' });
    return;
  }
  if (preparando === id) desistidos.add(id);
  cancelar(id);
  rendersManuais.get(id)?.abort();
});

ipcMain.handle('render', async (_e, { id, modo, formato }) => {
  const controle = new AbortController();
  rendersManuais.set(id, controle);
  try {
    const r = await renderizar(id, { modo, formato }, (e) => enviar('agente', { id, tipo: 'render', ...e }), controle.signal);
    enviar('agente', { id, tipo: 'render', concluido: r.preview ?? r.arquivo });
    return r;
  } catch (e) {
    enviar('agente', { id, tipo: 'render', falhou: e.message.split('\n')[0] });
    throw e;
  } finally {
    rendersManuais.delete(id);
  }
});

// ---------- timeline ----------

ipcMain.handle('timeline:ler', (_e, id) => lerTimeline(id));
ipcMain.handle('filmcraft:abrir', (_e, { id, descartar }) => abrirNoFilmcraft(id, { descartar }, (l) => enviar('log', l)));
ipcMain.handle('filmcraft:trazer', (_e, id) => trazerDoFilmcraft(id, (l) => enviar('log', l)));
ipcMain.handle('timeline:salvar', (_e, { id, timeline }) => gravarTimeline(id, timeline));
ipcMain.handle('timeline:previa', (_e, id) => prepararPrevia(id));
ipcMain.handle('timeline:midia', (_e, { id, arquivo }) => midiaDoArquivo(id, arquivo));
ipcMain.handle('timeline:legendas', (_e, { id, opcoes }) => gerarLegendas(id, opcoes));
ipcMain.handle('timeline:importar', (_e, { id, caminhos }) => importarParaProjeto(id, caminhos, (l) => enviar('log', l)));

// ---------- transcodificador H.265 → H.264 ----------

let conversaoAtual = null;

ipcMain.handle('transcode:info', async (_e, arquivos) =>
  Promise.all(arquivos.map(async (a) => ({ arquivo: a, ...(await infoVideo(a)) }))),
);

ipcMain.handle('transcode:pasta', async () => {
  const r = await dialog.showOpenDialog(janela, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('transcode:iniciar', async (_e, { arquivos, formato, modo, pastaSaida }) => {
  conversaoAtual = new AbortController();
  const sinal = conversaoAtual.signal;
  // Os eventos só mostram o andamento; o estado final de cada arquivo volta no retorno,
  // porque a resposta do invoke pode chegar antes do último evento.
  const resultados = arquivos.map(() => ({ status: 'aguardando', progresso: 0 }));
  for (let i = 0; i < arquivos.length; i++) {
    if (sinal.aborted) break;
    enviar('transcode', { indice: i, status: 'convertendo', progresso: 0 });
    try {
      const r = await transcodificar(arquivos[i], { formato, modo, pastaSaida }, (p) =>
        enviar('transcode', { indice: i, status: 'convertendo', progresso: p }),
        sinal,
      );
      resultados[i] = { status: 'pronto', progresso: 1, ...r };
    } catch (e) {
      resultados[i] = sinal.aborted ? { status: 'aguardando', progresso: 0 } : { status: 'erro', progresso: 0, erro: e.message.split('\n')[0] };
    }
    enviar('transcode', { indice: i, ...resultados[i] });
  }
  conversaoAtual = null;
  return resultados;
});

ipcMain.handle('transcode:cancelar', () => conversaoAtual?.abort());

app.whenReady().then(criarJanela);
app.on('window-all-closed', () => app.quit());
