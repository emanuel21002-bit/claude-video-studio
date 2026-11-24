// Pré-render em segundo plano, como o Premiere faz com as prévias: um tempo depois da última edição, com o app sem
// render, prepara o que o export vai precisar, em prioridade baixa. Primeiro a mídia otimizada (ver otimizada.mjs),
// depois a camada de textos do Remotion. Começar um render ou editar de novo cancela na hora; o que já ficou pronto
// fica guardado e o export só aproveita.

import { trabalhoPesado } from './proc.mjs';

const ESPERA = 20_000; // ms depois da última edição
let timer = null;
let controle = null;

export function pararSegundoPlano() {
  clearTimeout(timer);
  timer = null;
  controle?.abort();
  controle = null;
}

export function agendarSegundoPlano(id, onLinha) {
  pararSegundoPlano();
  timer = setTimeout(() => rodar(id, onLinha), ESPERA);
}

async function rodar(id, onLinha) {
  timer = null;
  // Render em andamento: tenta de novo depois.
  if (trabalhoPesado.renders > 0) {
    timer = setTimeout(() => rodar(id, onLinha), ESPERA);
    return;
  }
  const meu = new AbortController();
  controle = meu;
  const sinal = meu.signal;
  try {
    const { lerProjeto } = await import('./workspace.mjs');
    const { lerTimelineDoRender } = await import('./timeline.mjs');
    const projeto = lerProjeto(id);
    if (projeto.engine !== 'remotion' || !projeto.timeline) return;
    const t = lerTimelineDoRender(id);
    const { prepararOtimizadas } = await import('./otimizada.mjs');
    await prepararOtimizadas(id, t, { sinal, onLinha: (l) => onLinha?.(`Segundo plano: ${l}`) });
    if (sinal.aborted) return;
    const { renderizarCamadas } = await import('./filmcraft.mjs');
    await renderizarCamadas(id, t, (l) => onLinha?.(`Segundo plano: ${l}`), { sinal, baixa: true });
    if (!sinal.aborted) onLinha?.('Segundo plano: tudo pronto para o export.');
  } catch (e) {
    if (!sinal.aborted) onLinha?.(`Segundo plano parou: ${String(e.message ?? e).split('\n')[0]}`);
  } finally {
    if (controle === meu) controle = null;
  }
}
