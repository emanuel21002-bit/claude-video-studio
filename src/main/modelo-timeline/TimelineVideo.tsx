import React, { useMemo } from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, interpolate, spring, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { loadFont as anton } from '@remotion/google-fonts/Anton';
import { loadFont as bebas } from '@remotion/google-fonts/BebasNeue';
import { loadFont as inter } from '@remotion/google-fonts/Inter';
import { loadFont as montserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as oswald } from '@remotion/google-fonts/Oswald';
import { loadFont as playfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as poppins } from '@remotion/google-fonts/Poppins';
import { loadFont as roboto } from '@remotion/google-fonts/Roboto';
import { blocos } from './blocos';

// Desenha o vídeo a partir de timeline.json. O mesmo componente roda no render e na prévia ao vivo do app.
// Este arquivo é mantido pelo app: efeitos novos vão em blocos.tsx.

const FONTES: Record<string, () => { fontFamily: string }> = {
  Anton: () => anton('normal', { subsets: ['latin', 'latin-ext'] }),
  'Bebas Neue': () => bebas('normal', { subsets: ['latin', 'latin-ext'] }),
  Inter: () => inter('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '600', '800'] }),
  Montserrat: () => montserrat('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '600', '800'] }),
  Oswald: () => oswald('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '600', '700'] }),
  'Playfair Display': () => playfair('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '700'] }),
  Poppins: () => poppins('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '600', '800'] }),
  Roboto: () => roboto('normal', { subsets: ['latin', 'latin-ext'], weights: ['400', '500', '700'] }),
};

const carregadas = new Map<string, string>();
function familia(nome = 'Montserrat'): string {
  if (!FONTES[nome]) return nome;
  if (!carregadas.has(nome)) carregadas.set(nome, FONTES[nome]().fontFamily);
  return carregadas.get(nome)!;
}

export const duracaoTimeline = (t: any): number =>
  Math.max(1, ...t.trilhas.flatMap((tr: any) => tr.itens.map((i: any) => i.inicio + i.duracao)));

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

function Caixa({ item, durFrames, children }: { item: any; durFrames: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = animacao(item, frame, fps, durFrames);
  const zoom = item.zoom
    ? interpolate(frame, [0, durFrames], [item.zoom.de ?? 1, item.zoom.para ?? 1], { extrapolateRight: 'clamp' })
    : 1;
  const transform = [
    `translate(${(item.x ?? 0) + a.dx}px, ${(item.y ?? 0) + a.dy}px)`,
    `scale(${(item.escala ?? 1) * zoom * a.escala})`,
    item.rotacao ? `rotate(${item.rotacao}deg)` : '',
  ].join(' ');
  return (
    <AbsoluteFill style={{ opacity: (item.opacidade ?? 1) * a.opacidade, transform, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </AbsoluteFill>
  );
}

function estiloTexto(e: any = {}): React.CSSProperties {
  return {
    fontFamily: familia(e.fonte),
    fontSize: e.tamanho ?? 64,
    fontWeight: e.peso ?? 800,
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

function Item({ item, fps, url, volumeTrilha, proxies }: { item: any; fps: number; url: (a: string) => string; volumeTrilha: number; proxies?: Record<string, string | null> }) {
  const durFrames = Math.max(1, Math.round(item.duracao * fps));
  const velocidade = item.velocidade ?? 1;
  const trim = Math.round((item.corteInicio ?? 0) * fps);
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
      <Caixa item={item} durFrames={durFrames}>
        <OffthreadVideo src={proxies?.[item.arquivo] ?? url(item.arquivo)} trimBefore={trim} playbackRate={velocidade} volume={(item.volume ?? 0) * volumeTrilha} muted={!(item.volume ?? 0) || !volumeTrilha} style={estilo} />
      </Caixa>
    );
  }
  if (item.tipo === 'imagem') {
    const ajuste = item.ajuste ?? 'contain';
    const estilo: React.CSSProperties = item.largura
      ? { width: item.largura }
      : { width: '100%', height: '100%', objectFit: ajuste };
    return (
      <Caixa item={item} durFrames={durFrames}>
        <Img src={url(item.arquivo)} style={estilo} />
      </Caixa>
    );
  }
  if (item.tipo === 'texto') {
    return (
      <Caixa item={item} durFrames={durFrames}>
        <div style={estiloTexto(item.estilo)}>{item.texto}</div>
      </Caixa>
    );
  }
  if (item.tipo === 'legenda') {
    return (
      <Caixa item={item} durFrames={durFrames}>
        <Legenda item={item} />
      </Caixa>
    );
  }
  if (item.tipo === 'bloco') {
    const Bloco = blocos[item.componente];
    if (!Bloco) return null;
    return (
      <Caixa item={item} durFrames={durFrames}>
        <Bloco {...(item.props ?? {})} duracaoFrames={durFrames} />
      </Caixa>
    );
  }
  return null;
}

export const TimelineVideo: React.FC<{ timeline: any; baseAssets?: string; proxies?: Record<string, string | null> }> = ({ timeline, baseAssets, proxies }) => {
  const { fps } = useVideoConfig();
  const url = useMemo(
    () => (a: string) => (baseAssets ? baseAssets + encodeURIComponent(a) : staticFile(a)),
    [baseAssets],
  );
  return (
    <AbsoluteFill style={{ backgroundColor: timeline.fundo ?? '#000' }}>
      {timeline.trilhas.map((trilha: any) =>
        trilha.oculta
          ? null
          : trilha.itens.map((item: any) => (
              <Sequence
                key={item.id}
                from={Math.round(item.inicio * fps)}
                durationInFrames={Math.max(1, Math.round(item.duracao * fps))}
                premountFor={item.tipo === 'video' ? fps : undefined}
                name={item.texto ?? item.arquivo ?? item.componente ?? item.tipo}
              >
                <Item item={item} fps={fps} url={url} volumeTrilha={trilha.muda ? 0 : 1} proxies={proxies} />
              </Sequence>
            )),
      )}
    </AbsoluteFill>
  );
};
