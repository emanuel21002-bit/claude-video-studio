// Lê o nome (família e estilo) de arquivos de fonte TTF, OTF e TTC sem carregar o arquivo inteiro. Sem dependências do Electron.
import fs from 'node:fs';

const ASCII = (b, o, n) => b.toString('latin1', o, o + n);

function decodificar(buf, plataforma) {
  if (plataforma === 3 || plataforma === 0) {
    const s = Buffer.from(buf);
    s.swap16();
    return s.toString('utf16le');
  }
  return buf.toString('latin1');
}

// Escolhe o melhor nome de um id: Windows em inglês dos EUA > Windows qualquer > Unicode > Mac.
function melhorNome(registros, id) {
  const cand = registros.filter((r) => r.id === id && r.texto.trim());
  const nota = (r) => (r.plataforma === 3 ? (r.idioma === 0x409 ? 0 : 1) : r.plataforma === 0 ? 2 : 3);
  return cand.sort((a, b) => nota(a) - nota(b))[0]?.texto.trim() ?? null;
}

const VERSOES = ['\0\x01\0\0', 'OTTO', 'true', 'typ1'];

// `ler(posicao, tamanho)` devolve um Buffer: no arquivo, lê só o necessário.
export function nomesDaFonte(ler) {
  const topo = ler(0, 12);
  if (topo.length < 12) return [];
  const tag = ASCII(topo, 0, 4);
  let inicios = [0];
  if (tag === 'ttcf') {
    const n = Math.min(topo.readUInt32BE(8), 64);
    const offs = ler(12, n * 4);
    inicios = Array.from({ length: n }, (_, i) => offs.readUInt32BE(i * 4));
  } else if (!VERSOES.includes(tag)) {
    return [];
  }
  const fontes = [];
  for (const ini of inicios) {
    try {
      const cab = ler(ini, 12);
      const nTab = cab.readUInt16BE(4);
      const tabelas = ler(ini + 12, nTab * 16);
      let nome = null;
      for (let i = 0; i < nTab; i++) if (ASCII(tabelas, i * 16, 4) === 'name') nome = { off: tabelas.readUInt32BE(i * 16 + 8), len: tabelas.readUInt32BE(i * 16 + 12) };
      if (!nome) continue;
      const t = ler(nome.off, Math.min(nome.len, 262144));
      const cont = t.readUInt16BE(2);
      const base = t.readUInt16BE(4);
      const registros = [];
      for (let i = 0; i < cont; i++) {
        const r = 6 + i * 12;
        if (r + 12 > t.length) break;
        const comp = t.readUInt16BE(r + 8);
        const off = base + t.readUInt16BE(r + 10);
        if (off + comp > t.length) continue;
        registros.push({ plataforma: t.readUInt16BE(r), idioma: t.readUInt16BE(r + 4), id: t.readUInt16BE(r + 6), texto: decodificar(t.subarray(off, off + comp), t.readUInt16BE(r)) });
      }
      const familia = melhorNome(registros, 16) ?? melhorNome(registros, 1);
      if (familia) fontes.push({ familia, estilo: melhorNome(registros, 17) ?? melhorNome(registros, 2) ?? 'Regular' });
    } catch {
      /* fonte com tabela quebrada: ignora */
    }
  }
  return fontes;
}

export function nomesDoArquivo(arquivo) {
  const fd = fs.openSync(arquivo, 'r');
  try {
    return nomesDaFonte((pos, tam) => {
      const b = Buffer.alloc(tam);
      const n = fs.readSync(fd, b, 0, tam, pos);
      return b.subarray(0, n);
    });
  } finally {
    fs.closeSync(fd);
  }
}

// Ícones e símbolos não servem para texto: ficam fora da lista de fontes do sistema.
export const FONTE_DE_SIMBOLOS = /^(wingdings|webdings|marlett|symbol|segoe (mdl2 assets|fluent icons)|segoe ui (emoji|symbol)|holo ?mdl2|bookshelf symbol|mt extra|ms outlook)/i;
