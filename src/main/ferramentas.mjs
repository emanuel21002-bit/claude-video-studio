import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregar } from './settings.mjs';
import { rodar, rodarOuFalhar } from './proc.mjs';
import { dirs, caminhoProjeto, caminhoTimeline, caminhoAssets, lerProjeto } from './workspace.mjs';
import { lerTimeline, gravarTimeline, escreverModelo, novoId } from './timeline.mjs';
import { pastaPublica, extrairQuadros } from './render.mjs';

// Ferramentas do Claude pensadas para gastar pouco: uma imagem só com vários quadros, em vez de um Read por quadro,
// e leitura e edição parciais da timeline, em vez de ler e reescrever o arquivo inteiro.

const aqui = path.dirname(fileURLToPath(import.meta.url));
const FONTE = "C\\:/Windows/Fonts/arialbd.ttf";
const COLUNAS = 4;

function maisRecente(pasta) {
  return fs.readdirSync(pasta, { withFileTypes: true }).reduce((m, d) => {
    const c = path.join(pasta, d.name);
    return Math.max(m, d.isDirectory() ? maisRecente(c) : fs.statSync(c).mtimeMs);
  }, 0);
}

// Junta imagens numeradas numa grade. O tile do ffmpeg precisa da sequência sem buracos.
async function grade(pasta, padrao, colunas, total, saida) {
  await rodarOuFalhar(carregar().ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error', '-framerate', '1', '-i', path.join(pasta, padrao),
    '-vf', `tile=${colunas}x${Math.ceil(total / colunas)}`, '-frames:v', '1', '-q:v', '4', saida,
  ]);
}

// Quadros pedidos, tirados direto da timeline: conferir não exige renderizar o vídeo inteiro.
export async function folhaDeQuadros(id, segundos) {
  const projeto = lerProjeto(id);
  const dir = caminhoTimeline(id);
  const previa = path.join(dir, '.previa');
  const pasta = path.join(previa, 'quadros');
  fs.rmSync(pasta, { recursive: true, force: true });
  fs.mkdirSync(pasta, { recursive: true });

  // Sem timeline (HyperFrames e projetos antigos), os quadros só existem no último render.
  if (!projeto.timeline) {
    const pngs = await extrairQuadros(id, segundos);
    pngs.forEach((p, n) => fs.renameSync(p, path.join(pasta, `f${String(n + 1).padStart(3, '0')}.png`)));
    const saida = path.join(pasta, 'folha.jpg');
    await grade(pasta, 'f%03d.png', Math.min(COLUNAS, pngs.length), pngs.length, saida);
    return saida;
  }

  escreverModelo(projeto);
  const t = lerTimeline(id);
  const ws = dirs().ws;
  const pacote = path.join(previa, 'pacote');
  const marca = path.join(previa, 'pacote.marca');
  const versao = String(maisRecente(path.join(dir, 'src')));
  const refazer = !fs.existsSync(marca) || fs.readFileSync(marca, 'utf8') !== versao;
  const publica = await pastaPublica(id, t, path.join(previa, 'publico'));
  const quadros = [...new Set(segundos.map((s) => Math.round(s * t.fps)))];
  const config = path.join(previa, 'quadros.json');
  fs.writeFileSync(config, JSON.stringify({
    ws, entrada: path.join(dir, 'src', 'index.ts'), publica, pacote, refazer, timeline: t, quadros,
    // Até dois quadros: maiores, para conferir detalhe. Mais que isso: quarto do tamanho, ainda legível.
    escala: quadros.length <= 2 ? 0.5 : 0.25, saida: pasta,
  }));
  const r = await rodar(carregar().nodePath, [path.join(aqui, 'quadros-still.cjs'), config], { cwd: ws });
  fs.rmSync(publica, { recursive: true, force: true });
  if (r.codigo !== 0) throw new Error(resumirErro(r.cauda));
  fs.writeFileSync(marca, versao);
  const ordem = quadros.slice().sort((a, b) => a - b);
  for (const [n, q] of ordem.entries()) fs.renameSync(path.join(pasta, `q${String(q).padStart(6, '0')}.jpg`), path.join(pasta, `f${String(n + 1).padStart(3, '0')}.jpg`));
  const saida = path.join(pasta, 'folha.jpg');
  await grade(pasta, 'f%03d.jpg', Math.min(COLUNAS, ordem.length), ordem.length, saida);
  return saida;
}

// Uma imagem com todos os materiais numerados. Substitui dezenas de leituras de quadros soltos.
const POR_PAGINA = 30;
export async function folhaDeMateriais(id, { arquivos, pagina = 1 } = {}) {
  const projeto = lerProjeto(id);
  const assets = caminhoAssets(id);
  const pasta = path.join(caminhoTimeline(id), '.previa', 'materiais');
  fs.rmSync(pasta, { recursive: true, force: true });
  fs.mkdirSync(pasta, { recursive: true });
  const visuais = projeto.materiais.filter((m) => m.tipo !== 'audio' && (!arquivos?.length || arquivos.includes(m.arquivo)));
  const inicio = (pagina - 1) * POR_PAGINA;
  const usados = visuais.slice(inicio, inicio + POR_PAGINA);
  if (!usados.length) throw new Error('Não há materiais visuais nessa página.');
  // Pedindo clipes específicos, vêm três momentos de cada; na visão geral, só o do meio.
  const momentos = arquivos?.length ? [0.2, 0.5, 0.8] : [0.5];
  const linhas = [];
  let n = 0;
  for (const [i, m] of usados.entries()) {
    const num = inicio + i + 1;
    linhas.push(`${num}. ${m.arquivo}${m.pasta ? ` [${m.pasta}]` : ''} ${m.tipo === 'imagem' ? 'imagem' : `${(m.duracao ?? 0).toFixed(1)}s`}${m.largura ? ` ${m.largura}x${m.altura}` : ''}`);
    for (const f of m.tipo === 'imagem' ? [0] : momentos) {
      n++;
      const saida = path.join(pasta, `f${String(n).padStart(3, '0')}.jpg`);
      const filtro = `scale=240:240:force_original_aspect_ratio=decrease,pad=240:240:(ow-iw)/2:(oh-ih)/2,drawtext=fontfile='${FONTE}':text='${num}':x=6:y=6:fontsize=30:fontcolor=yellow:borderw=3`;
      const r = await rodar(carregar().ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...(m.tipo === 'imagem' ? [] : ['-ss', String((m.duracao ?? 0) * f)]), '-i', path.join(assets, m.arquivo), '-frames:v', '1', '-vf', filtro, '-q:v', '5', saida]);
      if (r.codigo !== 0 || !fs.existsSync(saida)) throw new Error(`Não consegui ler ${m.arquivo}.\n${r.cauda.slice(-300)}`);
    }
  }
  const saida = path.join(pasta, 'folha.jpg');
  await grade(pasta, 'f%03d.jpg', 6, n, saida);
  const resto = visuais.length - inicio - usados.length;
  return { saida, texto: linhas.join('\n') + (resto > 0 ? `\nHá mais ${resto} materiais: peça a página ${pagina + 1}.` : '') };
}

// Estuda um material de referência: uma imagem com quadros rotulados com o segundo, mais os dados medidos pelo ffmpeg
// (duração, resolução, instantes dos cortes). Os cortes saem de graça aqui, sem o Claude precisar contar quadro a quadro.
export async function folhaDeReferencia(id, { arquivo, momentos } = {}) {
  const projeto = lerProjeto(id);
  const refs = projeto.referencias ?? [];
  if (!refs.length) throw new Error('Este projeto não tem material de referência.');
  const ref = arquivo ? refs.find((r) => r.arquivo === arquivo) : refs[0];
  if (!ref) throw new Error(`Referência "${arquivo}" não existe. Disponíveis: ${refs.map((r) => r.arquivo).join(', ')}`);
  const origem = path.join(caminhoProjeto(id), 'referencia', ref.arquivo);
  const pasta = path.join(caminhoTimeline(id), '.previa', 'referencia');
  fs.rmSync(pasta, { recursive: true, force: true });
  fs.mkdirSync(pasta, { recursive: true });

  const dur = ref.tipo === 'imagem' ? 0 : ref.duracao ?? 0;
  const linhas = [`${ref.arquivo}: ${ref.tipo === 'imagem' ? 'imagem' : `${dur.toFixed(1)}s`}${ref.largura ? ` ${ref.largura}x${ref.altura}` : ''}${ref.temAudio ? ' com áudio' : ' sem áudio'}`];

  let cortes = [];
  if (dur > 0) {
    await rodar(carregar().ffmpegPath, ['-hide_banner', '-nostats', '-i', origem, '-vf', "scale=320:-2,select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], {
      onLinha: (l) => {
        const m = l.match(/pts_time:([\d.]+)/);
        if (m) cortes.push(Number(m[1]));
      },
    });
    cortes = cortes.filter((t) => t > 0.2);
    const duracoes = [0, ...cortes, dur].map((t, i, a) => (i ? t - a[i - 1] : null)).filter((x) => x != null);
    const media = duracoes.reduce((s, x) => s + x, 0) / duracoes.length;
    linhas.push(`${cortes.length} cortes detectados, plano médio de ${media.toFixed(1)}s (${(60 / media).toFixed(0)} cortes por minuto).`);
    if (cortes.length) linhas.push(`Instantes dos cortes (s): ${cortes.slice(0, 60).map((t) => t.toFixed(1)).join(', ')}${cortes.length > 60 ? ' …' : ''}`);
  }

  const instantes = ref.tipo === 'imagem' ? [0] : (momentos?.length ? momentos : Array.from({ length: Math.min(12, Math.max(4, Math.ceil(dur / 2))) }, (_, i, a) => (dur * (i + 0.5)) / a.length)).slice(0, 12);
  for (const [n, t] of instantes.entries()) {
    const saida = path.join(pasta, `f${String(n + 1).padStart(3, '0')}.jpg`);
    const filtro = `scale=270:270:force_original_aspect_ratio=decrease,pad=270:270:(ow-iw)/2:(oh-ih)/2,drawtext=fontfile='${FONTE}':text='${t.toFixed(1)}s':x=6:y=6:fontsize=26:fontcolor=yellow:borderw=3`;
    const r = await rodar(carregar().ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...(ref.tipo === 'imagem' ? [] : ['-ss', String(Math.max(0, t))]), '-i', origem, '-frames:v', '1', '-vf', filtro, '-q:v', '5', saida]);
    if (r.codigo !== 0 || !fs.existsSync(saida)) throw new Error(`Não consegui ler ${ref.arquivo}.\n${r.cauda.slice(-300)}`);
  }
  const saida = path.join(pasta, 'folha.jpg');
  await grade(pasta, 'f%03d.jpg', Math.min(4, instantes.length), instantes.length, saida);
  if (refs.length > 1) linhas.push(`Outras referências: ${refs.filter((r) => r !== ref).map((r) => r.arquivo).join(', ')}`);
  return { saida, texto: linhas.join('\n') };
}

const seg = (x) => Number(x.toFixed(2));

// A timeline sem o que pesa: palavras das legendas e detalhes de estilo. Quem precisa de um item pede pelo id.
export function resumoTimeline(id, { ids } = {}) {
  const t = lerTimeline(id);
  if (ids?.length) {
    const achados = t.trilhas.flatMap((tr) => tr.itens).filter((i) => ids.includes(i.id));
    return JSON.stringify(achados.map(({ palavras, ...resto }) => ({ ...resto, ...(palavras ? { palavras: palavras.length } : {}) })));
  }
  const linhas = [`${t.largura}x${t.altura} ${t.fps}fps duração ${seg(Math.max(0, ...t.trilhas.flatMap((tr) => tr.itens.map((i) => i.inicio + i.duracao))))}s`];
  for (const tr of t.trilhas) {
    linhas.push(`# ${tr.id} (${tr.tipo}) ${tr.itens.length} itens${tr.oculta ? ' oculta' : ''}${tr.muda ? ' muda' : ''}`);
    if (tr.tipo === 'legenda') {
      if (tr.itens.length) linhas.push(`  de ${seg(tr.itens[0].inicio)}s a ${seg(tr.itens.at(-1).inicio + tr.itens.at(-1).duracao)}s (use ids para ver uma legenda)`);
      continue;
    }
    for (const i of tr.itens) {
      const extras = [i.corteInicio != null && `corte ${seg(i.corteInicio)}`, i.velocidade && `vel ${i.velocidade}`, i.volume != null && `vol ${i.volume}`, i.keyframes && 'kf', i.efeitos && 'fx', i.mesclagem].filter(Boolean).join(' ');
      linhas.push(`  ${i.id} ${i.tipo} ${i.arquivo ?? i.componente ?? JSON.stringify((i.texto ?? '').slice(0, 30))} ${seg(i.inicio)}+${seg(i.duracao)} ${extras}`.trimEnd());
    }
    for (const x of tr.transicoes ?? []) linhas.push(`  ~ ${x.id} ${x.tipo} ${x.duracao}s ${x.de ?? ''}>${x.para ?? ''}`);
  }
  return linhas.join('\n');
}

// Edição por item: mudar um corte não exige reescrever um arquivo de dezenas de KB.
export function editarTimeline(id, operacoes) {
  const t = lerTimeline(id);
  const acharItem = (itemId) => {
    for (const tr of t.trilhas) {
      const n = tr.itens.findIndex((i) => i.id === itemId);
      if (n >= 0) return { tr, n };
    }
    throw new Error(`Item "${itemId}" não existe.`);
  };
  const trilha = (trilhaId) => t.trilhas.find((tr) => tr.id === trilhaId) ?? (() => { throw new Error(`Trilha "${trilhaId}" não existe.`); })();
  const criados = [];
  for (const o of operacoes) {
    if (o.op === 'alterar') {
      const { tr, n } = acharItem(o.id);
      const item = tr.itens[n];
      for (const [k, v] of Object.entries(o.campos ?? {})) {
        if (v === null) delete item[k];
        else item[k] = v;
      }
    } else if (o.op === 'adicionar') {
      const item = { id: o.item?.id ?? novoId('c'), ...o.item };
      trilha(o.trilha).itens.push(item);
      criados.push(item.id);
    } else if (o.op === 'remover') {
      const { tr, n } = acharItem(o.id);
      tr.itens.splice(n, 1);
      if (tr.transicoes) {
        tr.transicoes = tr.transicoes.filter((x) => x.de !== o.id && x.para !== o.id);
        if (!tr.transicoes.length) delete tr.transicoes;
      }
    } else if (o.op === 'transicoes') {
      const tr = trilha(o.trilha);
      if (o.lista?.length) tr.transicoes = o.lista;
      else delete tr.transicoes;
    } else {
      throw new Error(`Operação "${o.op}" não existe.`);
    }
  }
  gravarTimeline(id, t);
  return `${operacoes.length} alteração(ões) gravada(s).${criados.length ? ` Novos ids: ${criados.join(', ')}.` : ''}`;
}

// Saída do CLI do Remotion: dezenas de linhas de código-fonte. Para decidir o que fazer bastam as linhas com o erro.
export function resumirErro(texto) {
  const limpo = String(texto).replace(/\x1b\[[0-9;]*m/g, '');
  const linhas = limpo.split('\n');
  const uteis = linhas.filter((l) => /(error|timeout|timed out|delayRender|fetching|não |falhou|could not|cannot|enoent|out of memory)/i.test(l) && !/^\s*\d+\s*│/.test(l));
  return (uteis.length ? uteis : linhas.slice(-8)).join('\n').slice(0, 900);
}
