// Packs de edição: bibliotecas de materiais (efeitos sonoros, músicas, overlays, logos…) guardadas uma vez só no
// workspace, em packs/<id>/. Um projeto não copia nada: o arquivo do pack entra em assets/ por hard link, que não ocupa
// espaço e continua valendo mesmo se o pack for apagado depois.
import fs from 'node:fs';
import path from 'node:path';
import { dirs, tipoDe, listarMateriais, sondarCompleto, trazerArquivo, nomeSeguro, lerProjeto, gravarProjeto, caminhoAssets } from './workspace.mjs';
import { slug } from './migracao.mjs';

const raiz = () => path.join(dirs().ws, 'packs');

function pastaDoPack(id) {
  if (!/^[a-z0-9_-]+$/i.test(String(id))) throw new Error(`Pack inválido: ${id}`);
  return path.join(raiz(), id);
}
const arquivoJson = (id) => path.join(pastaDoPack(id), 'pack.json');
const pastaArquivos = (id) => path.join(pastaDoPack(id), 'arquivos');
const lerPack = (id) => JSON.parse(fs.readFileSync(arquivoJson(id), 'utf8'));

function gravarPack(p) {
  const destino = arquivoJson(p.id);
  fs.writeFileSync(destino + '.tmp', JSON.stringify(p, null, 2));
  fs.renameSync(destino + '.tmp', destino);
  return p;
}

// Para a tela: cada item com o caminho completo e os totais do pack.
function paraTela(p) {
  const pasta = pastaArquivos(p.id);
  const conta = (t) => p.itens.filter((i) => i.tipo === t).length;
  return {
    ...p,
    itens: p.itens.map((i) => ({ ...i, caminho: path.join(pasta, i.arquivo) })),
    totais: { video: conta('video'), imagem: conta('imagem'), audio: conta('audio'), bytes: p.itens.reduce((s, i) => s + (i.bytes ?? 0), 0) },
  };
}

export function listarPacks() {
  if (!fs.existsSync(raiz())) return [];
  return fs
    .readdirSync(raiz())
    .filter((id) => /^[a-z0-9_-]+$/i.test(id) && fs.existsSync(arquivoJson(id)))
    .flatMap((id) => {
      try {
        return [paraTela(lerPack(id))];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function criarPack(nome) {
  const limpo = String(nome ?? '').trim();
  if (!limpo) throw new Error('Dê um nome ao pack.');
  fs.mkdirSync(raiz(), { recursive: true });
  const base = slug(limpo) || 'pack';
  let id = base;
  for (let n = 2; fs.existsSync(pastaDoPack(id)); n++) id = `${base}-${n}`;
  fs.mkdirSync(pastaArquivos(id), { recursive: true });
  return paraTela(gravarPack({ id, nome: limpo, descricao: '', criadoEm: new Date().toISOString(), itens: [] }));
}

export function atualizarPack(id, { nome, descricao }) {
  const p = lerPack(id);
  if (nome != null && String(nome).trim()) p.nome = String(nome).trim();
  if (descricao != null) p.descricao = String(descricao);
  return paraTela(gravarPack(p));
}

// Os projetos que já usam arquivos deste pack não perdem nada: o hard link deles continua válido.
export function excluirPack(id) {
  fs.rmSync(pastaDoPack(id), { recursive: true, force: true });
}

export async function adicionarAoPack(id, caminhos, onProgresso) {
  const inicial = lerPack(id);
  const conhecidos = new Set(inicial.itens.map((i) => i.original));
  const usados = new Set(inicial.itens.map((i) => i.arquivo));
  const achados = listarMateriais(caminhos).filter(({ caminho }) => !conhecidos.has(caminho));
  const novos = [];
  let falhas = 0;
  for (const [n, { caminho, pasta }] of achados.entries()) {
    onProgresso?.({ feitos: n, total: achados.length, nome: path.basename(caminho) });
    const arquivo = nomeSeguro(path.basename(caminho), usados);
    try {
      const destino = path.join(pastaArquivos(id), arquivo);
      await trazerArquivo(caminho, destino);
      novos.push({ arquivo, nome: path.basename(caminho), original: caminho, pasta: pasta || '', tipo: tipoDe(caminho), bytes: fs.statSync(destino).size, ...(await sondarCompleto(destino)) });
    } catch {
      falhas++;
    }
  }
  onProgresso?.({ feitos: achados.length, total: achados.length });
  // Relido só agora: a importação pode demorar.
  const atual = lerPack(id);
  atual.itens.push(...novos);
  gravarPack(atual);
  return { pack: paraTela(atual), adicionados: novos.length, repetidos: listarMateriais(caminhos).length - achados.length, falhas };
}

export function removerDoPack(id, arquivos) {
  const p = lerPack(id);
  const tirar = new Set(arquivos);
  for (const i of p.itens) if (tirar.has(i.arquivo)) fs.rmSync(path.join(pastaArquivos(id), i.arquivo), { force: true });
  p.itens = p.itens.filter((i) => !tirar.has(i.arquivo));
  return paraTela(gravarPack(p));
}

export function definirPacksDoProjeto(idTimeline, packs) {
  const p = lerProjeto(idTimeline);
  p.packs = [...new Set(packs)];
  gravarProjeto(p);
  return p.packs;
}

// Várias timelines podem pedir ao mesmo tempo (lote em paralelo) e todas gravam o mesmo projeto.json: um pedido por vez.
let fila = Promise.resolve();

// Liga os arquivos do pack no projeto. O que já está ligado é reaproveitado.
export function usarDoPack(idTimeline, packId, arquivos) {
  const trabalho = fila.catch(() => {}).then(async () => {
    const pack = lerPack(packId);
    const assets = caminhoAssets(idTimeline);
    const usados = new Set(fs.readdirSync(assets));
    const materiais = [...lerProjeto(idTimeline).materiais];
    const ligados = [];
    const naoAchados = [];
    for (const nome of arquivos) {
      const item = pack.itens.find((i) => i.arquivo === nome || i.nome === nome);
      if (!item) {
        naoAchados.push(nome);
        continue;
      }
      let m = materiais.find((x) => x.pack === packId && x.arquivoPack === item.arquivo);
      if (!m) {
        const arquivo = nomeSeguro(item.arquivo, usados);
        await trazerArquivo(path.join(pastaArquivos(packId), item.arquivo), path.join(assets, arquivo));
        const { tipo, duracao, largura, altura, temAudio } = item;
        m = {
          arquivo, original: path.join(pastaArquivos(packId), item.arquivo), tipo, duracao, largura, altura, temAudio,
          pasta: ['Pack: ' + pack.nome, item.pasta].filter(Boolean).join('/'), pack: packId, arquivoPack: item.arquivo,
        };
        materiais.push(m);
      }
      ligados.push(m);
    }
    if (ligados.length) {
      const atual = lerProjeto(idTimeline);
      atual.materiais = materiais;
      gravarProjeto(atual);
    }
    return { ligados, naoAchados };
  });
  fila = trabalho;
  return trabalho;
}

const fmt = (s) => (s == null ? '?' : `${Number(s).toFixed(1)}s`);
const POR_PAGINA = 60;
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const packsDoProjeto = (p) => listarPacks().filter((x) => (p.packs ?? []).includes(x.id));

// Só nomes e quantidades, para não gastar tokens: a lista dos arquivos o Claude pede quando precisa.
export function resumoPacks(p) {
  const packs = packsDoProjeto(p);
  if (!packs.length) return '';
  const linhas = packs.map((x) => {
    const pastas = [...new Set(x.itens.map((i) => i.pasta).filter(Boolean))].slice(0, 12);
    return `- ${x.id} ("${x.nome}"): ${x.totais.video} vídeos, ${x.totais.imagem} imagens, ${x.totais.audio} áudios${pastas.length ? `; pastas: ${pastas.join(', ')}` : ''}${x.descricao ? `. ${x.descricao.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`;
  });
  return `PACKS DE EDIÇÃO do usuário, liberados para este projeto:\n${linhas.join('\n')}\nSão os materiais dele (efeitos sonoros, músicas, overlays, logos…): antes de sintetizar um som ou inventar um efeito, procure aqui com mcp__studio__listar_pack (filtre por tipo, busca ou pasta). Só o que você ligar com mcp__studio__usar_do_pack entra no projeto; ligue apenas o que for usar e coloque na timeline pelo nome que a ferramenta devolver. Não leia nem copie a pasta packs/ e nunca altere um arquivo que veio de pack: ele é o mesmo arquivo da biblioteca.`;
}

// Lista paginada para o Claude.
export function textoDaLista(p, { pack, tipo, busca, pasta, pagina = 1 } = {}) {
  const packs = packsDoProjeto(p).filter((x) => !pack || x.id === pack);
  if (!packs.length) return pack ? `O pack "${pack}" não está liberado para este projeto.` : 'Nenhum pack liberado para este projeto.';
  const termos = semAcento(busca ?? '').split(/\s+/).filter(Boolean);
  const todos = packs.flatMap((x) => x.itens.map((i) => ({ ...i, packId: x.id }))).filter((i) => {
    if (tipo && i.tipo !== tipo) return false;
    if (pasta && !semAcento(i.pasta).includes(semAcento(pasta))) return false;
    const alvo = semAcento(`${i.nome} ${i.pasta}`);
    return termos.every((t) => alvo.includes(t));
  });
  const inicio = (pagina - 1) * POR_PAGINA;
  const pedaco = todos.slice(inicio, inicio + POR_PAGINA);
  if (!pedaco.length) return 'Nada encontrado com esses filtros.';
  const linhas = pedaco.map((i) => `${i.packId} | ${i.arquivo} | ${i.tipo} | ${i.tipo === 'imagem' ? '-' : fmt(i.duracao)} | ${i.pasta || '-'}`);
  const resto = todos.length - inicio - pedaco.length;
  return `pack | arquivo | tipo | duração | pasta\n${linhas.join('\n')}${resto > 0 ? `\n(mais ${resto}: peça a página ${pagina + 1})` : ''}`;
}

export const permitido = (p, packId) => (p.packs ?? []).includes(packId);
