import { Composition } from 'remotion';
import timeline from '../timeline.json';
import { TimelineVideo, duracaoTimeline } from './TimelineVideo';

const t: any = timeline;

export const RemotionRoot = () => (
  <Composition
    id="Main"
    component={TimelineVideo}
    width={t.largura}
    height={t.altura}
    fps={t.fps}
    durationInFrames={Math.ceil(duracaoTimeline(t) * t.fps)}
    defaultProps={{ timeline: t }}
  />
);
