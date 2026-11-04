import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

export const EXTENSOES_ROTEIRO = ['pdf', 'docx', 'odt', 'txt', 'md', 'rtf', 'html', 'htm', 'srt', 'vtt', 'csv', 'json'];

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodificar = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTIDADES[e.toLowerCase()] ?? m;
  });

// docx e odt são zips com XML: cada parágrafo vira uma linha.
function textoDeZip(buf, entrada, fimParagrafo) {
  const arquivos = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === entrada });
  const xml = arquivos[entrada];
  if (!xml) throw new Error('Documento sem texto reconhecível.');
  return decodificar(strFromU8(xml).replace(new RegExp(fimParagrafo, 'g'), '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, ''));
}

async function textoDePdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const doc = await tarefa.promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const conteudo = await (await doc.getPage(n)).getTextContent();
    paginas.push(conteudo.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join(''));
  }
  await tarefa.destroy?.();
  return paginas.join('\n');
}

const semRtf = (s) =>
  s
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '');

// Lê qualquer roteiro como texto puro. Formatos desconhecidos são lidos como texto.
export async function lerRoteiro(arquivo) {
  const ext = path.extname(arquivo).slice(1).toLowerCase();
  const buf = fs.readFileSync(arquivo);
  let texto;
  if (ext === 'pdf') texto = await textoDePdf(buf);
  else if (ext === 'docx') texto = textoDeZip(buf, 'word/document.xml', '</w:p>');
  else if (ext === 'odt') texto = textoDeZip(buf, 'content.xml', '</text:p>|</text:h>');
  else {
    texto = buf.toString('utf8').replace(/^﻿/, '');
    if (ext === 'rtf') texto = semRtf(texto);
    else if (ext === 'html' || ext === 'htm') texto = decodificar(texto.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h\d|li|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
    else if (ext === 'srt' || ext === 'vtt') texto = texto.split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && l.trim() !== 'WEBVTT').join('\n');
  }
  texto = texto.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!texto) throw new Error('Não encontrei texto neste arquivo (PDF escaneado? Cole o texto no campo).');
  return texto;
}
