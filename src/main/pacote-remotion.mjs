// Pacote do Remotion guardado por timeline.
//
// Cada "remotion render" a partir do index.ts empacota a composição de novo com o webpack. O cache do webpack é um só
// para o workspace inteiro e é apagado sempre que o ponto de entrada muda ("Webpack config change detected. Clearing
// cache"): como cada projeto tem várias timelines, quase todo export empacotava do zero. Medido na DED 02: 150 quadros
// da camada de textos levaram 89 s com o pacote frio e 9 s a partir de um pacote pronto.
//
// Aqui o pacote é feito uma vez por versão do código da timeline (src/) e reaproveitado. A pasta pública muda a cada
// render (cópias leves dos clipes, só os arquivos usados), então ela não entra no pacote: o pacote procura os arquivos
// em ./public, e essa pasta vira uma junção do Windows (não exige administrador) para a pasta pública do render.
// Apagar a junção não apaga nada no destino.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { carregar } from './settings.mjs';
import { rodarOuFalhar } from './proc.mjs';
import { dirs, caminhoTimeline } from './workspace.mjs';

const pastaPacotes = (id) => path.join(caminhoTimeline(id), '.render');

function arquivosDe(dir) {
  const lista = [];
  const visitar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const c = path.join(d, e.name);
      if (e.isDirectory()) visitar(c);
      else if (e.isFile()) lista.push(c);
    }
  };
  visitar(dir);
  return lista;
}

// Muda quando muda o código da timeline (modelo, blocos, prévia) ou a versão do Remotion.
function impressaoDoCodigo(id, ws) {
  const src = path.join(caminhoTimeline(id), 'src');
  const h = crypto.createHash('sha1');
  try {
    h.update(fs.readFileSync(path.join(ws, 'node_modules', 'remotion', 'package.json')));
  } catch {}
  for (const f of arquivosDe(src)) h.update(path.relative(src, f)).update(fs.readFileSync(f));
  return h.digest('hex').slice(0, 16);
}

// Remove a junção public de um pacote sem seguir para dentro dela.
function soltarPublica(pacote) {
  const p = path.join(pacote, 'public');
  try {
    if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
    else fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

// Pasta do pacote pronto (index.html + bundle.js) para esta timeline. Empacota só se o código mudou.
export async function pacoteRemotion(id, onLinha) {
  const { ws } = dirs();
  const base = pastaPacotes(id);
  const nome = `pacote-${impressaoDoCodigo(id, ws)}`;
  const pacote = path.join(base, nome);
  if (fs.existsSync(path.join(pacote, 'index.html'))) return pacote;
  fs.mkdirSync(base, { recursive: true });
  // Pacotes de versões antigas do código não servem mais.
  for (const n of fs.readdirSync(base)) {
    if (n === nome) continue;
    soltarPublica(path.join(base, n));
    fs.rmSync(path.join(base, n), { recursive: true, force: true });
  }
  onLinha?.('Preparando a composição (só quando o código da timeline muda)…');
  const parcial = pacote + '.tmp';
  const vazia = path.join(base, 'publica-vazia');
  fs.rmSync(parcial, { recursive: true, force: true });
  fs.mkdirSync(vazia, { recursive: true });
  try {
    await rodarOuFalhar(carregar().nodePath, [
      path.join(ws, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'), 'bundle',
      path.join(caminhoTimeline(id), 'src', 'index.ts'), '--out-dir', parcial, '--public-dir', vazia, '--log=error',
    ], { cwd: ws });
    if (!fs.existsSync(path.join(parcial, 'index.html'))) throw new Error('o Remotion não gerou o pacote');
    fs.renameSync(parcial, pacote);
  } finally {
    fs.rmSync(parcial, { recursive: true, force: true });
    fs.rmSync(vazia, { recursive: true, force: true });
  }
  return pacote;
}

// Liga a pasta pública deste render ao pacote. Devolve a função que desliga (chamar no fim do render).
export function usarPublica(pacote, publica) {
  soltarPublica(pacote);
  fs.symlinkSync(path.resolve(publica), path.join(pacote, 'public'), 'junction');
  return () => soltarPublica(pacote);
}

// O que passar ao "remotion render" no lugar do index.ts: o pacote pronto com a pasta pública ligada.
// Se não der para empacotar (ou criar a junção), segue como antes, empacotando no próprio render.
export async function entradaDoRender(id, publica, onLinha) {
  try {
    const pacote = await pacoteRemotion(id, onLinha);
    const soltar = usarPublica(pacote, publica);
    return { entrada: pacote, publicDir: [], soltar };
  } catch (e) {
    onLinha?.(`Sem pacote pronto, empacotando no render: ${String(e.message ?? e).split('\n')[0]}`);
    return { entrada: path.join(caminhoTimeline(id), 'src', 'index.ts'), publicDir: ['--public-dir', publica], soltar: () => {} };
  }
}
