import React, { useLayoutEffect, useMemo } from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, interpolate, spring, useCurrentFrame, useVideoConfig, delayRender, continueRender,
} from 'remotion';
import { loadFont as anton } from '@remotion/google-fonts/Anton';
import { loadFont as bebas } from '@remotion/google-fonts/BebasNeue';
import { loadFont as calSans } from '@remotion/google-fonts/CalSans';
import { loadFont as inter } from '@remotion/google-fonts/Inter';
import { loadFont as montserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as oswald } from '@remotion/google-fonts/Oswald';
import { loadFont as playfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as poppins } from '@remotion/google-fonts/Poppins';
import { loadFont as redHatDisplay } from '@remotion/google-fonts/RedHatDisplay';
import { loadFont as redHatText } from '@remotion/google-fonts/RedHatText';
import { loadFont as roboto } from '@remotion/google-fonts/Roboto';
import { blocos } from './blocos';
import { ImagemComLut, VideoComLut, type PedidoLut } from './lut';

// Desenha o vídeo a partir de timeline.json. O mesmo componente roda no render e na prévia ao vivo do app.
// Este arquivo é mantido pelo app: efeitos novos vão em blocos.tsx.

const FONTES: Record<string, () => { fontFamily: string }> = {
  Anton: () => anton('normal', { subsets: ['latin', 'latin-ext'] }),
  'Bebas Neue': () => bebas('normal', { subsets: ['latin', 'latin-ext'] }),
  // Só existe num peso: o desenho é o SemiBold do Cal Sans.
  'Cal Sans': () => calSans('normal', { subsets: ['latin', 'latin-ext'] }),
  Inter: () => inter('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '600', '800'] }),
  Montserrat: () => montserrat('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '600', '800'] }),
  Oswald: () => oswald('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '600', '700'] }),
  'Playfair Display': () => playfair('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '700'] }),
  Poppins: () => poppins('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '600', '800'] }),
  'Red Hat Display': () => redHatDisplay('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '700', '900'] }),
  'Red Hat Text': () => redHatText('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '500', '700'] }),
  Roboto: () => roboto('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '500', '700'] }),
};

// Fontes de um peso só: o peso do estilo é ignorado, senão o navegador engrossa a letra por conta própria.
const PESO_UNICO: Record<string, number> = { 'Cal Sans': 400 };

const carregadas = new Map<string, string>();
function familia(nome = 'Montserrat'): string {
  if (!FONTES[nome]) return nome;
  if (!carregadas.has(nome)) carregadas.set(nome, FONTES[nome]().fontFamily);
  return carregadas.get(nome)!;
}

export const semDesativados = (t: any) =>
  t?.trilhas?.some((tr: any) => tr.itens?.some((i: any) => i.desativado))
    ? { ...t, trilhas: t.trilhas.map((tr: any) => ({ ...tr, itens: tr.itens.filter((i: any) => !i.desativado) })) }
    : t;

export const duracaoTimeline = (t: any): number =>
  Math.max(1, ...t.trilhas.flatMap((tr: any) => tr.itens.map((i: any) => i.inicio + i.duracao)));

// ---------- keyframes ----------
// { t (segundos desde o início do item), v, curva: linear|hold|bezier|easeIn|easeOut }.
// A curva vale para o trecho que sai do keyframe, como no Filmcraft.

function bezierY(x1: number, y1: number, x2: number, y2: number, x: number) {
  let lo = 0;
  let hi = 1;
  let s = x;
  for (let n = 0; n < 40; n++) {
    s = (lo + hi) / 2;
    const bx = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
    if (bx < x) lo = s;
    else hi = s;
  }
  return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
}

function facilitar(a: any, b: any, u: number) {
  const sai = a.curva === 'bezier' || a.curva === 'easeOut';
  const chega = b.curva === 'bezier' || b.curva === 'easeIn' || a.curva === 'bezier';
  if (!sai && !chega) return u;
  return bezierY(1 / 3, sai ? 0 : 1 / 3, 2 / 3, chega ? 1 : 2 / 3, u);
}

export function valorEm(kfs: any[], t: number) {
  const k = [...kfs].sort((a, b) => a.t - b.t);
  if (t <= k[0].t) return k[0].v;
  if (t >= k[k.length - 1].t) return k[k.length - 1].v;
  const i = k.findIndex((x) => x.t > t);
  const a = k[i - 1];
  const b = k[i];
  if (a.curva === 'hold') return a.v;
  return a.v + (b.v - a.v) * facilitar(a, b, (t - a.t) / (b.t - a.t));
}

function parametro(item: any, caminho: string, t: number, padrao: number): number {
  const kfs = item.keyframes?.[caminho];
  if (kfs?.length) return valorEm(kfs, t);
  return caminho.split('.').reduce((o: any, k) => o?.[k], item) ?? padrao;
}

// ---------- efeitos ----------

// Curva de tons do Lumetri (destaques, sombras, brancos, pretos), em 17 pontos para o feComponentTransfer.
function curvaDeTons(destaques: number, sombras: number, brancos: number, pretos: number) {
  const pts: string[] = [];
  for (let k = 0; k <= 16; k++) {
    const x = k / 16;
    let y = x;
    y += (sombras / 100) * 0.35 * x * (1 - x) * (1 - x) * 2.2;
    y += (destaques / 100) * 0.35 * x * x * (1 - x) * 2.2;
    y += (pretos / 100) * 0.12 * Math.pow(1 - x, 3);
    y += (brancos / 100) * 0.12 * Math.pow(x, 3);
    pts.push(Math.max(0, Math.min(1, y)).toFixed(4));
  }
  return pts.join(' ');
}

// LUTs pedidas por um item: a dele (efeitos.cor.lut) e as das camadas de ajuste ativas acima dele.
function lutsDe(item: any, ajustes: any[], tAbs: number, url: (a: string) => string): PedidoLut[] {
  const lista: PedidoLut[] = [];
  const de = (alvo: any) => {
    const c = alvo.efeitos?.cor;
    if (c?.lut) lista.push({ url: url(c.lut), intensidade: c.lutIntensidade ?? 100 });
  };
  de(item);
  for (const aj of ajustes) if (tAbs >= aj.inicio && tAbs < aj.inicio + aj.duracao) de(aj);
  return lista;
}

function filtroCss(item: any, e: any, t: number, idCor: string, temCor: boolean) {
  const f: string[] = [];
  const n = (c: string, p: number) => parametro(item, 'efeitos.' + c, t, p);
  if (e.cor) {
    f.push(`brightness(${Math.pow(2, n('cor.exposicao', 0))})`);
    f.push(`contrast(${Math.max(0, 1 + n('cor.contraste', 0) / 100)})`);
    f.push(`saturate(${n('cor.saturacao', 100) / 100})`);
    if (temCor) f.push(`url(#${idCor})`);
  }
  if (e.pb) f.push('grayscale(1)');
  if (e.inverter) f.push('invert(1)');
  // No Filmcraft o sigma é metade do valor de Blurriness.
  if (e.desfoque) f.push(`blur(${n('desfoque.raio', 0) * 0.5}px)`);
  return f.join(' ') || undefined;
}

// soCor: a camada de ajuste passando seus efeitos para quem está embaixo (cor, desfoque, P&B, inverter);
// a vinheta dela é desenhada uma vez só, na própria camada.
function Efeitos({ item, t, children, soCor = false, sufixo = '' }: { item: any; t: number; children: React.ReactNode; soCor?: boolean; sufixo?: string }) {
  const e0 = item.efeitos ?? {};
  if (!item.efeitos) return <>{children}</>;
  const e = soCor ? { cor: e0.cor, desfoque: e0.desfoque, pb: e0.pb, inverter: e0.inverter } : e0;
  const idCor = `cor-${String(item.id).replace(/[^\w-]/g, '')}${sufixo}`;
  const n = (c: string, p: number) => parametro(item, 'efeitos.' + c, t, p);
  const temp = e.cor ? n('cor.temperatura', 0) / 100 : 0;
  const matiz = e.cor ? n('cor.matiz', 0) / 100 : 0;
  const tons = e.cor ? [n('cor.destaques', 0), n('cor.sombras', 0), n('cor.brancos', 0), n('cor.pretos', 0)] : [0, 0, 0, 0];
  const temTons = tons.some((x) => x);
  const vib = e.cor ? n('cor.vibracao', 0) / 100 : 0;
  const temCor = !!(temp || matiz || temTons || vib);
  const corte = e.corte
    ? `inset(${n('corte.cima', 0)}% ${n('corte.direita', 0)}% ${n('corte.baixo', 0)}% ${n('corte.esquerda', 0)}%)`
    : undefined;
  const espelho = [e.espelhoH ? 'scaleX(-1)' : '', e.espelhoV ? 'scaleY(-1)' : ''].join(' ').trim() || undefined;
  const vinheta = e.vinheta ? n('vinheta.quantidade', -50) : 0;
  return (
    <AbsoluteFill style={{ clipPath: corte, transform: espelho, filter: filtroCss(item, e, t, idCor, temCor), alignItems: 'center', justifyContent: 'center' }}>
      {temCor ? (
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <filter id={idCor} colorInterpolationFilters="sRGB">
            {temTons ? (
              <feComponentTransfer>
                <feFuncR type="table" tableValues={curvaDeTons(tons[0], tons[1], tons[2], tons[3])} />
                <feFuncG type="table" tableValues={curvaDeTons(tons[0], tons[1], tons[2], tons[3])} />
                <feFuncB type="table" tableValues={curvaDeTons(tons[0], tons[1], tons[2], tons[3])} />
              </feComponentTransfer>
            ) : null}
            <feColorMatrix type="matrix" values={`${1 + temp * 0.25} 0 0 0 0 0 ${1 - matiz * 0.2} 0 0 0 0 0 ${1 - temp * 0.25} 0 0 0 0 0 1 0`} />
            {vib ? <feColorMatrix type="saturate" values={String(Math.max(0, 1 + vib * 0.6))} /> : null}
          </filter>
        </svg>
      ) : null}
      {children}
      {vinheta ? (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 45%, ${vinheta < 0 ? 'rgba(0,0,0,' : 'rgba(255,255,255,'}${Math.abs(vinheta) / 100}) 100%)` }} />
      ) : null}
    </AbsoluteFill>
  );
}

// ---------- transições ----------
// trilha.transicoes: [{ id, tipo, duracao, alinhamento: centro|inicio|fim, de, para, direcao }].
// O tipo é o id do Filmcraft; os que a prévia não sabe desenhar viram dissolve aqui e seguem intactos lá.

function folgas(tr: any) {
  const d = tr.duracao;
  if (tr.alinhamento === 'inicio') return { antes: 0, depois: d };
  if (tr.alinhamento === 'fim') return { antes: d, depois: 0 };
  return { antes: d / 2, depois: d / 2 };
}

function planoTransicoes(trilha: any) {
  const plano = new Map<string, any>();
  const de = (id: string) => {
    if (!plano.has(id)) plano.set(id, { adiantar: 0, estender: 0 });
    return plano.get(id);
  };
  for (const tr of trilha.transicoes ?? []) {
    const a = trilha.itens.find((i: any) => i.id === tr.de);
    const b = trilha.itens.find((i: any) => i.id === tr.para);
    if (!a && !b) continue;
    const { antes, depois } = folgas(tr);
    const corte = b ? b.inicio : a.inicio + a.duracao;
    if (a) {
      const p = de(a.id);
      if (b) p.estender = depois;
      p.saindo = { tr, ini: corte - antes, fim: corte + depois, comPar: !!b };
    }
    if (b) {
      const p = de(b.id);
      const vel = b.velocidade ?? 1;
      // Sem sobra de arquivo antes do corte, a transição começa quando o clipe começa.
      p.adiantar = b.tipo === 'video' ? Math.min(antes, (b.corteInicio ?? 0) / vel) : antes;
      p.entrando = { tr, ini: corte - antes, fim: corte + depois, comPar: !!a };
    }
  }
  return plano;
}

// O último item desenhado fica por cima: quem entra precisa vir depois de quem sai.
function ordemDesenho(trilha: any) {
  const itens = [...trilha.itens];
  for (const tr of trilha.transicoes ?? []) {
    const ia = itens.findIndex((i) => i.id === tr.de);
    const ib = itens.findIndex((i) => i.id === tr.para);
    if (ia >= 0 && ib >= 0 && ib < ia) [itens[ia], itens[ib]] = [itens[ib], itens[ia]];
  }
  return itens;
}

const CORTINAS: Record<string, string> = { dip_to_black: '#000000', dip_to_white: '#ffffff', flash: '#ffffff' };
const DIRECOES: Record<string, [number, number]> = { esq: [-1, 0], dir: [1, 0], cima: [0, -1], baixo: [0, 1] };

function estiloTransicao(tr: any, papel: 'sai' | 'entra', p: number, comPar: boolean): { estilo: React.CSSProperties; cortina?: { cor: string; opacidade: number } } {
  const tipo = tr.tipo;
  const cortina = tr.cor ?? CORTINAS[tipo];
  if (cortina || tipo === 'dip_to_color') {
    const cor = cortina ?? '#000000';
    if (papel === 'sai') return { estilo: { opacity: !comPar || p < 0.5 ? 1 : 0 }, cortina: { cor, opacidade: Math.min(1, p * 2) } };
    return { estilo: { opacity: !comPar || p >= 0.5 ? 1 : 0 }, cortina: { cor, opacidade: Math.min(1, (1 - p) * 2) } };
  }
  const [dx, dy] = DIRECOES[tr.direcao ?? 'esq'] ?? DIRECOES.esq;
  const mover = (q: number) => `translate(${dx * q * 100}%, ${dy * q * 100}%)`;
  if (tipo === 'push' || tipo === 'whip') {
    const blur = tipo === 'whip' ? `blur(${Math.sin(p * Math.PI) * 30}px)` : undefined;
    return { estilo: { transform: papel === 'sai' ? mover(p) : mover(p - 1), filter: blur } };
  }
  if (tipo === 'slide') return { estilo: papel === 'entra' ? { transform: mover(p - 1) } : {} };
  if (tipo === 'linear_wipe' || tipo === 'wipe' || tipo === 'soft_wipe') {
    return { estilo: papel === 'entra' ? { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` } : {} };
  }
  if (tipo === 'iris_round') return { estilo: papel === 'entra' ? { clipPath: `circle(${p * 75}% at 50% 50%)` } : {} };
  if (tipo === 'cross_zoom' || tipo === 'zoom_blur') {
    const blur = `blur(${Math.sin(p * Math.PI) * 18}px)`;
    if (papel === 'sai') return { estilo: { transform: `scale(${1 + p})`, filter: blur } };
    return { estilo: { transform: `scale(${2 - p})`, filter: blur, opacity: p } };
  }
  // Dissolve e qualquer tipo que só existe no Filmcraft.
  if (papel === 'entra') return { estilo: { opacity: p } };
  return { estilo: comPar ? {} : { opacity: 1 - p } };
}

function Transicao({ plano, inicio, fps, children }: { plano: any; inicio: number; fps: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  if (!plano?.saindo && !plano?.entrando) return <>{children}</>;
  const agora = inicio + frame / fps;
  const f = agora < (plano.entrando?.fim ?? -Infinity) ? plano.entrando : plano.saindo;
  if (!f || agora < f.ini || agora > f.fim) return <>{children}</>;
  const p = Math.max(0, Math.min(1, (agora - f.ini) / Math.max(1 / fps, f.fim - f.ini)));
  const { estilo, cortina } = estiloTransicao(f.tr, f === plano.entrando ? 'entra' : 'sai', p, f.comPar);
  return (
    <AbsoluteFill style={estilo}>
      {children}
      {cortina ? <AbsoluteFill style={{ background: cortina.cor, opacity: cortina.opacidade }} /> : null}
    </AbsoluteFill>
  );
}

// Entrada e saída: valores de opacidade e transform para o quadro atual.
function animacao(item: any, frame: number, fps: number, total: number) {
  let opacidade = 1;
  let dx = 0;
  let dy = 0;
  let escala = 1;
  const aplicar = (a: any, p: number) => {
    const longe = 200;
    if (a.tipo === 'fade') opacidade *= p;
    if (a.tipo === 'slide-cima') { dy += (1 - p) * longe; opacidade *= p; }
    if (a.tipo === 'slide-baixo') { dy -= (1 - p) * longe; opacidade *= p; }
    if (a.tipo === 'slide-esq') { dx += (1 - p) * longe; opacidade *= p; }
    if (a.tipo === 'slide-dir') { dx -= (1 - p) * longe; opacidade *= p; }
    if (a.tipo === 'zoom') { escala *= interpolate(p, [0, 1], [1.25, 1]); opacidade *= p; }
    if (a.tipo === 'pop') { escala *= p; }
  };
  if (item.entrada?.tipo) {
    const d = Math.max(1, Math.round((item.entrada.duracao ?? 0.3) * fps));
    const p = item.entrada.tipo === 'pop'
      ? spring({ frame, fps, durationInFrames: d, config: { damping: 11, stiffness: 180 } })
      : interpolate(frame, [0, d], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    aplicar(item.entrada, p);
  }
  if (item.saida?.tipo) {
    const d = Math.max(1, Math.round((item.saida.duracao ?? 0.3) * fps));
    aplicar(item.saida, interpolate(frame, [total - d, total], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  }
  return { opacidade, dx, dy, escala };
}

function Caixa({ item, durFrames, atraso = 0, ajustes = [], children }: { item: any; durFrames: number; atraso?: number; ajustes?: any[]; children: React.ReactNode }) {
  const { fps } = useVideoConfig();
  // Quem entra por transição começa antes do seu início: tempos e animações continuam contando dele.
  const frame = useCurrentFrame() - Math.round(atraso * fps);
  const t = frame / fps;
  const a = animacao(item, frame, fps, durFrames);
  const zoom = item.zoom
    ? interpolate(frame, [0, durFrames], [item.zoom.de ?? 1, item.zoom.para ?? 1], { extrapolateRight: 'clamp' })
    : 1;
  const rotacao = parametro(item, 'rotacao', t, 0);
  const transform = [
    `translate(${parametro(item, 'x', t, 0) + a.dx}px, ${parametro(item, 'y', t, 0) + a.dy}px)`,
    `scale(${parametro(item, 'escala', t, 1) * zoom * a.escala})`,
    rotacao ? `rotate(${rotacao}deg)` : '',
  ].join(' ');
  return (
    <AbsoluteFill style={{ opacity: parametro(item, 'opacidade', t, 1) * a.opacidade, transform, alignItems: 'center', justifyContent: 'center' }}>
      <Efeitos item={item} t={t}>
        {ajustes.reduce((dentro: React.ReactNode, aj: any) => {
          const tAj = item.inicio + t - aj.inicio;
          if (tAj < 0 || tAj >= aj.duracao) return dentro;
          return (
            <Efeitos item={aj} t={tAj} soCor sufixo={`-${String(item.id).replace(/[^\w-]/g, '')}`}>
              {dentro}
            </Efeitos>
          );
        }, children)}
      </Efeitos>
    </AbsoluteFill>
  );
}

function estiloTexto(e: any = {}): React.CSSProperties {
  return {
    fontFamily: familia(e.fonte),
    fontSize: e.tamanho ?? 64,
    fontWeight: PESO_UNICO[e.fonte] ?? e.peso ?? 800,
    color: e.cor ?? '#ffffff',
    textAlign: e.alinhamento ?? 'center',
    textTransform: e.maiusculas ? 'uppercase' : 'none',
    lineHeight: e.entrelinha ?? 1.15,
    WebkitTextStroke: e.contorno ? `${e.contornoLargura ?? 4}px ${e.contorno}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: e.sombra ?? undefined,
    background: e.fundo ?? undefined,
    padding: e.fundo ? '0.15em 0.4em' : undefined,
    borderRadius: e.fundo ? '0.2em' : undefined,
    whiteSpace: 'pre-wrap',
  };
}

function Legenda({ item }: { item: any }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const e = item.estilo ?? {};
  const palavras: any[] | undefined = item.palavras;
  return (
    <div style={{ ...estiloTexto(e), maxWidth: width * 0.86 }}>
      {palavras?.length
        ? palavras.map((p, i) => {
            // Tempos das palavras são relativos ao início da legenda.
            const ativa = t >= p.inicio && t < p.fim;
            return (
              <span key={i} style={{ color: ativa && e.corDestaque ? e.corDestaque : undefined }}>
                {p.texto}{i < palavras.length - 1 ? ' ' : ''}
              </span>
            );
          })
        : item.texto}
    </div>
  );
}

// Camada de ajuste: os efeitos valem para tudo o que está nas faixas de baixo (ver Caixa); aqui só a vinheta.
function CamadaAjuste({ item }: { item: any }) {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  if (!item.efeitos?.vinheta) return null;
  const v = parametro(item, 'efeitos.vinheta.quantidade', t, -50);
  if (!v) return null;
  return <AbsoluteFill style={{ opacity: parametro(item, 'opacidade', t, 1), background: `radial-gradient(ellipse at center, transparent 45%, ${v < 0 ? 'rgba(0,0,0,' : 'rgba(255,255,255,'}${Math.abs(v) / 100}) 100%)` }} />;
}

function Item({ item, fps, url, volumeTrilha, proxies, atraso = 0, ajustes = [] }: { item: any; fps: number; url: (a: string) => string; volumeTrilha: number; proxies?: Record<string, string | null>; atraso?: number; ajustes?: any[] }) {
  const quadro = useCurrentFrame();
  if (item.tipo === 'ajuste') return <CamadaAjuste item={item} />;
  const tAbs = item.inicio - atraso + quadro / fps;
  const luts = item.tipo === 'video' || item.tipo === 'imagem' ? lutsDe(item, ajustes, tAbs, url) : [];
  const durFrames = Math.max(1, Math.round(item.duracao * fps));
  const velocidade = item.velocidade ?? 1;
  const trim = Math.max(0, Math.round(((item.corteInicio ?? 0) - atraso * velocidade) * fps));
  if (item.tipo === 'audio') {
    const volume = (f: number) => {
      const fi = (item.fadeIn ?? 0) * fps;
      const fo = (item.fadeOut ?? 0) * fps;
      const entrada = fi > 0 ? Math.min(1, f / fi) : 1;
      const saida = fo > 0 ? Math.min(1, (durFrames - f) / fo) : 1;
      return Math.max(0, (item.volume ?? 1) * volumeTrilha * entrada * saida);
    };
    return <Audio src={url(item.arquivo)} trimBefore={trim} volume={volume} playbackRate={velocidade} />;
  }
  if (item.tipo === 'video') {
    // Só na prévia: arquivo que o player não toca e cuja cópia leve ainda não ficou pronta.
    if (proxies?.[item.arquivo] === null) {
      return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: '#1f2027', color: '#9a9cab', fontFamily: 'sans-serif', fontSize: 40 }}>
          Preparando prévia…
        </AbsoluteFill>
      );
    }
    const estilo: React.CSSProperties = { width: '100%', height: '100%', objectFit: item.ajuste ?? 'cover' };
    return (
      <Caixa item={item} durFrames={durFrames} atraso={atraso} ajustes={ajustes}>
        {luts.length ? (
          <VideoComLut luts={luts} src={proxies?.[item.arquivo] ?? url(item.arquivo)} trimBefore={trim} playbackRate={velocidade} volume={(item.volume ?? 0) * volumeTrilha} muted={!(item.volume ?? 0) || !volumeTrilha} style={estilo} />
        ) : (
          <OffthreadVideo src={proxies?.[item.arquivo] ?? url(item.arquivo)} trimBefore={trim} playbackRate={velocidade} volume={(item.volume ?? 0) * volumeTrilha} muted={!(item.volume ?? 0) || !volumeTrilha} style={estilo} />
        )}
      </Caixa>
    );
  }
  if (item.tipo === 'imagem') {
    const ajuste = item.ajuste ?? 'contain';
    const estilo: React.CSSProperties = item.largura
      ? { width: item.largura }
      : { width: '100%', height: '100%', objectFit: ajuste };
    return (
      <Caixa item={item} durFrames={durFrames} atraso={atraso} ajustes={ajustes}>
        {luts.length ? <ImagemComLut luts={luts} src={url(item.arquivo)} style={estilo} /> : <Img src={url(item.arquivo)} style={estilo} />}
      </Caixa>
    );
  }
  if (item.tipo === 'texto') {
    return (
      <Caixa item={item} durFrames={durFrames} ajustes={ajustes}>
        <div style={estiloTexto(item.estilo)}>{item.texto}</div>
      </Caixa>
    );
  }
  if (item.tipo === 'legenda') {
    return (
      <Caixa item={item} durFrames={durFrames} ajustes={ajustes}>
        <Legenda item={item} />
      </Caixa>
    );
  }
  if (item.tipo === 'bloco') {
    const Bloco = blocos[item.componente];
    if (!Bloco) return null;
    return (
      <Caixa item={item} durFrames={durFrames} ajustes={ajustes}>
        <Bloco {...(item.props ?? {})} duracaoFrames={durFrames} />
      </Caixa>
    );
  }
  return null;
}

type PropsTrilha = { trilha: any; fps: number; url: (a: string) => string; proxies?: Record<string, string | null>; ajustes?: any[] };

// Só na prévia: cada Sequence é refeita a cada quadro, mesmo fora da tela. Com janela, entram só os itens por perto.
// A janela anda em blocos, para não refazer a lista a cada quadro; a folga cobre o tempo de preparar o próximo vídeo.
const SEGUNDOS_JANELA = 4;
const FOLGA_JANELA = 2;

const TrilhaNaJanela: React.FC<PropsTrilha> = (props) => {
  const { trilha, fps } = props;
  const bloco = Math.floor(useCurrentFrame() / fps / SEGUNDOS_JANELA);
  const plano = useMemo(() => planoTransicoes(trilha), [trilha]);
  const itens = useMemo(() => {
    const de = bloco * SEGUNDOS_JANELA - FOLGA_JANELA;
    const ate = (bloco + 1) * SEGUNDOS_JANELA + FOLGA_JANELA;
    return ordemDesenho(trilha).filter((i: any) => {
      const pl = plano.get(i.id);
      return i.inicio + i.duracao + (pl?.estender ?? 0) >= de && i.inicio - (pl?.adiantar ?? 0) <= ate;
    });
  }, [trilha, plano, bloco]);
  return <ItensDaTrilha {...props} itens={itens} plano={plano} />;
};

const Trilha: React.FC<PropsTrilha> = (props) => {
  const plano = useMemo(() => planoTransicoes(props.trilha), [props.trilha]);
  const itens = useMemo(() => ordemDesenho(props.trilha), [props.trilha]);
  return <ItensDaTrilha {...props} itens={itens} plano={plano} />;
};

const ItensDaTrilha = React.memo(({ trilha, fps, url, proxies, itens, plano, ajustes }: PropsTrilha & { itens: any[]; plano: Map<string, any> }) => {
  return (
    <>
      {itens.map((item: any) => {
        const pl = plano.get(item.id);
        const adiantar = pl?.adiantar ?? 0;
        const inicio = item.inicio - adiantar;
        // Fim pelo quadro onde o item termina, não pela duração arredondada à parte: com início e duração fora da grade
        // de quadros, os dois arredondamentos somados deixavam 1 quadro preto entre um clipe e o seguinte.
        const de = Math.round(inicio * fps);
        const ate = Math.round((item.inicio + item.duracao + (pl?.estender ?? 0)) * fps);
        return (
          <Sequence
            key={item.id}
            from={de}
            durationInFrames={Math.max(1, ate - de)}
            premountFor={item.tipo === 'video' ? fps : undefined}
            name={item.texto ?? item.arquivo ?? item.componente ?? item.tipo}
            style={item.mesclagem ? { mixBlendMode: item.mesclagem } : undefined}
          >
            <Transicao plano={pl} inicio={inicio} fps={fps}>
              <Item item={item} fps={fps} url={url} volumeTrilha={trilha.muda ? 0 : 1} proxies={proxies} atraso={adiantar} ajustes={ajustes} />
            </Transicao>
          </Sequence>
        );
      })}
    </>
  );
});

// Fontes que o usuário adicionou no app: "fontes" na timeline mapeia a família para o arquivo em assets/. O render espera o carregamento.
const fontesRegistradas = new Set<string>();
function useFontesDoUsuario(fontes: Record<string, string> | undefined, url: (a: string) => string) {
  const chave = JSON.stringify(fontes ?? {});
  useLayoutEffect(() => {
    const pendentes = Object.entries(fontes ?? {}).filter(([nome, arq]) => !fontesRegistradas.has(nome + '|' + arq));
    if (!pendentes.length) return;
    const espera = delayRender('fontes do usuário');
    Promise.all(
      pendentes.map(async ([nome, arq]) => {
        const f = new FontFace(nome, `url("${url(arq)}")`, { weight: '100 900' });
        await f.load();
        document.fonts.add(f);
        fontesRegistradas.add(nome + '|' + arq);
      }),
    )
      .catch(() => {})
      .finally(() => continueRender(espera));
  }, [chave, url]);
}

export const TimelineVideo: React.FC<{ timeline: any; baseAssets?: string; proxies?: Record<string, string | null>; janela?: boolean }> = ({ timeline: bruta, baseAssets, proxies, janela }) => {
  // Clipe desativado (V na timeline) continua no arquivo, mas não aparece nem toca.
  const timeline = useMemo(() => semDesativados(bruta), [bruta]);
  const { fps } = useVideoConfig();
  const Componente = janela ? TrilhaNaJanela : Trilha;
  const url = useMemo(
    () => (a: string) => (baseAssets ? baseAssets + encodeURIComponent(a) : staticFile(a)),
    [baseAssets],
  );
  useFontesDoUsuario(timeline.fontes, url);
  // Para cada faixa, as camadas de ajuste das faixas de vídeo acima dela (a mais próxima primeiro).
  const ajustesAcima = useMemo(() => {
    const visiveis = timeline.trilhas.map((tr: any) => (tr.tipo !== 'audio' && !tr.oculta ? tr.itens.filter((i: any) => i.tipo === 'ajuste' && i.efeitos) : []));
    return timeline.trilhas.map((_: any, k: number) => visiveis.slice(k + 1).flat());
  }, [timeline]);
  return (
    <AbsoluteFill style={{ backgroundColor: timeline.fundo ?? '#000' }}>
      {timeline.trilhas.map((trilha: any, k: number) =>
        trilha.oculta ? null : <Componente key={trilha.id} trilha={trilha} fps={fps} url={url} proxies={proxies} ajustes={trilha.tipo === 'audio' ? undefined : ajustesAcima[k]} />,
      )}
    </AbsoluteFill>
  );
};
