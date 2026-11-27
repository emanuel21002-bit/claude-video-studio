// Sequência aninhada (o "Aninhar" do Premiere): um item { tipo: 'aninhada', nome, inicio, duracao, corteInicio,
// trilhas } numa faixa de vídeo. As faixas de dentro têm os tempos contados do começo da aninhada (0); corteInicio é o
// ponto de dentro onde o item começa (aparar o começo da aninhada anda por dentro dela, como num clipe).
//
// A prévia e o Remotion desenham a aninhada como um clipe só (movimento, opacidade e efeitos valem para tudo o que
// está dentro). O export rápido, o Filmcraft e o Premiere recebem as faixas de dentro desmontadas no lugar dela
// (achatarAninhadas): sem movimento nem efeito na aninhada, o resultado é o mesmo.

export const ehAninhada = (i) => i?.tipo === 'aninhada';

// Aninhada sem nada próprio (só agrupa): desmontar não muda a imagem.
const PROPRIOS = ['x', 'y', 'escala', 'rotacao', 'efeitos', 'keyframes', 'mesclagem', 'entrada', 'saida', 'zoom'];
export const aninhadaSimples = (i) => PROPRIOS.every((k) => i[k] == null || (typeof i[k] === 'object' && !Object.keys(i[k]).length)) && (i.opacidade ?? 1) === 1;

// Todos os itens, inclusive os de dentro das aninhadas (para achar arquivos, fontes, mídia).
export function itensProfundos(t) {
  const lista = [];
  const visitar = (trilhas) => {
    for (const tr of trilhas ?? []) {
      for (const i of tr.itens ?? []) {
        lista.push(i);
        if (ehAninhada(i)) visitar(i.trilhas);
      }
    }
  };
  visitar(t?.trilhas);
  return lista;
}

const n6 = (x) => Math.round(x * 1e6) / 1e6;
const clonar = (x) => JSON.parse(JSON.stringify(x));

// Cópia do item recortada ao intervalo [a, b] (tempos de dentro), com o tempo contado a partir de a. null: fora dele.
export function recortarItem(i, a, b) {
  const ini = Math.max(i.inicio, a);
  const fim = Math.min(i.inicio + i.duracao, b);
  if (fim - ini < 0.0005) return null;
  const d = ini - i.inicio;
  const novo = { ...clonar(i), inicio: n6(ini - a), duracao: n6(fim - ini) };
  if (d > 0.0005) {
    if (i.tipo === 'video' || i.tipo === 'audio') novo.corteInicio = n6((i.corteInicio ?? 0) + d * (i.velocidade ?? 1));
    if (ehAninhada(i)) novo.corteInicio = n6((i.corteInicio ?? 0) + d);
    if (novo.palavras) novo.palavras = novo.palavras.map((p) => ({ ...p, inicio: n6(p.inicio - d), fim: n6(p.fim - d) })).filter((p) => p.fim > 0);
    if (novo.keyframes) for (const k of Object.keys(novo.keyframes)) novo.keyframes[k] = novo.keyframes[k].map((x) => ({ ...x, t: n6(x.t - d) }));
    delete novo.entrada;
  }
  if (fim < i.inicio + i.duracao - 0.0005) delete novo.saida;
  return novo;
}

// Desmonta as aninhadas: as faixas de vídeo de dentro entram logo acima da faixa da aninhada (na mesma altura de
// camada) e as de áudio no fim. todas: também as que têm movimento ou efeito próprio (o que é delas se perde; vai
// para avisos). Sem aninhadas, devolve a mesma timeline.
export function achatarAninhadas(t, { todas = false, avisos = null } = {}) {
  if (!itensProfundos(t).some(ehAninhada)) return t;
  const trilhas = [];
  const audios = [];
  for (const tr of t.trilhas) {
    const desmontar = tr.itens.filter((i) => ehAninhada(i) && (todas || aninhadaSimples(i)));
    if (!desmontar.length) {
      trilhas.push(tr);
      continue;
    }
    const fora = new Set(desmontar.map((i) => i.id));
    const transicoes = (tr.transicoes ?? []).filter((x) => !fora.has(x.de) && !fora.has(x.para));
    trilhas.push({ ...tr, itens: tr.itens.filter((i) => !fora.has(i.id)), transicoes: transicoes.length ? transicoes : undefined });
    for (const n of desmontar) {
      if (!aninhadaSimples(n)) avisos?.push(`A sequência aninhada "${n.nome ?? n.id}" foi desmontada: movimento, opacidade e efeitos dela ficaram de fora.`);
      if (n.desativado) continue;
      const dentro = achatarAninhadas({ ...t, trilhas: n.trilhas ?? [] }, { todas, avisos });
      const a = n.corteInicio ?? 0;
      const b = a + n.duracao;
      for (const sub of dentro.trilhas) {
        const itens = sub.itens.filter((i) => !i.desativado).map((i) => recortarItem(i, a, b)).filter(Boolean).map((i) => ({ ...i, inicio: n6(i.inicio + n.inicio) }));
        const ids = new Set(itens.map((i) => i.id));
        const trs = (sub.transicoes ?? []).filter((x) => (!x.de || ids.has(x.de)) && (!x.para || ids.has(x.para)) && (ids.has(x.de) || ids.has(x.para)));
        const nova = { ...sub, id: `${n.id}~${sub.id}`, itens, transicoes: trs.length ? trs : undefined };
        // Faixa de fora escondida (ou desligada): o que estava dentro também não aparece.
        if (tr.oculta) nova.oculta = true;
        if (tr.oculta && sub.tipo === 'audio') nova.muda = true;
        if (sub.tipo === 'audio') audios.push(nova);
        else trilhas.push(nova);
      }
    }
  }
  return { ...t, trilhas: [...trilhas, ...audios] };
}

// Solo (S no cabeçalho da faixa de áudio, como no Premiere): com alguma faixa de áudio em solo, as outras ficam mudas.
export function aplicarSolo(t) {
  if (!t?.trilhas?.some((tr) => tr.tipo === 'audio' && tr.solo)) return t;
  return { ...t, trilhas: t.trilhas.map((tr) => (tr.tipo === 'audio' && !tr.solo ? { ...tr, muda: true } : tr)) };
}
