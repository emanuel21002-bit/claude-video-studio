import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// FFmpeg, Node, Whisper, skills e engines que vão dentro do instalador.
// Empacotado: <instalação>/resources/recursos. Em desenvolvimento: claude-video-studio/recursos.
const aqui = path.dirname(fileURLToPath(import.meta.url));
export const RECURSOS = app.isPackaged
  ? path.join(process.resourcesPath, 'recursos')
  : path.join(aqui, '..', '..', 'recursos');

export const recurso = (...partes) => path.join(RECURSOS, ...partes);

export const temRecurso = (...partes) => fs.existsSync(recurso(...partes));

// Põe o node.exe e o ffmpeg.exe embutidos na frente do PATH: o app, o Remotion, o HyperFrames
// e os comandos que o Claude roda passam a achá-los sem nada instalado no PC.
export function usarBinariosEmbutidos() {
  if (!temRecurso('bin')) return;
  const chave = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  process.env[chave] = recurso('bin') + path.delimiter + (process.env[chave] ?? '');
}
