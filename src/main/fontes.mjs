import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dirs, caminhoAssets } from './workspace.mjs';
import { nomesDoArquivo, FONTE_DE_SIMBOLOS } from './fontes-nucleo.mjs';

const EXT = new Set(['.ttf', '.otf', '.ttc', '.otc']);

function pastasDoSistema() {
  if (process.platform === 'win32') {
    return [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')];
  }
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts')];
  return ['/usr/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local', 'share', 'fonts')];
}

function arquivosDeFonte(pasta, profundidade = 0) {
  let itens;
  try {
    itens = fs.readdirSync(pasta, { withFileTypes: true });
  } catch {
    return [];
  }
  return itens.flatMap((d) => {
    const p = path.join(pasta, d.name);
    if (d.isDirectory()) return profundidade < 3 ? arquivosDeFonte(p, profundidade + 1) : [];
    return EXT.has(path.extname(d.name).toLowerCase()) ? [p] : [];
  });
}

// Famílias instaladas no computador, em ordem alfabética. Fica em cache até pedirem de novo (atualizar).
let cacheSistema = null;
export function fontesDoSistema(atualizar = false) {
  if (cacheSistema && !atualizar) return cacheSistema;
  const familias = new Set();
  for (const pasta of pastasDoSistema()) {
    for (const arq of arquivosDeFonte(pasta)) {
      try {
        for (const { familia } of nomesDoArquivo(arq)) if (!FONTE_DE_SIMBOLOS.test(familia)) familias.add(familia);
      } catch {
        /* arquivo ilegível */
      }
    }
  }
  cacheSistema = [...familias].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  return cacheSistema;
}

// ---------- fontes do usuário (biblioteca do app) ----------
// Ficam em <workspace>/fontes/ com um índice; ao usar numa timeline, a cópia vai para os assets do projeto.

const pastaBiblioteca = () => path.join(dirs().ws, 'fontes');
const indice = () => path.join(pastaBiblioteca(), 'fontes.json');

export function minhasFontes() {
  try {
    return JSON.parse(fs.readFileSync(indice(), 'utf8'));
  } catch {
    return [];
  }
}

// Copia os arquivos para a biblioteca. Devolve { minhas, novas, ignoradas }.
export function adicionarFontes(caminhos) {
  fs.mkdirSync(pastaBiblioteca(), { recursive: true });
  const lista = minhasFontes();
  const novas = [];
  const ignoradas = [];
  for (const origem of caminhos) {
    let nomes = [];
    try {
      nomes = EXT.has(path.extname(origem).toLowerCase()) ? nomesDoArquivo(origem) : [];
    } catch {
      /* cai em ignoradas */
    }
    if (!nomes.length) {
      ignoradas.push(path.basename(origem));
      continue;
    }
    const arquivo = path.basename(origem).replace(/[^\w.\- ()]/g, '_');
    fs.copyFileSync(origem, path.join(pastaBiblioteca(), arquivo));
    // Uma família pode ter vários arquivos (Regular, Bold…): o primeiro adicionado representa a família na timeline.
    const { familia, estilo } = nomes[0];
    if (!lista.some((f) => f.familia === familia)) {
      lista.push({ familia, estilo, arquivo });
      novas.push(familia);
    }
  }
  fs.writeFileSync(indice(), JSON.stringify(lista, null, 2));
  return { minhas: lista, novas, ignoradas };
}

export function removerFonte(familia) {
  const lista = minhasFontes().filter((f) => f.familia !== familia);
  fs.writeFileSync(indice(), JSON.stringify(lista, null, 2));
  return lista;
}

// Copia a fonte do usuário para os assets do projeto (a composição a carrega de lá) e devolve o nome do arquivo.
export function prepararFonte(id, familia) {
  const f = minhasFontes().find((x) => x.familia === familia);
  const origem = f && path.join(pastaBiblioteca(), f.arquivo);
  if (!origem || !fs.existsSync(origem)) return null;
  const nome = `fonte--${f.arquivo}`;
  const destino = path.join(caminhoAssets(id), nome);
  if (!fs.existsSync(destino)) fs.copyFileSync(origem, destino);
  return nome;
}

// Antes de gravar: toda fonte do usuário usada na timeline vai para os assets e entra em "fontes" (família -> arquivo).
export function garantirFontes(id, t) {
  const minhas = minhasFontes();
  if (!minhas.length) return;
  const usadas = new Set(t.trilhas.flatMap((tr) => tr.itens.map((i) => i.estilo?.fonte).filter(Boolean)));
  for (const familia of usadas) {
    if (t.fontes?.[familia] && fs.existsSync(path.join(caminhoAssets(id), t.fontes[familia]))) continue;
    const nome = prepararFonte(id, familia);
    if (nome) t.fontes = { ...t.fontes, [familia]: nome };
  }
}
