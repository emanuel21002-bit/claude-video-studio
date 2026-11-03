import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, PlayerRef } from '@remotion/player';
import { TimelineVideo, duracaoTimeline } from './TimelineVideo';

// Prévia ao vivo no app. Empacotado com esbuild para .previa/previa.js; a timeline chega como dado,
// então editar não exige empacotar de novo (só mudar código em blocos.tsx ou neste arquivo).

const Previa = forwardRef<any, { inicial: any; baseAssets: string; proxiesIniciais: Record<string, string | null>; frameInicial: number; aoQuadro: (f: number) => void; aoTocar: (s: boolean) => void }>(
  ({ inicial, baseAssets, proxiesIniciais, frameInicial, aoQuadro, aoTocar }, ref) => {
    const [timeline, setTimeline] = useState(inicial);
    const [proxies, setProxies] = useState(proxiesIniciais);
    const player = useRef<PlayerRef>(null);
    const ligado = useRef(false);

    useImperativeHandle(ref, () => ({
      atualizar: setTimeline,
      atualizarProxies: setProxies,
      tocar: () => player.current?.play(),
      pausar: () => player.current?.pause(),
      alternar: () => player.current?.toggle(),
      irPara: (f: number) => player.current?.seekTo(f),
      tocando: () => player.current?.isPlaying() ?? false,
    }));

    const aoMontar = (r: PlayerRef | null) => {
      (player as React.MutableRefObject<PlayerRef | null>).current = r;
      if (!r || ligado.current) return;
      ligado.current = true;
      r.addEventListener('frameupdate', (e) => aoQuadro(e.detail.frame));
      r.addEventListener('seeked', (e) => aoQuadro(e.detail.frame));
      r.addEventListener('play', () => aoTocar(true));
      r.addEventListener('pause', () => aoTocar(false));
      r.addEventListener('ended', () => aoTocar(false));
    };

    return (
      <Player
        ref={aoMontar}
        component={TimelineVideo}
        inputProps={{ timeline, baseAssets, proxies }}
        compositionWidth={timeline.largura}
        compositionHeight={timeline.altura}
        fps={timeline.fps}
        durationInFrames={Math.ceil(duracaoTimeline(timeline) * timeline.fps)}
        style={{ width: '100%', height: '100%' }}
        initialFrame={frameInicial}
        acknowledgeRemotionLicense
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        numberOfSharedAudioTags={12}
      />
    );
  },
);

(window as any).PreviaTimeline = {
  montar(el: HTMLElement, opcoes: { timeline: any; baseAssets: string; proxies: Record<string, string | null>; frameInicial: number; aoQuadro: (f: number) => void; aoTocar: (s: boolean) => void }) {
    const raiz = createRoot(el);
    const ref = React.createRef<any>();
    raiz.render(
      <Previa ref={ref} inicial={opcoes.timeline} baseAssets={opcoes.baseAssets} proxiesIniciais={opcoes.proxies} frameInicial={opcoes.frameInicial} aoQuadro={opcoes.aoQuadro} aoTocar={opcoes.aoTocar} />,
    );
    return { ref, desmontar: () => raiz.unmount() };
  },
};
