import fs from 'node:fs';
import path from 'node:path';
import { transcreverArquivo } from './transcricao.mjs';
import { limparTranscricao, resumoDaFala } from './transcricao-nucleo.mjs';
import { lerProjeto, caminhoProjeto, caminhoAssets } from './workspace.mjs';

// As transcrições dos áudios dos vídeos ficam em projetos/<projeto>/transcricoes/<arquivo>.json, uma vez para o projeto todo.
const pasta = (id) => path.join(caminhoProjeto(id), 'transcricoes');
const arquivoDe = (id, material) => path.join(pasta(id), material.replace(/[\\/:*?"<>|]/g, '_') + '.json');

// { arquivo -> resumo } do que já foi transcrito; o que mudou no disco desde então (mtime) volta como desatualizado.
export function listarTranscricoes(id) {
  const lista = {};
  const assets = caminhoAssets(id);
  for (const m of lerProjeto(id).materiais.filter((x) => x.tipo === 'video' && x.temAudio)) {
    try {
      const t = JSON.parse(fs.readFileSync(arquivoDe(id, m.arquivo), 'utf8'));
      const atual = fs.statSync(path.join(assets, m.arquivo)).mtimeMs;
      lista[m.arquivo] = { ...t.resumo, desatualizada: Math.abs(atual - t.mtime) > 1 };
    } catch {
      /* ainda não transcrito */
    }
  }
  return lista;
}

export async function transcreverVideo(id, material, onLinha, sinal) {
  const origem = path.join(caminhoAssets(id), material.arquivo);
  const bruta = await transcreverArquivo(origem, onLinha, sinal);
  const limpa = limparTranscricao(bruta);
  const resumo = resumoDaFala(bruta, material.duracao);
  fs.mkdirSync(pasta(id), { recursive: true });
  fs.writeFileSync(
    arquivoDe(id, material.arquivo),
    JSON.stringify({ arquivo: material.arquivo, mtime: fs.statSync(origem).mtimeMs, duracao: material.duracao, resumo, ...limpa }, null, 2),
  );
  return resumo;
}

// A transcrição completa de um arquivo do projeto (vídeo ou áudio), se já existe e o arquivo não mudou desde então.
export function transcricaoDoArquivo(id, arquivo) {
  try {
    const t = JSON.parse(fs.readFileSync(arquivoDe(id, arquivo), 'utf8'));
    return Math.abs(fs.statSync(path.join(caminhoAssets(id), arquivo)).mtimeMs - t.mtime) <= 1 ? t : null;
  } catch {
    return null;
  }
}
