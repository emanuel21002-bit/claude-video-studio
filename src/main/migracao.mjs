import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Formato antigo: uma pasta por timeline em projetos/, cada uma com a própria cópia dos materiais.
// Formato novo: uma pasta por projeto, com os materiais uma vez só e as timelines em timelines/<id>/.
//
// A migração não apaga nada. O novo projeto recebe os materiais e os renders por hard link (sem ocupar disco) e as
// pastas antigas vão inteiras para projetos-antigos/. O espaço só volta quando essa pasta é apagada.
// Este módulo não depende do Electron, para rodar também nos testes.

export const PASTA_ANTIGOS = 'projetos-antigos';
const PREFIXO_TEMPORARIO = '.novo-';
const COMPARTILHADAS = ['assets', 'referencia', 'instrucoes'];
const FORA_DA_TIMELINE = new Set(['projeto.json', '.previa', ...COMPARTILHADAS]);
// Abaixo disso a timeline recebe uma cópia: esses arquivos (timeline.json, src/…) são regravados no lugar,
// e um hard link levaria a edição para o backup também.
const LIMITE_COPIA = 8 * 1024 * 1024;

export const slug = (texto, max = 40) =>
  (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, max)
    .replace(/-+$/, '');

const lerJson = (c) => JSON.parse(fs.readFileSync(c, 'utf8'));
const gravarJson = (c, dados) => fs.writeFileSync(c, JSON.stringify(dados, null, 2));
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ligarOuCopiar(origem, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    fs.linkSync(origem, destino);
  } catch {
    copiarComData(origem, destino);
  }
}

function copiarComData(origem, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
  const { atime, mtime } = fs.statSync(origem);
  fs.utimesSync(destino, atime, mtime);
}

function arquivosDe(raiz, rel = '') {
  const pasta = path.join(raiz, rel);
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? arquivosDe(raiz, r) : [r];
  });
}

function sha1(arquivo) {
  return new Promise((ok, falha) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(arquivo).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', falha);
  });
}

// ---------- quais pastas antigas são o mesmo projeto ----------

// Projetos sem `grupo` (de versões bem antigas) são agrupados pela sequência do lote.
export function agrupar(lista) {
  const grupos = new Map();
  const abertos = new Map();
  for (const p of [...lista].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))) {
    let grupo = p.grupo;
    if (!grupo && p.lote) {
      const prefixo = p.nome.includes(' — ') ? p.nome.split(' — ')[0] : p.nome;
      const chave = `${prefixo}|${p.lote.total}`;
      const aberto = abertos.get(chave);
      if (aberto && aberto.proximo === p.lote.indice) {
        grupo = aberto.grupo;
        aberto.proximo++;
      } else {
        grupo = { id: p.id, nome: prefixo };
        abertos.set(chave, { grupo, proximo: p.lote.indice + 1 });
      }
    }
    grupo ??= { id: p.id, nome: p.nome };
    if (!grupos.has(grupo.id)) grupos.set(grupo.id, { nome: grupo.nome, membros: [] });
    grupos.get(grupo.id).membros.push(p);
  }
  for (const g of grupos.values()) {
    g.membros.sort((a, b) => (a.lote?.indice ?? 0) - (b.lote?.indice ?? 0) || a.criadoEm.localeCompare(b.criadoEm));
  }
  return [...grupos.values()];
}

// ---------- juntar as pastas compartilhadas ----------

// Une uma pasta (assets/, por exemplo) de todos os membros. Conteúdo igual vira um arquivo só, com o nome mais curto;
// nomes iguais com conteúdo diferente (narracao.mp3 de cada timeline) ganham um sufixo.
// Devolve, por membro, { nome antigo -> nome novo } de todo arquivo.
async function juntarPasta(sub, membros, pastaDe, destino) {
  const arquivos = [];
  for (const m of membros) {
    const raiz = path.join(pastaDe(m), sub);
    for (const rel of arquivosDe(raiz)) {
      const caminho = path.join(raiz, rel);
      const st = fs.statSync(caminho, { bigint: true });
      arquivos.push({ m, rel, caminho, tamanho: st.size, inode: `${st.dev}:${st.ino}` });
    }
  }
  // Só calcula o hash quando há outro arquivo (de fato outro, não um hard link) do mesmo tamanho.
  const inodesPorTamanho = new Map();
  for (const a of arquivos) {
    if (!inodesPorTamanho.has(a.tamanho)) inodesPorTamanho.set(a.tamanho, new Set());
    inodesPorTamanho.get(a.tamanho).add(a.inode);
  }
  const conteudoDoInode = new Map();
  for (const a of arquivos) {
    if (!conteudoDoInode.has(a.inode)) {
      const unico = inodesPorTamanho.get(a.tamanho).size === 1;
      conteudoDoInode.set(a.inode, unico ? `i:${a.inode}` : `h:${await sha1(a.caminho)}`);
    }
    a.conteudo = conteudoDoInode.get(a.inode);
  }
  const nomeDoConteudo = new Map();
  const preferido = new Map();
  for (const a of arquivos) {
    const atual = preferido.get(a.conteudo);
    if (atual === undefined || a.rel.length < atual.length) preferido.set(a.conteudo, a.rel);
  }
  const usados = new Set();
  const nomeLivre = (rel) => {
    const ext = path.posix.extname(rel);
    const base = rel.slice(0, rel.length - ext.length);
    let nome = rel;
    for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = `${base}-${n}${ext}`;
    usados.add(nome.toLowerCase());
    return nome;
  };
  const renomes = new Map(membros.map((m) => [m.id, new Map()]));
  for (const a of arquivos) {
    if (!nomeDoConteudo.has(a.conteudo)) {
      const nome = nomeLivre(preferido.get(a.conteudo));
      nomeDoConteudo.set(a.conteudo, nome);
      ligarOuCopiar(a.caminho, path.join(destino, sub, nome));
    }
    renomes.get(a.m.id).set(a.rel, nomeDoConteudo.get(a.conteudo));
  }
  return renomes;
}

// ---------- reescrever referências ----------

const soAlterados = (mapa) => new Map([...mapa].filter(([a, b]) => a !== b));

// Troca nomes soltos em código e textos, sem pegar pedaços de outros nomes, e numa passada só
// (a -> b e b -> c não podem encadear).
function trocarNomes(texto, renomes) {
  if (!renomes.size) return texto;
  const padrao = [...renomes.keys()].sort((a, b) => b.length - a.length).map(escaparRegex).join('|');
  return texto.replace(new RegExp(`(?<![\\w.-])(${padrao})(?![\\w-]|\\.\\w)`, 'g'), (m) => renomes.get(m));
}

// Os arquivos do Filmcraft guardam caminhos absolutos: "D:/…/assets/x" no .fcproj e "file:///D:/…" no .otio.
function trocarCaminhos(texto, de, assetsNovos, timelineNova, renomes) {
  const barras = (c) => c.replace(/\\/g, '/');
  const url = (c) => pathToFileURL(c).href;
  const formas = [
    { base: (c) => barras(c), sep: '/', cod: (s) => s },
    { base: url, sep: '/', cod: (s) => s.split('/').map(encodeURIComponent).join('/'), dec: decodeURIComponent },
    { base: (c) => path.win32.normalize(c).replace(/\\/g, '\\\\'), sep: '\\\\', cod: (s) => s.replace(/\//g, '\\\\') },
    { base: (c) => path.win32.normalize(c), sep: '\\', cod: (s) => s.replace(/\//g, '\\') },
  ];
  for (const f of formas) {
    const antigo = f.base(de);
    const emAssets = new RegExp(`${escaparRegex(antigo + f.sep + 'assets' + f.sep)}([^"'\\n\\r]+)`, 'g');
    texto = texto.replace(emAssets, (_m, resto) => {
      const rel = (f.dec ? f.dec(resto) : resto).replace(/\\\\|\\/g, '/');
      return f.base(assetsNovos) + f.sep + f.cod(renomes.get(rel) ?? rel);
    });
    texto = texto.split(antigo).join(f.base(timelineNova));
  }
  return texto;
}

function reescreverMantendoData(arquivo, transformar) {
  const antes = fs.readFileSync(arquivo, 'utf8');
  const depois = transformar(antes);
  if (depois === antes) return;
  const { atime, mtime } = fs.statSync(arquivo);
  fs.writeFileSync(arquivo, depois);
  // A data do .fcproj diz se há edição no Filmcraft ainda não trazida: não pode mudar aqui.
  fs.utimesSync(arquivo, atime, mtime);
}

const EXT_CODIGO = new Set(['.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.md']);
const EXT_FILMCRAFT = new Set(['.fcproj', '.otio', '.anterior']);

function trocarNomeDoArquivoNaTimeline(t, renomes) {
  const visitar = (no) => {
    if (Array.isArray(no)) return no.forEach(visitar);
    if (!no || typeof no !== 'object') return;
    for (const [k, v] of Object.entries(no)) {
      if (k === 'arquivo' && typeof v === 'string' && renomes.has(v)) no[k] = renomes.get(v);
      else visitar(v);
    }
  };
  visitar(t);
  return t;
}

// ---------- árvore da timeline ----------

function copiarTimeline(origem, destino) {
  for (const e of fs.readdirSync(origem, { withFileTypes: true })) {
    if (FORA_DA_TIMELINE.has(e.name)) continue;
    const c = path.join(origem, e.name);
    if (e.isDirectory()) {
      for (const rel of arquivosDe(c)) levarArquivo(path.join(c, rel), path.join(destino, e.name, rel));
      fs.mkdirSync(path.join(destino, e.name), { recursive: true });
    } else {
      levarArquivo(c, path.join(destino, e.name));
    }
  }
}

function levarArquivo(origem, destino) {
  if (fs.statSync(origem).size >= LIMITE_COPIA) ligarOuCopiar(origem, destino);
  else copiarComData(origem, destino);
}

// ---------- um projeto ----------

function idLivre(projetos, base, membros) {
  const dosMembros = new Set(membros.map((m) => m.id));
  const livre = (id) => dosMembros.has(id) || !fs.existsSync(path.join(projetos, id));
  let id = base;
  for (let n = 2; !livre(id); n++) id = `${base}-${n}`;
  return id;
}

function unirItens(listas) {
  const porArquivo = new Map();
  for (const lista of listas) {
    for (const item of lista) {
      const atual = porArquivo.get(item.arquivo);
      if (!atual) porArquivo.set(item.arquivo, { ...item });
      else if (!atual.pasta && item.pasta) atual.pasta = item.pasta;
    }
  }
  return [...porArquivo.values()];
}

const renomearItem = (item, mapa) => ({ ...item, arquivo: mapa?.get(item.arquivo) ?? item.arquivo });

function rotuloDe(nomeGrupo, m, n, total) {
  if (m.nome?.startsWith(nomeGrupo + ' — ')) return m.nome.slice(nomeGrupo.length + 3);
  return total > 1 ? m.nome : `Timeline ${n + 1}`;
}

async function migrarGrupo({ nome, membros }, projetos, antigos, onLinha) {
  const carimbo = membros[0].id.match(/^\d{14}/)?.[0] ?? membros[0].id;
  const id = idLivre(projetos, `${carimbo}-${slug(nome) || 'video'}`, membros);
  const tmp = path.join(projetos, PREFIXO_TEMPORARIO + id);
  const final = path.join(projetos, id);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });

  onLinha?.(`Reorganizando "${nome}" (${membros.length} timeline${membros.length > 1 ? 's' : ''})…`);
  const pastaDe = (m) => path.join(projetos, m.id);
  const renomes = {};
  for (const sub of COMPARTILHADAS) renomes[sub] = await juntarPasta(sub, membros, pastaDe, tmp);

  const timelines = [];
  for (const [n, m] of membros.entries()) {
    const rotulo = rotuloDe(nome, m, n, membros.length);
    const tid = `${String(n + 1).padStart(2, '0')}-${slug(rotulo, 30) || 'timeline'}`;
    const origem = pastaDe(m);
    const destino = path.join(tmp, 'timelines', tid);
    const timelineFinal = path.join(final, 'timelines', tid);
    fs.mkdirSync(destino, { recursive: true });
    copiarTimeline(origem, destino);

    const mapaAssets = renomes.assets.get(m.id);
    const alterados = soAlterados(mapaAssets);

    const arqTimeline = path.join(destino, 'timeline.json');
    if (fs.existsSync(arqTimeline)) {
      reescreverMantendoData(arqTimeline, (texto) =>
        trocarCaminhos(JSON.stringify(trocarNomeDoArquivoNaTimeline(JSON.parse(texto), alterados), null, 2), origem, path.join(final, 'assets'), timelineFinal, alterados),
      );
    }
    for (const rel of arquivosDe(destino)) {
      const c = path.join(destino, rel);
      const ext = path.extname(rel).toLowerCase();
      if (rel.startsWith('filmcraft/') && EXT_FILMCRAFT.has(ext)) {
        reescreverMantendoData(c, (texto) => trocarNomes(trocarCaminhos(texto, origem, path.join(final, 'assets'), timelineFinal, alterados), alterados));
      } else if (EXT_CODIGO.has(ext) && !rel.startsWith('renders/') && !rel.startsWith('filmcraft/') && !rel.startsWith('trabalho/')) {
        reescreverMantendoData(c, (texto) => trocarNomes(trocarCaminhos(texto, origem, path.join(final, 'assets'), timelineFinal, alterados), alterados));
      }
    }
    // HyperFrames lê "assets/…" a partir da pasta do vídeo.
    if (m.engine !== 'remotion') fs.symlinkSync(path.join(final, 'assets'), path.join(destino, 'assets'), 'junction');

    // Arquivos que a timeline usa precisam ter chegado: melhor falhar aqui, com o original intacto.
    if (fs.existsSync(arqTimeline)) {
      const t = lerJson(arqTimeline);
      for (const i of t.trilhas.flatMap((tr) => tr.itens)) {
        if (i.arquivo && !fs.existsSync(path.join(tmp, 'assets', i.arquivo)) && fs.existsSync(path.join(origem, 'assets', [...alterados].find(([, v]) => v === i.arquivo)?.[0] ?? i.arquivo))) {
          throw new Error(`"${i.arquivo}" não chegou em assets/.`);
        }
      }
    }

    const { id: _id, nome: _nome, grupo: _grupo, materiais: _mat, referencias: _ref, audiosInstrucao: _aud, ...resto } = m;
    const mudarCaminho = (c) => (c && c.startsWith(origem + path.sep) ? path.join(timelineFinal, path.relative(origem, c)) : c);
    timelines.push({
      id: tid,
      rotulo,
      ...resto,
      narracao: m.narracao ? renomearItem(m.narracao, mapaAssets) : null,
      renders: (m.renders ?? []).map((r) => ({ ...r, arquivo: mudarCaminho(r.arquivo), ...(r.preview ? { preview: mudarCaminho(r.preview) } : {}) })),
      migradoDe: m.id,
    });
  }

  const projeto = {
    id,
    nome,
    criadoEm: membros[0].criadoEm,
    versao: 2,
    materiais: unirItens(membros.map((m) => (m.materiais ?? []).map((x) => renomearItem(x, renomes.assets.get(m.id))))),
    referencias: unirItens(membros.map((m) => (m.referencias ?? []).map((x) => renomearItem(x, renomes.referencia.get(m.id))))),
    audiosInstrucao: unirItens(membros.map((m) => (m.audiosInstrucao ?? []).map((x) => renomearItem(x, renomes.instrucoes.get(m.id))))),
    migradoDe: membros.map((m) => m.id),
    timelines,
  };
  // Por último: é ele que marca a pasta temporária como completa.
  gravarJson(path.join(tmp, 'projeto.json'), projeto);
  concluir(tmp, projetos, antigos);
  return id;
}

// Tira as pastas antigas de projetos/ e põe a nova no lugar. Se algo estiver em uso, desfaz.
function concluir(tmp, projetos, antigos) {
  const id = path.basename(tmp).slice(PREFIXO_TEMPORARIO.length);
  const { migradoDe } = lerJson(path.join(tmp, 'projeto.json'));
  fs.mkdirSync(antigos, { recursive: true });
  const movidos = [];
  try {
    for (const velho of migradoDe) {
      const c = path.join(projetos, velho);
      if (!fs.existsSync(c)) continue;
      fs.renameSync(c, path.join(antigos, velho));
      movidos.push(velho);
    }
    fs.renameSync(tmp, path.join(projetos, id));
  } catch (e) {
    for (const velho of movidos) fs.renameSync(path.join(antigos, velho), path.join(projetos, velho));
    throw e;
  }
}

// Sobrou de um app fechado no meio: completa se a pasta ficou pronta; senão descarta (os originais estão intactos).
function retomar(projetos, antigos) {
  for (const nome of fs.readdirSync(projetos).filter((n) => n.startsWith(PREFIXO_TEMPORARIO))) {
    const tmp = path.join(projetos, nome);
    if (fs.existsSync(path.join(tmp, 'projeto.json'))) concluir(tmp, projetos, antigos);
    else fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function pastasAntigas(projetos) {
  if (!fs.existsSync(projetos)) return [];
  return fs
    .readdirSync(projetos)
    .filter((id) => !id.startsWith('.') && fs.existsSync(path.join(projetos, id, 'projeto.json')))
    .map((id) => {
      try {
        return { ...lerJson(path.join(projetos, id, 'projeto.json')), id };
      } catch {
        return null;
      }
    })
    .filter((p) => p && !Array.isArray(p.timelines));
}

export function haProjetosAntigos(ws) {
  return pastasAntigas(path.join(ws, 'projetos')).length > 0;
}

export async function migrarProjetos(ws, onLinha) {
  const projetos = path.join(ws, 'projetos');
  const antigos = path.join(ws, PASTA_ANTIGOS);
  const resultado = { migrados: [], erros: [] };
  if (!fs.existsSync(projetos)) return resultado;
  retomar(projetos, antigos);
  for (const grupo of agrupar(pastasAntigas(projetos))) {
    try {
      resultado.migrados.push(await migrarGrupo(grupo, projetos, antigos, onLinha));
    } catch (e) {
      resultado.erros.push({ nome: grupo.nome, erro: e.message });
      for (const nome of fs.readdirSync(projetos).filter((n) => n.startsWith(PREFIXO_TEMPORARIO))) {
        fs.rmSync(path.join(projetos, nome), { recursive: true, force: true });
      }
    }
  }
  return resultado;
}
