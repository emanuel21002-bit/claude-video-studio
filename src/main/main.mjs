import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usarBinariosEmbutidos } from './recursos.mjs';
import { carregar, salvar } from './settings.mjs';
import { todosEstilos, excluirEstilo, FORMATOS } from './presets.mjs';
import { listarMateriais,
  workspacePronto, prepararWorkspace, criarProjeto, novaTimeline, videosNarrados, timelineEmBranco, duplicarTimeline, renomearTimeline, renomearProjeto, excluirTimeline,
  listarProjetos, lerProjeto, gravarProjeto, escreverBriefing, caminhoProjeto, tipoDe, resolverNarracoes, atualizarDocumentacao, dirs,
  adicionarRoteiros, removerRoteiro,
} from './workspace.mjs';
import { migrarProjetos, haProjetosAntigos, PASTA_ANTIGOS } from './migracao.mjs';
import { decuparAudio } from './decupar.mjs';
import { listarPacks, criarPack, atualizarPack, excluirPack, adicionarAoPack, removerDoPack, definirPacksDoProjeto, usarDoPack } from './packs.mjs';
import { lerRoteiro, EXTENSOES_ROTEIRO } from './roteiro.mjs';
import { conferir, trechosSemAudio } from './conferir-nucleo.mjs';
import { whisperDisponivel, transcrever, transcreverArquivo } from './transcricao.mjs';
import { renderizar, estimarRender } from './render.mjs';
import { conversar, cancelar, ocupado, primeiraMensagem, claudeExe } from './agente.mjs';
import { rodar } from './proc.mjs';
import { abrirNoFilmcraft, trazerDoFilmcraft, filmcraftDisponivel } from './filmcraft.mjs';
import { encoderGpu, infoVideo, transcodificar } from './transcodificar.mjs';
import { codificadoresDisponiveis } from './codificadores.mjs';
import { lerTimeline, gravarTimeline, gerarLegendas, resumoLegendas, prepararPrevia, midiaDoArquivo, gerarProxyDe, importarParaProjeto } from './timeline.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
// O nome do app mudou, mas as configurações, a chave de API e os estilos continuam na pasta de antes.
app.setPath('userData', path.join(app.getPath('appData'), 'claude-video-studio'));
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
    backgroundColor: '#1d1d1d',
    title: 'MovAi',
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
    audioInstrucao: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'] }],
    roteiro: [{ name: 'Roteiro (PDF, DOCX, TXT…)', extensions: EXTENSOES_ROTEIRO }],
    referencia: [{ name: 'Vídeos e imagens', extensions: ['mp4', 'mov', 'mkv', 'm4v', 'hevc', 'webm', 'avi', 'png', 'jpg', 'jpeg', 'webp'] }],
  }[tipo];
  const r = await dialog.showOpenDialog(janela, {
    properties: multiplos ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: filtros,
  });
  return r.canceled ? [] : r.filePaths;
});

// Devolve as pastas, não o conteúdo: quem chama expande e sabe avisar quando não há nada dentro.
ipcMain.handle('escolherPasta', async () => {
  const r = await dialog.showOpenDialog(janela, { properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('materiais:listar', (_e, caminhos) => listarMateriais(caminhos));

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

// Por padrão o primeiro vídeo de um lote é montado sozinho e os outros juntos depois dele. O render segue em fila única (GPU de 4 GB).
const fila = [];
const ativos = new Set(); // vídeos sendo montados agora
const preparando = new Set(); // ativos que ainda estão na preparação (transcrição), antes de o Claude começar
const desistidos = new Set();

// Modos (Configurações > Montagem do lote): sequencial, depois-da-primeira (padrão) ou todos.
// Em "depois-da-primeira" o primeiro vídeo do lote roda sozinho e os outros, que leem o visual dele, rodam juntos depois.
function podeComecar(id) {
  const modo = carregar().loteModo ?? 'depois-da-primeira';
  if (modo === 'sequencial') return ativos.size === 0;
  if (ativos.size >= Math.max(1, Number(carregar().loteMaximo) || 3)) return false;
  if (modo === 'todos') return true;
  const ref = lerProjeto(id).pendente?.referencia;
  if (!ref) return ativos.size === 0;
  return !fila.includes(ref) && !ativos.has(ref);
}

function entrarNaFila(id) {
  fila.push(id);
  enviar('agente', { id, tipo: 'fila' });
  rodarFila();
}

function rodarFila() {
  for (let i = 0; i < fila.length; ) {
    const id = fila[i];
    if (!podeComecar(id)) {
      i++;
      continue;
    }
    fila.splice(i, 1);
    ativos.add(id);
    montarProjeto(id)
      .catch((e) => {
        registrarChat(id, { de: 'erro', texto: e.message });
        enviar('agente', { id, tipo: 'erro', texto: e.message });
        enviar('agente', { id, tipo: 'parado' });
      })
      .finally(() => {
        ativos.delete(id);
        preparando.delete(id);
        rodarFila();
      });
  }
}

// O Whisper usa o processador inteiro: transcrições de vídeos que rodam juntos entram numa fila só.
let cadeiaWhisper = Promise.resolve();
function comWhisper(fn) {
  const r = cadeiaWhisper.then(fn, fn);
  cadeiaWhisper = r.catch(() => {});
  return r;
}

async function montarProjeto(id) {
  const projeto = lerProjeto(id);
  const pendente = projeto.pendente ?? {};
  preparando.add(id);
  enviar('agente', { id, tipo: 'inicio' });
  let transcricao = null;
  if ((projeto.narracao || projeto.narradoPor) && whisperDisponivel()) {
    try {
      transcricao = await comWhisper(() => transcrever(projeto, (l) => enviar('agente', { id, tipo: 'preparo', texto: l })));
    } catch (e) {
      registrarChat(id, { de: 'erro', texto: 'Não consegui transcrever: ' + e.message.split('\n')[0] });
      enviar('agente', { id, tipo: 'erro', texto: 'Não consegui transcrever: ' + e.message.split('\n')[0] });
    }
  }
  // Áudios de instrução: transcritos aqui e entregues ao Claude como pedido do usuário.
  const instrucoes = [];
  for (const a of projeto.audiosInstrucao ?? []) {
    if (!whisperDisponivel()) {
      instrucoes.push({ arquivo: a.arquivo, texto: null });
      continue;
    }
    try {
      const r = await comWhisper(() => transcreverArquivo(path.join(caminhoProjeto(id), 'instrucoes', a.arquivo), (l) => enviar('agente', { id, tipo: 'preparo', texto: 'Áudio de referência: ' + l })));
      instrucoes.push({ arquivo: a.arquivo, texto: r.segmentos.map((s) => s.texto).join(' ') });
    } catch (e) {
      instrucoes.push({ arquivo: a.arquivo, texto: null });
      enviar('agente', { id, tipo: 'erro', texto: 'Não consegui transcrever o áudio de referência: ' + e.message.split('\n')[0] });
    }
  }
  escreverBriefing(projeto, transcricao, instrucoes);
  preparando.delete(id);
  if (desistidos.delete(id)) {
    enviar('agente', { id, tipo: 'parado' });
    return;
  }
  const atual = lerProjeto(id);
  delete atual.pendente;
  gravarProjeto(atual);
  registrarChat(id, { de: 'usuario', texto: 'Monte o vídeo a partir do briefing.' });
  await turnoClaude(id, primeiraMensagem(atual, pendente.salvarEstilo, (carregar().loteModo ?? 'depois-da-primeira') === 'todos' ? null : pendente.referencia));
}

// Um projeto só, com os materiais uma vez; uma timeline por narração (sem narração ou só motion, uma timeline).
ipcMain.handle('projeto:criar', async (_e, dados) => {
  const log = (l) => enviar('log', l);
  let narracoes = dados.narracoes?.length ? dados.narracoes : [null];
  const total = narracoes.length;
  const projetoId = await criarProjeto({ ...dados, nome: dados.nome || (total > 1 ? `Projeto ${new Date().toLocaleDateString('pt-BR')}` : '') }, log);
  // Narração no próprio vídeo: uma timeline por vídeo falado, sem áudio de narração à parte.
  if (dados.narradoNoVideo) {
    const narrados = videosNarrados(projetoId, dados.narrados);
    if (!narrados.length) throw new Error('Nenhum dos vídeos enviados tem áudio: sem som não há narração no vídeo.');
    narracoes = narrados.map((m) => ({ nome: m.arquivo.replace(/\.[^.]+$/, ''), narradoPor: m.arquivo }));
  }
  const totalFinal = narracoes.length;
  const criados = [];
  for (const [n, narr] of narracoes.entries()) {
    if (totalFinal > 1) log(`Preparando a timeline ${n + 1} de ${totalFinal}…`);
    const projeto = await novaTimeline(
      projetoId,
      {
        rotulo: narr?.nome,
        narracao: narr?.arquivos ?? null,
        narradoPor: narr?.narradoPor ?? null,
        duracaoMotion: dados.duracaoMotion,
        estiloId: dados.estiloId,
        estiloTexto: dados.estiloTexto,
        engine: dados.engine,
        formato: dados.formato,
        lote: totalFinal > 1 ? { indice: n + 1, total: totalFinal } : null,
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

// Timelines dentro de um projeto, sem o Claude e sem copiar materiais.
const emUso = (id) => ocupado(id) || fila.includes(id) || preparando.has(id) || rendersManuais.has(id);

ipcMain.handle('timeline:nova', (_e, id) => timelineEmBranco(id));
ipcMain.handle('timeline:duplicar', (_e, id) => duplicarTimeline(id));
ipcMain.handle('projeto:renomear', (_e, { id, nome }) => renomearProjeto(id, nome));
ipcMain.handle('timeline:renomear', (_e, { id, rotulo }) => renomearTimeline(id, rotulo));
ipcMain.handle('timeline:excluir', (_e, id) => {
  if (emUso(id)) throw new Error('Esta timeline está em uso: espere o Claude ou o render terminar.');
  excluirTimeline(id);
});

ipcMain.handle('fila:pendentes', () => listarProjetos().filter((p) => p.pendente && !fila.includes(p.id) && !preparando.has(p.id) && !ativos.has(p.id)).map((p) => p.id));
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
  if (preparando.has(id)) desistidos.add(id);
  cancelar(id);
  rendersManuais.get(id)?.abort();
});

ipcMain.handle('render:estimar', (_e, { id, ...escolhas }) => estimarRender(id, escolhas));

ipcMain.handle('render', async (_e, { id, ...opcoes }) => {
  const controle = new AbortController();
  rendersManuais.set(id, controle);
  try {
    const r = await renderizar(id, opcoes, (e) => enviar('agente', { id, tipo: 'render', ...e }), controle.signal);
    enviar('agente', { id, tipo: 'render', concluido: r.preview ?? r.arquivo });
    return r;
  } catch (e) {
    enviar('agente', { id, tipo: 'render', falhou: e.message.split('\n')[0] });
    throw e;
  } finally {
    rendersManuais.delete(id);
  }
});

// Exporta uma lista de vídeos (as timelines de uma pasta) um depois do outro, com as opções de render salvas.
const lotesRender = new Map(); // chave -> AbortController

ipcMain.handle('render:todos', async (_e, { ids, chave, ...opcoes }) => {
  const controle = new AbortController();
  lotesRender.set(chave, controle);
  const resultados = [];
  try {
    for (const [i, id] of ids.entries()) {
      if (controle.signal.aborted) break;
      const nome = lerProjeto(id).nome;
      const lote = (e) => enviar('agente', { id, tipo: 'lote', indice: i + 1, total: ids.length, nome, ...e });
      lote({ etapa: 'Começando', progresso: 0 });
      try {
        const r = await renderizar(id, opcoes, (e) => {
          enviar('agente', { id, tipo: 'render', ...e });
          if (e.etapa) lote({ etapa: e.etapa, progresso: e.progresso ?? 0 });
        }, controle.signal);
        enviar('agente', { id, tipo: 'render', concluido: r.preview ?? r.arquivo });
        resultados.push({ id, nome, ok: true, arquivo: r.arquivo, etapas: r.etapas });
      } catch (e) {
        const motivo = e.message.split('\n')[0];
        enviar('agente', { id, tipo: 'render', falhou: motivo });
        resultados.push({ id, nome, ok: false, erro: motivo });
        if (controle.signal.aborted) break;
      }
    }
  } finally {
    lotesRender.delete(chave);
  }
  return { resultados, cancelado: controle.signal.aborted, total: ids.length };
});

ipcMain.handle('render:cancelar-todos', (_e, chave) => lotesRender.get(chave)?.abort());

// ---------- timeline ----------

ipcMain.handle('timeline:ler', (_e, id) => lerTimeline(id));
ipcMain.handle('filmcraft:abrir', (_e, { id, descartar }) => abrirNoFilmcraft(id, { descartar }, (l) => enviar('log', l)));
ipcMain.handle('filmcraft:trazer', (_e, id) => trazerDoFilmcraft(id, (l) => enviar('log', l)));
ipcMain.handle('timeline:salvar', (_e, { id, timeline }) => gravarTimeline(id, timeline));
ipcMain.handle('timeline:previa', (_e, id) => prepararPrevia(id));
ipcMain.handle('timeline:midia', (_e, { id, arquivo, extras }) => midiaDoArquivo(id, arquivo, { extras }));
ipcMain.handle('timeline:proxy', (_e, { id, arquivo }) => gerarProxyDe(id, arquivo).catch(() => null));
ipcMain.handle('timeline:legendas', (_e, { id, opcoes }) => resumoLegendas(gerarLegendas(id, opcoes)));
ipcMain.handle('roteiro:adicionar', (_e, { id, caminhos }) => adicionarRoteiros(id, caminhos));
ipcMain.handle('roteiro:remover', (_e, { id, arquivo }) => removerRoteiro(id, arquivo));
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

ipcMain.handle('transcode:codificadores', () => codificadoresDisponiveis());

ipcMain.handle('transcode:iniciar', async (_e, { arquivos, formato, modo, pastaSaida, codificador, qualidade, velocidade, audio, resolucao, ajuste }) => {
  conversaoAtual = new AbortController();
  const sinal = conversaoAtual.signal;
  // Os eventos só mostram o andamento; o estado final de cada arquivo volta no retorno,
  // porque a resposta do invoke pode chegar antes do último evento.
  const resultados = arquivos.map(() => ({ status: 'aguardando', progresso: 0 }));
  for (let i = 0; i < arquivos.length; i++) {
    if (sinal.aborted) break;
    enviar('transcode', { indice: i, status: 'convertendo', progresso: 0 });
    try {
      const r = await transcodificar(arquivos[i], { formato, modo, pastaSaida, codificador, qualidade, velocidade, audio, resolucao, ajuste }, (p) =>
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

// ---------- packs de edição ----------

ipcMain.handle('packs:listar', () => listarPacks());
ipcMain.handle('packs:criar', (_e, nome) => criarPack(nome));
ipcMain.handle('packs:atualizar', (_e, { id, ...campos }) => atualizarPack(id, campos));
ipcMain.handle('packs:excluir', (_e, id) => excluirPack(id));
ipcMain.handle('packs:adicionar', (_e, { id, caminhos }) => adicionarAoPack(id, caminhos, (p) => enviar('packs:progresso', p)));
ipcMain.handle('packs:remover', (_e, { id, arquivos }) => removerDoPack(id, arquivos));
ipcMain.handle('packs:projeto', (_e, { id, packs }) => definirPacksDoProjeto(id, packs));
ipcMain.handle('packs:usar', (_e, { id, pack, arquivos }) => usarDoPack(id, pack, arquivos));

// ---------- decupagem de narrações ----------

let decupagemAtual = null;
// (a conferência com o roteiro fica mais abaixo)

// Cada arquivo de áudio é um item; cada pasta com áudios é um item só (os áudios dela são partes de uma mesma narração).
ipcMain.handle('decupar:info', async (_e, caminhos) => {
  const itens = await resolverNarracoes(caminhos);
  return itens.map((n) => {
    const solto = n.arquivos.length === 1 && caminhos.includes(n.arquivos[0]);
    return solto
      ? { arquivo: n.arquivos[0], arquivos: n.arquivos, duracao: n.duracao }
      : { arquivo: path.dirname(n.arquivos[0]), arquivos: n.arquivos, pasta: true, nome: n.nome, duracao: n.duracao };
  });
});

// itens: [{ arquivo, arquivos, pasta }]. Pasta = partes de uma narração, juntadas antes de decupar.
ipcMain.handle('decupar:iniciar', async (_e, { itens: arquivos, opcoes }) => {
  decupagemAtual = new AbortController();
  const sinal = decupagemAtual.signal;
  const resultados = arquivos.map(() => ({ status: 'aguardando', progresso: 0 }));
  for (let i = 0; i < arquivos.length; i++) {
    if (sinal.aborted) break;
    enviar('decupar', { indice: i, status: 'decupando', progresso: 0 });
    try {
      const r = await decuparAudio(arquivos[i].pasta ? { pasta: arquivos[i].arquivo, arquivos: arquivos[i].arquivos } : arquivos[i].arquivo, opcoes, (p) => enviar('decupar', { indice: i, status: 'decupando', progresso: p }), sinal);
      resultados[i] = { status: 'pronto', progresso: 1, ...r };
    } catch (e) {
      resultados[i] = sinal.aborted ? { status: 'aguardando', progresso: 0 } : { status: 'erro', progresso: 0, erro: e.message.split('\n')[0] };
    }
    enviar('decupar', { indice: i, ...resultados[i] });
  }
  decupagemAtual = null;
  return resultados;
});

ipcMain.handle('decupar:cancelar', () => {
  decupagemAtual?.abort();
  conferenciaAtual?.abort();
});

// Roteiro de referência: qualquer formato vira texto, e a transcrição de cada áudio é comparada com ele.
ipcMain.handle('roteiro:ler', async (_e, arquivo) => {
  try {
    return { arquivo, texto: await lerRoteiro(arquivo) };
  } catch (e) {
    return { arquivo, erro: e.message.split('\n')[0] };
  }
});

ipcMain.handle('roteiro:escolher', async () => {
  const r = await dialog.showOpenDialog(janela, {
    properties: ['openFile'],
    filters: [{ name: 'Roteiro (PDF, DOCX, TXT…)', extensions: EXTENSOES_ROTEIRO }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  if (r.canceled) return null;
  try {
    return { arquivo: r.filePaths[0], texto: await lerRoteiro(r.filePaths[0]) };
  } catch (e) {
    return { arquivo: r.filePaths[0], erro: e.message.split('\n')[0] };
  }
});

let conferenciaAtual = null;
const transcricoesCache = new Map(); // "arquivo|mtime" -> texto, para conferir de novo sem transcrever outra vez

ipcMain.handle('decupar:conferir', async (_e, { arquivos, roteiro }) => {
  if (!whisperDisponivel()) throw new Error('O Whisper não está configurado: sem ele não dá para transcrever os áudios (veja Configurações).');
  conferenciaAtual = new AbortController();
  const sinal = conferenciaAtual.signal;
  const resultados = arquivos.map(() => null);
  try {
    for (let i = 0; i < arquivos.length; i++) {
      if (sinal.aborted) break;
      enviar('conferir', { indice: i, progresso: 0 });
      try {
        // Narração em partes (pasta): transcreve cada parte e junta os textos na ordem, para bater com o roteiro inteiro.
        const partes = arquivos[i];
        const textos = [];
        for (let p = 0; p < partes.length; p++) {
          const chave = `${partes[p]}|${fs.statSync(partes[p]).mtimeMs}`;
          let texto = transcricoesCache.get(chave);
          if (texto == null) {
            const r = await transcreverArquivo(partes[p], (l) => {
              const m = l.match(/(\d+)%/);
              if (m) enviar('conferir', { indice: i, progresso: (p + Number(m[1]) / 100) / partes.length });
            }, sinal);
            texto = r.segmentos.map((s) => s.texto).join(' ');
            transcricoesCache.set(chave, texto);
          }
          textos.push(texto);
        }
        resultados[i] = conferir(textos.join(' '), roteiro);
      } catch (e) {
        resultados[i] = sinal.aborted ? null : { erro: e.message.split('\n')[0] };
      }
      enviar('conferir', { indice: i, progresso: 1, pronto: true });
    }
  } finally {
    conferenciaAtual = null;
  }
  const faixas = resultados.filter((r) => r && !r.erro && !r.vazio).map((r) => [r.inicio, r.fim]);
  return { resultados, semAudio: trechosSemAudio(roteiro, faixas), cancelado: sinal.aborted };
});

// Projetos do formato antigo são reorganizados antes da primeira janela. Não apaga nada: as pastas de antes ficam em
// projetos-antigos/ até o usuário decidir apagá-las.
async function reorganizarProjetos() {
  const { ws } = dirs();
  if (!ws || !haProjetosAntigos(ws)) return;
  const aviso = new BrowserWindow({ width: 460, height: 130, frame: false, resizable: false, backgroundColor: '#1d1d1d', show: true });
  aviso.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font:14px sans-serif;color:#ddd;background:#0f1013;padding:30px;text-align:center">Reorganizando os projetos para o novo formato…<br><small>Só desta vez. Não feche o app.</small></body>'));
  const { erros } = await migrarProjetos(ws);
  aviso.destroy();
  if (erros.length) {
    dialog.showErrorBox('Alguns projetos não foram reorganizados', `Eles continuam em ${path.join(ws, 'projetos')}, sem alteração, e não aparecem no app.\n\n${erros.map((e) => `${e.nome}: ${e.erro}`).join('\n')}`);
  }
}

app.whenReady().then(async () => {
  await reorganizarProjetos().catch((e) => dialog.showErrorBox('Não consegui reorganizar os projetos', e.message));
  atualizarDocumentacao();
  criarJanela();
});
app.on('window-all-closed', () => app.quit());
