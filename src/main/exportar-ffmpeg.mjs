// Exportação rápida: o vídeo inteiro montado por um ffmpeg só, como os editores fazem (decodifica, monta e codifica numa
// passada, com o encoder da placa). Textos, legendas e blocos continuam vindo do Remotion, como uma camada transparente
// por cima (a mesma do caminho pelo Filmcraft). Cobre o que as timelines usam no dia a dia: clipes com corte, velocidade,
// zoom (Ken Burns), posição, escala, opacidade, Lumetri (com LUT), desfoque, vinheta, recorte, espelho, P&B, inverter,
// imagens com largura e mesclagem normal/screen/multiply, e o áudio de tudo. O que não cobre (transições, keyframes e
// animações em clipes, camada de ajuste) fica para o Filmcraft: ver motivosSemFfmpeg.
//
// As contas seguem as da composição (modelo-timeline/TimelineVideo.tsx): o filtro CSS de cada efeito vira a mesma
// operação aqui, na mesma ordem, para o vídeo sair igual à prévia.

import fs from 'node:fs';
import path from 'node:path';

const MESCLAGENS = new Set([undefined, null, 'normal', 'screen', 'multiply']);
// Transições que a prévia não desenha como dissolve: ficam para o Filmcraft. As outras (cross_dissolve e as que só
// existem no Filmcraft) são o dissolve da prévia: quem entra aparece por opacidade sobre quem sai.
const TRANSICOES_DE_FORA = new Set(['dip_to_black', 'dip_to_white', 'flash', 'dip_to_color', 'push', 'whip', 'slide', 'linear_wipe', 'wipe', 'soft_wipe', 'iris_round', 'cross_zoom', 'zoom_blur']);
const MIDIA = new Set(['video', 'imagem']);

const num = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : 0);
const ehAudio = (tr) => tr.tipo === 'audio';
const midias = (t) => t.trilhas.filter((tr) => !ehAudio(tr) && !tr.oculta).flatMap((tr) => tr.itens.filter((i) => MIDIA.has(i.tipo)));

// Escala no tempo: escala do item vezes o zoom (de → para, linear do primeiro ao último quadro, como no Remotion).
const temZoom = (i) => i.zoom && (i.zoom.de ?? 1) !== (i.zoom.para ?? 1);
const escalaMinima = (i) => (i.escala ?? 1) * Math.min(i.zoom?.de ?? 1, i.zoom?.para ?? 1);

// A composição desenha as trilhas na ordem da lista: a primeira fica no fundo. Gráficos em trilhas abaixo de todos os
// vídeos e imagens (um papel, uma cor ou uma textura de fundo, com a moldura onde o vídeo entra) não podem ir na
// camada de cima, senão cobrem os vídeos: vão numa camada própria, por baixo deles.
// Devolve o índice da primeira trilha visível com vídeo ou imagem (ou trilhas.length, se não houver).
export function primeiraTrilhaComMidia(t) {
  const k = t.trilhas.findIndex((tr) => tr.tipo !== 'audio' && !tr.oculta && tr.itens.some((i) => i.arquivo && (i.tipo === 'video' || i.tipo === 'imagem')));
  return k < 0 ? t.trilhas.length : k;
}

// O que o Remotion desenha na camada: itens sem arquivo (texto, legenda, bloco). A camada de ajuste não entra: ela não
// desenha nada sozinha (no Filmcraft o render cai no Remotion, ver render.mjs).
const desenhaNaCamada = (i) => !i.arquivo && i.tipo !== 'ajuste';

// Gráficos em "multiplicar" ou "tela" por cima dos vídeos: numa camada transparente, a mesclagem do navegador não
// tem com o que misturar e o item sai chapado. Eles vão numa camada própria sobre um fundo neutro (branco não muda o
// multiplicar, preto não muda a tela), que é misturada com os vídeos no modo dela.
export const CAMADAS_MESCLA = { multiplicar: { modo: 'multiply', neutro: '#ffffff' }, tela: { modo: 'screen', neutro: '#000000' } };
const parteDaMescla = (i) => (i.mesclagem === 'multiply' ? 'multiplicar' : i.mesclagem === 'screen' ? 'tela' : 'frente');

// Os itens gráficos de uma parte: 'fundo' (trilhas abaixo de todas as mídias), 'multiplicar' e 'tela' (por cima das
// mídias, com essa mesclagem) ou 'frente' (o resto, por cima de tudo).
export function graficosDaParte(t, parte) {
  const corte = primeiraTrilhaComMidia(t);
  // Sem mídia nenhuma, tudo é frente: não há o que cobrir nem com o que misturar.
  const temMidia = corte < t.trilhas.length;
  const noFundo = (k) => temMidia && k < corte;
  const daParte = (i, k) => (noFundo(k) ? 'fundo' : temMidia ? parteDaMescla(i) : 'frente') === parte;
  return {
    ...t,
    fundo: CAMADAS_MESCLA[parte]?.neutro ?? 'transparent',
    trilhas: t.trilhas.map((tr, k) => ({ ...tr, transicoes: undefined, itens: tr.itens.filter((i) => desenhaNaCamada(i) && daParte(i, k)) })),
  };
}

// Por que esta timeline não sai pelo ffmpeg (vazio = sai).
export function motivosSemFfmpeg(t) {
  const m = new Set();
  for (const tr of t.trilhas) {
    if (tr.oculta) continue;
    for (const i of tr.itens) {
      if (i.tipo === 'ajuste') m.add('camada de ajuste');
      if (ehAudio(tr) || !MIDIA.has(i.tipo)) continue;
      if (Object.keys(i.keyframes ?? {}).length) m.add('keyframes em clipe');
      if (i.entrada?.tipo || i.saida?.tipo) m.add('animação de entrada/saída em clipe');
      if (!MESCLAGENS.has(i.mesclagem)) m.add(`mesclagem "${i.mesclagem}"`);
      const capa = (i.ajuste ?? (i.tipo === 'video' ? 'cover' : 'contain')) === 'cover' && !i.largura;
      if (temZoom(i) && (!capa || escalaMinima(i) < 0.999 || i.rotacao)) m.add('zoom fora do quadro cheio');
      if ((i.efeitos?.vinheta || i.efeitos?.corte) && !capa) m.add('vinheta ou recorte em imagem que não cobre o quadro');
    }
    if (!ehAudio(tr)) for (const x of tr.transicoes ?? []) if (TRANSICOES_DE_FORA.has(x.tipo) || String(x.tipo).startsWith('app_') || x.cor || x.direcao) m.add(`transição "${x.tipo}"`);
  }
  return [...m];
}

// ---------- efeitos de cor: as mesmas contas do filtro CSS da prévia ----------

// saturate(s) do CSS (Filter Effects): matriz 3x3 em sRGB.
const matrizSaturar = (s) => [
  [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
  [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
  [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
];
const multiplicar = (a, b) => a.map((l) => [0, 1, 2].map((c) => l[0] * b[0][c] + l[1] * b[1][c] + l[2] * b[2][c]));
const mixer = (m) =>
  `colorchannelmixer=rr=${num(m[0][0])}:rg=${num(m[0][1])}:rb=${num(m[0][2])}:gr=${num(m[1][0])}:gg=${num(m[1][1])}:gb=${num(m[1][2])}:br=${num(m[2][0])}:bg=${num(m[2][1])}:bb=${num(m[2][2])}`;

// Curva de tons do Lumetri na prévia (curvaDeTons em TimelineVideo.tsx), em 17 pontos.
function curvaDeTons(destaques, sombras, brancos, pretos) {
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const x = k / 16;
    let y = x;
    y += (sombras / 100) * 0.35 * x * (1 - x) * (1 - x) * 2.2;
    y += (destaques / 100) * 0.35 * x * x * (1 - x) * 2.2;
    y += (pretos / 100) * 0.12 * Math.pow(1 - x, 3);
    y += (brancos / 100) * 0.12 * Math.pow(x, 3);
    pts.push(`${num(x)}/${num(Math.max(0, Math.min(1, y)))}`);
  }
  return pts.join(' ');
}

// Filtros de um item (em RGB), na ordem da prévia: LUT (no canvas), brightness, contrast, saturate, curva de tons,
// temperatura/matiz, vibração, grayscale, invert, blur.
function filtrosDeCor(e, lut) {
  const f = [];
  if (lut) f.push(lut);
  const c = e.cor;
  if (c) {
    const b = Math.pow(2, c.exposicao ?? 0);
    const k = Math.max(0, 1 + (c.contraste ?? 0) / 100);
    if (b !== 1 || k !== 1) {
      const v = `clip((clip(val*${num(b)},0,255)-127.5)*${num(k)}+127.5,0,255)`;
      f.push(`lutrgb=r='${v}':g='${v}':b='${v}'`);
    }
    const s = (c.saturacao ?? 100) / 100;
    if (s !== 1) f.push(mixer(matrizSaturar(s)));
    const tons = [c.destaques ?? 0, c.sombras ?? 0, c.brancos ?? 0, c.pretos ?? 0];
    if (tons.some((x) => x)) f.push(`curves=all='${curvaDeTons(...tons)}'`);
    const temp = (c.temperatura ?? 0) / 100;
    const matiz = (c.matiz ?? 0) / 100;
    const vib = (c.vibracao ?? 0) / 100;
    let m = null;
    if (temp || matiz) m = [[1 + temp * 0.25, 0, 0], [0, 1 - matiz * 0.2, 0], [0, 0, 1 - temp * 0.25]];
    if (vib) m = m ? multiplicar(matrizSaturar(Math.max(0, 1 + vib * 0.6)), m) : matrizSaturar(Math.max(0, 1 + vib * 0.6));
    if (m) f.push(mixer(m));
  }
  if (e.pb) f.push(mixer([[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]]));
  if (e.inverter) f.push(`lutrgb=r=negval:g=negval:b=negval`);
  // blur(r * 0.5px) do CSS é um gaussiano com desvio r * 0.5.
  if (e.desfoque && (e.desfoque.raio ?? 0) > 0) f.push(`gblur=sigma=${num(e.desfoque.raio * 0.5)}`);
  return f;
}

// Imagem da vinheta da prévia: radial-gradient(ellipse at center, transparent 45%, cor 100%), elipse até o canto.
export function filtroVinheta(W, H, quantidade) {
  const a = Math.abs(quantidade) / 100;
  const cor = quantidade < 0 ? 0 : 255;
  const d = `hypot((X-${W / 2})/${num((W / 2) * Math.SQRT2)},(Y-${H / 2})/${num((H / 2) * Math.SQRT2)})`;
  return `geq=r=${cor}:g=${cor}:b=${cor}:a='255*${num(a)}*clip((${d}-0.45)/0.55,0,1)'`;
}

// ---------- transições: o mesmo plano da prévia (planoTransicoes em TimelineVideo.tsx) ----------

function folgas(x) {
  if (x.alinhamento === 'inicio') return { antes: 0, depois: x.duracao };
  if (x.alinhamento === 'fim') return { antes: x.duracao, depois: 0 };
  return { antes: x.duracao / 2, depois: x.duracao / 2 };
}

function planoTransicoes(tr) {
  const plano = new Map();
  const de = (id) => {
    if (!plano.has(id)) plano.set(id, { adiantar: 0, estender: 0 });
    return plano.get(id);
  };
  for (const x of tr.transicoes ?? []) {
    const a = tr.itens.find((i) => i.id === x.de);
    const b = tr.itens.find((i) => i.id === x.para);
    if (!a && !b) continue;
    const { antes, depois } = folgas(x);
    const corte = b ? b.inicio : a.inicio + a.duracao;
    if (a) {
      const p = de(a.id);
      if (b) p.estender = depois;
      p.saindo = { ini: corte - antes, fim: corte + depois, comPar: !!b };
    }
    if (b) {
      const p = de(b.id);
      p.adiantar = b.tipo === 'video' ? Math.min(antes, (b.corteInicio ?? 0) / (b.velocidade ?? 1)) : antes;
      p.entrando = { ini: corte - antes, fim: corte + depois, comPar: !!a };
    }
  }
  return plano;
}

// O último desenhado fica por cima: quem entra vem depois de quem sai.
// Em ordem de tempo: itens de uma faixa não se sobrepõem, então a ordem não muda a imagem, mas o ffmpeg só segura os
// quadros de cada clipe até a vez dele. Fora de ordem (um clipe de 26 s antes de um de 18 s na lista), ele guarda
// quadros demais e estoura a memória (código 4294967284, ENOMEM).
function ordemDesenho(tr) {
  const itens = [...tr.itens].sort((a, b) => a.inicio - b.inicio);
  for (const x of tr.transicoes ?? []) {
    const ia = itens.findIndex((i) => i.id === x.de);
    const ib = itens.findIndex((i) => i.id === x.para);
    if (ia >= 0 && ib >= 0 && ib < ia) [itens[ia], itens[ib]] = [itens[ib], itens[ia]];
  }
  return itens;
}

// ---------- o plano: entradas e grafo de filtros ----------

// t: timeline; infos: { arquivo: {hdr, temAudio, largura, altura} }; assets: pasta dos materiais;
// camada: { arquivo, duracao } | null (textos do Remotion); arquivos auxiliares (LUT, vinheta) vão para pastaTmp.
// Devolve { args, grafo, auxiliares: [{ nome, origem? , vinheta? }], duracao }.
// so: 'video' monta só a imagem (um trecho), 'audio' só o som (o vídeo inteiro); sem ele, os dois.
// duracao: tamanho exato do que sai (um trecho termina onde o próximo começa, mesmo se houver vão no fim).
// decodificacao: opções de entrada dos clipes de vídeo (decodificar na placa, threads).
export function planoFfmpeg(t, { infos = {}, assets, camada = null, camadaFundo = null, camadasMescla = [], tonemap, escala = 1, fpsSaida = 0, duracao = null, so = null, decodificacao = [] }) {
  const W = t.largura;
  const H = t.altura;
  const fps = t.fps;
  const D = duracao ?? Math.max(0.04, ...t.trilhas.flatMap((tr) => tr.itens).map((i) => i.inicio + i.duracao));
  const entradas = [];
  const grafo = [];
  const auxiliares = [];
  const luts = new Map();
  const vinhetas = new Map();
  const entrada = (args) => entradas.push(args) - 1;

  if (so !== 'audio') grafo.push(`color=c=${(t.fundo ?? '#000000').replace('#', '0x')}:s=${W}x${H}:r=${fps}:d=${num(D)},format=yuv420p[b0]`);
  let base = 'b0';
  let n = 0;
  const audios = [];
  // Num trecho, a camada começa no mesmo ponto (ProRes: todo quadro é chave, o corte é exato).
  const entradaCamada = (cam) => entrada(cam.desde ? ['-ss', String(num(cam.desde)), '-t', String(num(D + 0.1)), '-i', cam.arquivo] : ['-i', cam.arquivo]);
  // Gráficos por baixo de todos os vídeos (papel, cor de fundo): sobre a cor de fundo, antes das mídias.
  if (camadaFundo && so !== 'audio') {
    const fi = entradaCamada(camadaFundo);
    grafo.push(`[${fi}:v]setpts=PTS-STARTPTS[camf]`);
    grafo.push(`[b0][camf]overlay=eof_action=pass:format=auto,format=yuv420p[bf]`);
    base = 'bf';
  }

  for (const tr of t.trilhas) {
    if (tr.oculta || ehAudio(tr)) continue;
    const plano = planoTransicoes(tr);
    for (const i of ordemDesenho(tr)) {
      if (!MIDIA.has(i.tipo)) continue;
      const k = ++n;
      const vel = i.velocidade ?? 1;
      const arq = path.join(assets, i.arquivo);
      const info = infos[i.arquivo] ?? {};
      // Com transição, quem entra começa antes (adiantar) e quem sai vai além do fim (estender), com mais arquivo.
      const pt = plano.get(i.id);
      const adiantar = pt?.adiantar ?? 0;
      const ini = i.inicio - adiantar;
      const total = i.duracao + adiantar + (pt?.estender ?? 0);
      const corte = Math.max(0, (i.corteInicio ?? 0) - adiantar * vel);
      if (so === 'audio') {
        // Só o som do clipe, sem decodificar a imagem.
        if (i.tipo === 'video' && (i.volume ?? 0) > 0 && info.temAudio) {
          const ia = entrada(['-vn', '-ss', String(num(corte)), '-t', String(num(total * vel + 0.25)), '-i', arq]);
          audios.push({ i, rotuloEntrada: `${ia}:a:0`, vol: i.volume, vel, ini, total });
        }
        continue;
      }
      const idx =
        i.tipo === 'video'
          ? entrada([...decodificacao, '-ss', String(num(corte)), '-t', String(num(total * vel + 0.25)), '-i', arq])
          : entrada(['-loop', '1', '-framerate', String(fps), '-t', String(num(total + 0.1)), '-i', arq]);
      // Em quadros, como a Sequence da prévia: do quadro onde o item começa ao quadro onde ele termina. Em segundos, um
      // início fora da grade (6,52 s a 30 fps = quadro 195,6) era truncado pelo setpts e o clipe saía com um quadro a
      // menos: o último quadro do take ficava com o fundo preto.
      const q0 = Math.round(ini * fps);
      const qn = Math.max(1, Math.round((i.inicio + i.duracao + (pt?.estender ?? 0)) * fps) - q0);
      const f = [];
      // Tempo: começa em 0, velocidade, fps da timeline, quadros do item.
      f.push(vel !== 1 ? `setpts=(PTS-STARTPTS)/${num(vel)}` : 'setpts=PTS-STARTPTS');
      f.push(`fps=${fps}`, `trim=end_frame=${qn}`);
      // Arquivo que acaba antes do clipe: segura o último quadro. Sem isso o overlay passa adiante e o fim do take fica
      // com o fundo da timeline (preto).
      f.push(`tpad=stop_mode=clone:stop=${qn}`, `trim=end_frame=${qn}`);
      // Geometria: o quadro F, centralizado na caixa W x H (a AbsoluteFill do item).
      const ajuste = i.ajuste ?? (i.tipo === 'video' ? 'cover' : 'contain');
      const capa = ajuste === 'cover' && !i.largura;
      if (i.largura) f.push(`scale=${Math.round(i.largura / 2) * 2}:-2`);
      else if (capa) f.push(`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`);
      else f.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`, 'pad=ceil(iw/2)*2:ceil(ih/2)*2');
      // Tone mapping HDR depois de reduzir: em ponto flutuante na CPU, ele custa por pixel. No 4K do iPhone, fazer no
      // tamanho do quadro deixou a montagem cerca de 40% mais rápida (medido: 34,4 s → 20,8 s para 10 s de vídeo).
      if (info.hdr && tonemap) f.push(tonemap);
      // Efeitos, em RGB.
      const e = i.efeitos ?? {};
      let lut = null;
      if (e.cor?.lut) {
        if (!luts.has(e.cor.lut)) {
          const nome = `lut${luts.size}.cube`;
          luts.set(e.cor.lut, nome);
          auxiliares.push({ nome, origem: path.join(assets, e.cor.lut) });
        }
        lut = `lut3d=file=${luts.get(e.cor.lut)}:interp=trilinear`;
      }
      const cores = filtrosDeCor(e, (e.cor?.lutIntensidade ?? 100) === 100 ? lut : null);
      const fades = [];
      if (pt?.entrando) fades.push(`fade=t=in:st=${num(pt.entrando.ini - ini)}:d=${num(pt.entrando.fim - pt.entrando.ini)}:alpha=1`);
      if (pt?.saindo && !pt.saindo.comPar) fades.push(`fade=t=out:st=${num(pt.saindo.ini - ini)}:d=${num(pt.saindo.fim - pt.saindo.ini)}:alpha=1`);
      const precisaAlfa = !!(e.corte || i.rotacao || (i.opacidade ?? 1) < 1 || i.tipo === 'imagem' || fades.length);
      f.push(precisaAlfa ? 'format=rgba' : 'format=gbrp');
      let rotulo = `m${k}`;
      if (lut && (e.cor.lutIntensidade ?? 100) !== 100) {
        // LUT com intensidade: mistura o quadro com e sem LUT antes do resto da cor.
        grafo.push(`[${idx}:v]${f.join(',')},split[l${k}a][l${k}b]`);
        grafo.push(`[l${k}b]${lut}[l${k}c]`);
        grafo.push(`[l${k}a][l${k}c]blend=all_mode=normal:all_opacity=${num(Math.max(0, Math.min(1, e.cor.lutIntensidade / 100)))}${cores.length ? ',' + cores.join(',') : ''}[${rotulo}]`);
      } else grafo.push(`[${idx}:v]${[...f, ...cores].join(',')}[${rotulo}]`);
      const g = [];
      if (e.espelhoH) g.push('hflip');
      if (e.espelhoV) g.push('vflip');
      if (e.corte && capa) {
        const c = e.corte;
        const x = Math.round((W * (c.esquerda ?? 0)) / 100);
        const y = Math.round((H * (c.cima ?? 0)) / 100);
        const w = Math.max(2, W - x - Math.round((W * (c.direita ?? 0)) / 100));
        const h = Math.max(2, H - y - Math.round((H * (c.baixo ?? 0)) / 100));
        g.push(`crop=${w}:${h}:${x}:${y}`, `pad=${W}:${H}:${x}:${y}:color=black@0`);
      }
      if (g.length) {
        grafo.push(`[${rotulo}]${g.join(',')}[${rotulo}g]`);
        rotulo += 'g';
      }
      if (e.vinheta && capa && (e.vinheta.quantidade ?? -50)) {
        const q = e.vinheta.quantidade ?? -50;
        if (!vinhetas.has(q)) {
          const nome = `vinheta${vinhetas.size}.png`;
          vinhetas.set(q, nome);
          auxiliares.push({ nome, vinheta: filtroVinheta(W, H, q), W, H });
        }
        const vi = entrada(['-loop', '1', '-framerate', String(fps), '-t', String(num(total + 0.1)), '-i', vinhetas.get(q)]);
        grafo.push(`[${vi}:v]format=rgba,trim=end_frame=${qn}[vn${k}]`);
        grafo.push(`[${rotulo}][vn${k}]overlay=format=auto:shortest=1,${precisaAlfa ? 'format=rgba' : 'format=gbrp'}[${rotulo}v]`);
        rotulo += 'v';
      }
      // Transformação da Caixa: translate(x, y) scale(escala * zoom) rotate(r), em torno do centro do quadro.
      const s = i.escala ?? 1;
      const X = i.x ?? 0;
      const Y = i.y ?? 0;
      const t2 = [];
      let posX;
      let posY;
      if (temZoom(i)) {
        // Quadro cheio com zoom >= 1: amplia a cada quadro e recorta o centro (deslocado por x, y).
        const durQ = Math.max(1, Math.round(i.duracao * fps));
        // O zoom conta do início do item: quem entra por transição está adiantado alguns quadros.
        const A = Math.round(adiantar * fps);
        const z = `(${num(s)}*(${num(i.zoom.de ?? 1)}+${num((i.zoom.para ?? 1) - (i.zoom.de ?? 1))}*min(1,max(0,n-${A})/${durQ})))`;
        t2.push(`scale=w='2*ceil(${W}*${z}/2)':h='2*ceil(${H}*${z}/2)':eval=frame`, `crop=${W}:${H}:'(iw-${W})/2-(${num(X)})':'(ih-${H})/2-(${num(Y)})'`);
        posX = '0';
        posY = '0';
      } else {
        if (s !== 1) t2.push(`scale=w='2*ceil(iw*${num(s)}/2)':h='2*ceil(ih*${num(s)}/2)'`);
        if (i.rotacao) t2.push(`rotate=${num((i.rotacao * Math.PI) / 180)}:ow='rotw(${num((i.rotacao * Math.PI) / 180)})':oh='roth(${num((i.rotacao * Math.PI) / 180)})':c=none`);
        posX = `(${W}-w)/2+(${num(X)})`;
        posY = `(${H}-h)/2+(${num(Y)})`;
      }
      const op = i.opacidade ?? 1;
      const modo = i.mesclagem && i.mesclagem !== 'normal' ? i.mesclagem : null;
      if (op < 1 && !modo) t2.push(`colorchannelmixer=aa=${num(op)}`);
      // Posição em quadros inteiros (em segundos, o setpts trunca e o clipe começa um quadro antes).
      const emQuadros = `settb=expr=1/${fps},setpts=N+${q0}`;
      t2.push(...fades, emQuadros);
      grafo.push(`[${rotulo}]${t2.join(',')}[p${k}]`);
      // Do quadro q0 ao q0 + qn - 1, com meia folga de quadro de cada lado.
      const janela = `enable='between(t,${num((q0 - 0.5) / fps)},${num((q0 + qn - 0.5) / fps)})'`;
      const novo = `b${k}`;
      if (!modo) {
        grafo.push(`[${base}][p${k}]overlay=x='${posX}':y='${posY}':eof_action=pass:format=auto:${janela}[${novo}]`);
      } else {
        // screen/multiply: o item vai sobre um fundo neutro (preto não muda o screen, branco não muda o multiply)
        // do tamanho do quadro, e mistura com o que está embaixo, com a opacidade do item.
        const neutro = modo === 'screen' ? 'black' : 'white';
        grafo.push(`color=c=${neutro}:s=${W}x${H}:r=${fps},trim=end_frame=${qn},${emQuadros},format=rgba[n${k}]`);
        grafo.push(`[n${k}][p${k}]overlay=x='${posX}':y='${posY}':format=auto,format=gbrp[q${k}]`);
        grafo.push(`[${base}]format=gbrp[bg${k}]`);
        grafo.push(`[bg${k}][q${k}]blend=all_mode=${modo}:all_opacity=${num(op)}:eof_action=pass:${janela},format=yuv420p[${novo}]`);
      }
      base = novo;
      // Som do clipe (volume do item; faixa de vídeo não tem mudo).
      if (i.tipo === 'video' && (i.volume ?? 0) > 0 && info.temAudio) audios.push({ i, rotuloEntrada: `${idx}:a:0`, vol: i.volume, vel, ini, total });
    }
  }

  // Gráficos em multiplicar/tela (sobre fundo neutro): misturados com tudo o que está embaixo.
  if (so !== 'audio') {
    camadasMescla.forEach((cam, m) => {
      const ci = entradaCamada(cam);
      grafo.push(`[${ci}:v]setpts=PTS-STARTPTS,format=gbrp[mq${m}]`);
      grafo.push(`[${base}]format=gbrp[mb${m}]`);
      grafo.push(`[mb${m}][mq${m}]blend=all_mode=${cam.modo}:eof_action=pass,format=yuv420p[bm${m}]`);
      base = `bm${m}`;
    });
  }

  // Camada do Remotion (textos, legendas, blocos) por cima de tudo.
  if (camada && so !== 'audio') {
    const ci = entradaCamada(camada);
    grafo.push(`[${ci}:v]setpts=PTS-STARTPTS[cam]`);
    grafo.push(`[${base}][cam]overlay=eof_action=pass:format=auto[bc]`);
    base = 'bc';
  }
  const fim = [`format=yuv420p`];
  if (escala !== 1) fim.unshift(`scale=${Math.max(2, Math.round((W * escala) / 2) * 2)}:${Math.max(2, Math.round((H * escala) / 2) * 2)}:flags=lanczos`);
  if (fpsSaida && fpsSaida !== fps) fim.push(`fps=${fpsSaida}`);
  if (so !== 'audio') grafo.push(`[${base}]${fim.join(',')},trim=duration=${num(D)}[vout]`);

  // Áudio: faixas de áudio (mudo respeitado) e o som dos clipes.
  if (so === 'video') audios.length = 0;
  for (const tr of so === 'video' ? [] : t.trilhas) {
    if (!ehAudio(tr) || tr.muda || tr.oculta) continue;
    for (const i of tr.itens) {
      if (i.tipo !== 'audio' || !i.arquivo) continue;
      const vel = i.velocidade ?? 1;
      const idx = entrada(['-ss', String(num(i.corteInicio ?? 0)), '-t', String(num(i.duracao * vel + 0.25)), '-i', path.join(assets, i.arquivo)]);
      audios.push({ i, rotuloEntrada: `${idx}:a:0`, vol: i.volume ?? 1, vel, ini: i.inicio, total: i.duracao });
    }
  }
  const ra = [];
  audios.forEach(({ i, rotuloEntrada, vol, vel, ini, total }, a) => {
    // Tudo em 48 kHz estéreo antes de contar o tempo pelas amostras (N/SR): o tempo de origem de alguns arquivos às vezes
    // vinha inválido (AV_NOPTS), o atrim nunca via o fim e o som ficava sendo montado sem parar.
    const f = ['aresample=48000', 'aformat=sample_rates=48000:channel_layouts=stereo', 'asetpts=N/SR/TB'];
    // atempo aceita de 0,5 a 2 por vez: velocidades fora disso viram uma corrente.
    let v = vel;
    while (v > 2) {
      f.push('atempo=2');
      v /= 2;
    }
    while (v < 0.5) {
      f.push('atempo=0.5');
      v /= 0.5;
    }
    if (Math.abs(v - 1) > 1e-6) f.push(`atempo=${num(v)}`);
    f.push(`atrim=duration=${num(total)}`, `volume=${num(vol)}`);
    if (i.fadeIn > 0) f.push(`afade=t=in:st=0:d=${num(i.fadeIn)}`);
    if (i.fadeOut > 0) f.push(`afade=t=out:st=${num(Math.max(0, total - i.fadeOut))}:d=${num(i.fadeOut)}`);
    f.push(`adelay=${Math.round(ini * 1000)}:all=1`);
    grafo.push(`[${rotuloEntrada}]${f.join(',')}[a${a}]`);
    ra.push(`[a${a}]`);
  });
  let temAudio = false;
  if (ra.length) {
    grafo.push(`${ra.join('')}amix=inputs=${ra.length}:normalize=0:duration=longest,apad=whole_dur=${num(D)},atrim=duration=${num(D)},asetpts=N/SR/TB[aout]`);
    temAudio = true;
  }

  return { entradas, grafo: grafo.join(';\n'), auxiliares, duracao: D, temAudio };
}

// ---------- exportar em trechos ----------
// Um ffmpeg com todos os clipes abre todos ao mesmo tempo: cada decoder de vídeo 4K do iPhone segura uns 230 MB
// (medido: 30 clipes chegaram a 11,7 GB) e a placa de vídeo nem consegue decodificar tantos juntos. Em trechos com
// poucos clipes, a memória fica baixa e a decodificação pode ir para a GPU. Cada trecho sai com a mesma codificação
// e eles são emendados sem recodificar; o som é montado inteiro numa passada à parte, para não ter emenda no áudio.

const EPS = 0.0005;
const cruza = (i, a, b) => i.inicio < b - EPS && i.inicio + i.duracao > a + EPS;

// Onde dá para cortar sem mudar a imagem: fora de transições e de clipes com zoom (o zoom conta do começo do clipe).
function pontosDeCorte(t) {
  const fps = t.fps;
  const visuais = t.trilhas.filter((tr) => !ehAudio(tr) && !tr.oculta);
  const itens = visuais.flatMap((tr) => tr.itens);
  const proibidos = [];
  for (const tr of visuais) {
    for (const x of tr.transicoes ?? []) {
      const a = tr.itens.find((i) => i.id === x.de);
      const b = tr.itens.find((i) => i.id === x.para);
      const corte = b ? b.inicio : a ? a.inicio + a.duracao : null;
      if (corte != null) proibidos.push([corte - (x.duracao ?? 0) - 1 / fps, corte + (x.duracao ?? 0) + 1 / fps]);
    }
  }
  const pode = (c) => !itens.some((i) => temZoom(i) && i.inicio < c - EPS && i.inicio + i.duracao > c + EPS) && !proibidos.some(([a, b]) => c > a && c < b);
  const candidatos = [...new Set(itens.map((i) => Math.round(i.inicio * fps) / fps))].filter((c) => c > EPS).sort((a, b) => a - b);
  return candidatos.filter(pode);
}

// [[início, fim], ...] com no máximo maxClipes clipes de vídeo em cada trecho (quando dá para cortar).
export function trechosDeExportacao(t, { maxClipes = 6, minimo = 1 } = {}) {
  const D = Math.max(0.04, ...t.trilhas.flatMap((tr) => tr.itens).map((i) => i.inicio + i.duracao));
  const videos = t.trilhas.filter((tr) => !ehAudio(tr) && !tr.oculta).flatMap((tr) => tr.itens).filter((i) => i.tipo === 'video');
  const quantos = (a, b) => videos.filter((i) => cruza(i, a, b)).length;
  const trechos = [];
  let inicio = 0;
  const pontos = pontosDeCorte(t).filter((c) => c < D - minimo);
  for (let k = 0; k < pontos.length; k++) {
    const proximo = pontos[k + 1] ?? D;
    // Corta aqui se seguir até o próximo ponto passaria do limite.
    if (pontos[k] - inicio >= minimo && quantos(inicio, proximo) > maxClipes) {
      trechos.push([inicio, pontos[k]]);
      inicio = pontos[k];
    }
  }
  trechos.push([inicio, D]);
  return trechos;
}

// A timeline só com o que aparece entre a e b, com o tempo contado de a. Clipes que atravessam a borda são aparados
// (e o corte no arquivo anda junto); as bordas nunca caem em transição nem em zoom (ver pontosDeCorte).
export function recortarTimeline(t, a, b) {
  return {
    ...t,
    trilhas: t.trilhas
      .filter((tr) => !ehAudio(tr))
      .map((tr) => {
        const itens = tr.itens.filter((i) => cruza(i, a, b)).map((i) => {
          const ini = Math.max(i.inicio, a);
          const fim = Math.min(i.inicio + i.duracao, b);
          const novo = { ...i, inicio: num(ini - a), duracao: num(fim - ini) };
          if (i.tipo === 'video') novo.corteInicio = num((i.corteInicio ?? 0) + (ini - i.inicio) * (i.velocidade ?? 1));
          return novo;
        });
        const ids = new Set(itens.map((i) => i.id));
        const transicoes = (tr.transicoes ?? []).filter((x) => (!x.de || ids.has(x.de)) && (!x.para || ids.has(x.para)) && (ids.has(x.de) || ids.has(x.para)));
        return { ...tr, itens, ...(transicoes.length ? { transicoes } : { transicoes: undefined }) };
      }),
  };
}

// Gera a vinheta e copia as LUTs para a pasta de trabalho, onde o grafo as cita pelo nome (sem caminhos para escapar).
export async function prepararAuxiliares(auxiliares, pasta, rodarFfmpeg) {
  for (const a of auxiliares) {
    const destino = path.join(pasta, a.nome);
    if (a.origem) fs.copyFileSync(a.origem, destino);
    else if (a.vinheta) await rodarFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${a.W}x${a.H},format=rgba`, '-vf', a.vinheta, '-frames:v', '1', destino]);
  }
}
