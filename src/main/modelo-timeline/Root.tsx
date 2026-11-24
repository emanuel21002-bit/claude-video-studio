import { Composition } from 'remotion';
import timeline from '../timeline.json';
import { TimelineVideo, duracaoTimeline } from './TimelineVideo';

const t: any = timeline;

// Tamanho, fps e duração vêm da timeline recebida (props), não da empacotada: o app guarda o pacote entre renders
// (ver pacote-remotion.mjs) e sempre passa a timeline atual com --props. Sem props, vale a timeline.json do pacote.
export const RemotionRoot = () => (
  <Composition
    id="Main"
    component={TimelineVideo}
    width={t.largura}
    height={t.altura}
    fps={t.fps}
    durationInFrames={Math.ceil(duracaoTimeline(t) * t.fps)}
    defaultProps={{ timeline: t }}
    calculateMetadata={({ props }: { props: any }) => {
      const x = props.timeline ?? t;
      return { width: x.largura, height: x.altura, fps: x.fps, durationInFrames: Math.max(1, Math.ceil(duracaoTimeline(x) * x.fps)) };
    }}
  />
);
