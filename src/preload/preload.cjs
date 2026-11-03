const { contextBridge, ipcRenderer, webUtils } = require('electron');

const chamar = (canal) => (...args) => ipcRenderer.invoke(canal, ...args);
const ouvir = (canal) => (fn) => {
  const h = (_e, dados) => fn(dados);
  ipcRenderer.on(canal, h);
  return () => ipcRenderer.removeListener(canal, h);
};

contextBridge.exposeInMainWorld('studio', {
  ambiente: chamar('ambiente'),
  loginClaude: chamar('claude:login'),
  statusClaude: chamar('claude:status'),
  prepararWorkspace: chamar('workspace:preparar'),
  lerConfig: chamar('config:ler'),
  salvarConfig: chamar('config:salvar'),
  catalogo: chamar('catalogo'),
  excluirEstilo: chamar('estilo:excluir'),
  escolher: chamar('escolher'),
  escolherPasta: chamar('escolherPasta'),
  escolherPastas: chamar('escolherPastas'),
  resolverNarracoes: chamar('narracoes:resolver'),
  filaPendentes: chamar('fila:pendentes'),
  retomarFila: chamar('fila:retomar'),
  descartarFila: chamar('fila:descartar'),
  tipoArquivo: chamar('tipoArquivo'),
  mostrarNaPasta: chamar('mostrarNaPasta'),
  abrirPasta: chamar('abrirPasta'),
  projetos: chamar('projetos'),
  projeto: chamar('projeto'),
  criarProjeto: chamar('projeto:criar'),
  enviarChat: chamar('chat:enviar'),
  cancelar: chamar('chat:cancelar'),
  renderizar: chamar('render'),
  lerTimeline: chamar('timeline:ler'),
  salvarTimeline: chamar('timeline:salvar'),
  previaTimeline: chamar('timeline:previa'),
  midiaTimeline: chamar('timeline:midia'),
  legendasTimeline: chamar('timeline:legendas'),
  importarTimeline: chamar('timeline:importar'),
  abrirFilmcraft: chamar('filmcraft:abrir'),
  trazerFilmcraft: chamar('filmcraft:trazer'),
  infoVideos: chamar('transcode:info'),
  pastaSaida: chamar('transcode:pasta'),
  transcodificar: chamar('transcode:iniciar'),
  cancelarTranscode: chamar('transcode:cancelar'),
  aoTranscode: ouvir('transcode'),
  caminhoDoArquivo: (file) => webUtils.getPathForFile(file),
  aoLog: ouvir('log'),
  aoAgente: ouvir('agente'),
});
