import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { recurso, temRecurso } from './recursos.mjs';

const ARQUIVO = () => path.join(app.getPath('userData'), 'settings.json');

// Whisper com CUDA instalado à parte (mais rápido); sem ele, usa o embutido no instalador.
const WHISPER_CUDA = 'C:\\Claude\\App integrado\\whisper-cuda\\Release';
const WHISPER_PADRAO = fs.existsSync(WHISPER_CUDA)
  ? { whisperDir: WHISPER_CUDA, whisperModelo: 'ggml-medium.bin' }
  : { whisperDir: recurso('whisper'), whisperModelo: 'ggml-medium-q5_0.bin' };

export const PADRAO = {
  workspaceDir: '', // preenchido em carregar()
  ...WHISPER_PADRAO,
  skillsOrigem: temRecurso('skills') ? recurso('skills') : 'C:\\Claude\\App integrado\\.claude\\skills',
  nodePath: 'node',
  ffmpegPath: 'ffmpeg',
  modeloClaude: 'claude-opus-5-5',
  esforcoClaude: 'high', // low | medium | high | xhigh
  apiKey: '',
  renderModo: 'gpu', // gpu | cpu
  renderMotor: 'filmcraft', // filmcraft | remotion
  renderFormato: 'mp4', // mp4 | mov
  renderResolucao: 0, // lado menor em pixels (720, 1080, 1440, 2160); 0 = a resolução do projeto
  renderQualidade: 'recomendado', // alta | recomendado | baixa (taxa de bits)
  renderCodec: null, // h264 | hevc | prores; null = ainda não escolhido na janela de exportação
  renderFps: 0, // 0 = o do projeto
  renderPasta: '', // vazio = renders/ da timeline
  renderSemAudio: false,
};

// Arquivo próprio do app, ao lado das configurações.
export const arquivoDoApp = (nome) => path.join(app.getPath('userData'), nome);

let atual = null;

export function carregar() {
  if (atual) return atual;
  let salvo = {};
  try {
    salvo = JSON.parse(fs.readFileSync(ARQUIVO(), 'utf8'));
  } catch {}
  atual = { ...PADRAO, ...salvo };
  // Caminhos salvos que deixaram de existir (pasta apagada, app reinstalado em outro lugar) voltam ao padrão.
  if (!fs.existsSync(path.join(atual.whisperDir, atual.whisperModelo))) Object.assign(atual, WHISPER_PADRAO);
  if (!fs.existsSync(atual.skillsOrigem)) atual.skillsOrigem = PADRAO.skillsOrigem;
  if (!atual.workspaceDir) {
    atual.workspaceDir = path.join(app.getPath('documents'), 'Claude Video Studio');
  }
  return atual;
}

export function salvar(parcial) {
  atual = { ...carregar(), ...parcial };
  fs.mkdirSync(path.dirname(ARQUIVO()), { recursive: true });
  fs.writeFileSync(ARQUIVO(), JSON.stringify(atual, null, 2));
  return atual;
}
