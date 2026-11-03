import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Converte timeline.json <-> OpenTimelineIO no formato que o Filmcraft lê e escreve.
// timeline.json continua sendo a fonte da verdade. O que só existe no Filmcraft fica em item.filmcraft
// e volta igual na próxima ida; o que só existe no app (texto, legenda, bloco) vai como vídeo renderizado.

export const TICKS = 254016000000;
const NOME_CAMADA = 'Camada Remotion';
const NOME_AUDIO_VIDEOS = 'Áudio dos vídeos';
// Valores padrão, lidos do próprio Filmcraft. Parâmetro ausente não assume o padrão lá: a imagem sai clara demais.
const LUMETRI_PADRAO = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./lumetri-padrao.json', import.meta.url)), 'utf8'));
const VINHETA_PADRAO = { midpoint: { value: { Float: 50 } }, roundness: { value: { Float: 0 } }, feather: { value: { Float: 50 } }, color: { value: { Color: [0, 0, 0, 1] } } };
const ID_NO_NOME = /\s*⟦([^⟧]+)⟧$/;

const INTERP = { linear: 'Linear', hold: 'Hold', bezier: 'Bezier', easeIn: 'EaseIn', easeOut: 'EaseOut' };
const CURVA = { Linear: 'linear', Hold: 'hold', Bezier: 'bezier', AutoBezier: 'bezier', ContinuousBezier: 'bezier', EaseIn: 'easeIn', EaseOut: 'easeOut' };

// Índices de BLEND_MODES no Filmcraft. Os que o CSS não tem ficam só em item.filmcraft.
const BLEND = { normal: 0, darken: 2, multiply: 3, 'color-burn': 4, lighten: 7, screen: 8, 'color-dodge': 9, overlay: 12, 'soft-light': 13, 'hard-light': 14, difference: 19, exclusion: 20, hue: 23, saturation: 24, color: 25, luminosity: 26 };
const BLEND_NOME = Object.fromEntries(Object.entries(BLEND).map(([k, v]) => [v, k]));

const redondo = (x, casas = 3) => Math.round(x * 10 ** casas) / 10 ** casas;
const temFonte = (i) => i.tipo === 'video' || i.tipo === 'audio';
const lerCaminho = (o, c) => c.split('.').reduce((x, k) => x?.[k], o);

function valorEm(kfs, t) {
  const k = [...kfs].sort((a, b) => a.t - b.t);
  if (t <= k[0].t) return k[0].v;
  if (t >= k.at(-1).t) return k.at(-1).v;
  const i = k.findIndex((x) => x.t > t);
  const [a, b] = [k[i - 1], k[i]];
  if (a.curva === 'hold') return a.v;
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

// ---------- animações do app viram keyframes na ida ----------

function keyframesComAnimacoes(item) {
  const kf = { ...item.keyframes };
  const d = item.duracao;
  const adicionar = (param, pontos) => {
    if (kf[param]?.length) return;
    kf[param] = pontos.map(([t, v]) => ({ t, v, curva: 'linear' }));
  };
  const base = (c, p) => lerCaminho(item, c) ?? p;
  if (item.zoom) adicionar('escala', [[0, base('escala', 1) * (item.zoom.de ?? 1)], [d, base('escala', 1) * (item.zoom.para ?? 1)]]);
  const anim = (a, entrando) => {
    if (!a?.tipo) return;
    const dur = Math.min(a.duracao ?? 0.3, d);
    const trecho = (longe, perto) => (entrando ? [[0, longe], [dur, perto]] : [[d - dur, perto], [d, longe]]);
    const op = base('opacidade', 1);
    if (['fade', 'slide-cima', 'slide-baixo', 'slide-esq', 'slide-dir', 'zoom'].includes(a.tipo)) adicionar('opacidade', trecho(0, op));
    if (a.tipo === 'slide-cima') adicionar('y', trecho(base('y', 0) + 200, base('y', 0)));
    if (a.tipo === 'slide-baixo') adicionar('y', trecho(base('y', 0) - 200, base('y', 0)));
    if (a.tipo === 'slide-esq') adicionar('x', trecho(base('x', 0) + 200, base('x', 0)));
    if (a.tipo === 'slide-dir') adicionar('x', trecho(base('x', 0) - 200, base('x', 0)));
    if (a.tipo === 'zoom') adicionar('escala', trecho(base('escala', 1) * 1.25, base('escala', 1)));
    if (a.tipo === 'pop') adicionar('escala', trecho(0, base('escala', 1)));
  };
  anim(item.entrada, true);
  anim(item.saida, false);
  return kf;
}

// ---------- efeitos: app -> Filmcraft ----------

const tempoMidia = (item, t) => (temFonte(item) ? (item.corteInicio ?? 0) + t * (item.velocidade ?? 1) : t);

function kfFilmcraft(item, kf, valor) {
  return { time: Math.round(tempoMidia(item, kf.t) * TICKS), value: valor, interp: INTERP[kf.curva ?? 'linear'] ?? 'Linear', in_influence: 1 / 3, out_influence: 1 / 3 };
}

function paramFloat(item, kfs, valorFixo, conv = (x) => x) {
  const value = { Float: redondo(conv(kfs?.length ? [...kfs].sort((a, b) => a.t - b.t)[0].v : valorFixo)) };
  if (!kfs?.length) return { value };
  return { value, keyframes: [...kfs].sort((a, b) => a.t - b.t).map((k) => kfFilmcraft(item, k, { Float: redondo(conv(k.v)) })) };
}

// Tamanho do arquivo no quadro quando a escala é 1. No Filmcraft 100% é o tamanho original do arquivo.
function escalaBase(item, t, materiais) {
  const m = materiais.find((x) => x.arquivo === item.arquivo);
  if (!m?.largura || !m?.altura) return 1;
  if (item.tipo === 'imagem' && item.largura) return item.largura / m.largura;
  const padrao = item.tipo === 'imagem' ? 'contain' : 'cover';
  const fn = (item.ajuste ?? padrao) === 'contain' ? Math.min : Math.max;
  return fn(t.largura / m.largura, t.altura / m.altura);
}

function motionDe(item, t, materiais) {
  const kf = keyframesComAnimacoes(item);
  const base = escalaBase(item, t, materiais);
  const xs = kf.x ?? [];
  const ys = kf.y ?? [];
  const x0 = t.largura / 2 + (item.x ?? 0);
  const y0 = t.altura / 2 + (item.y ?? 0);
  const position = { value: { Vec2: { x: redondo(x0), y: redondo(y0) } } };
  if (xs.length || ys.length) {
    const tempos = [...new Set([...xs, ...ys].map((k) => k.t))].sort((a, b) => a - b);
    position.keyframes = tempos.map((tk) => {
      const curva = [...xs, ...ys].find((k) => k.t === tk)?.curva;
      return kfFilmcraft(item, { t: tk, curva }, { Vec2: {
        x: redondo(t.largura / 2 + (xs.length ? valorEm(xs, tk) : item.x ?? 0)),
        y: redondo(t.altura / 2 + (ys.length ? valorEm(ys, tk) : item.y ?? 0)),
      } });
    });
    position.value = position.keyframes[0].value;
  }
  return {
    position,
    scale: paramFloat(item, kf.escala, item.escala ?? 1, (v) => v * base * 100),
    rotation: paramFloat(item, kf.rotacao, item.rotacao ?? 0),
  };
}

function opacityDe(item) {
  const kf = keyframesComAnimacoes(item);
  const blend = item.filmcraft?.blend ?? BLEND[item.mesclagem ?? 'normal'] ?? 0;
  return { opacity: paramFloat(item, kf.opacidade, item.opacidade ?? 1, (v) => v * 100), blend: { value: { Choice: blend } } };
}

const fx = (effect, params) => ({ effect, enabled: true, params });

function efeitosExtras(item) {
  const e = item.efeitos ?? {};
  const kf = item.keyframes ?? {};
  const num = (c, p) => paramFloat(item, kf['efeitos.' + c], lerCaminho(e, c) ?? p);
  const lista = [];
  if (e.cor || item.filmcraft?.lumetri) {
    lista.push(fx('lumetri', {
      ...LUMETRI_PADRAO,
      ...item.filmcraft?.lumetri,
      ...(e.cor ? { exposure: num('cor.exposicao', 0), contrast: num('cor.contraste', 0), saturation: num('cor.saturacao', 100), temperature: num('cor.temperatura', 0), tint: num('cor.matiz', 0) } : {}),
    }));
  }
  if (e.desfoque) lista.push(fx('gaussian_blur', { blurriness: num('desfoque.raio', 0) }));
  if (e.corte) lista.push(fx('crop', { left: num('corte.esquerda', 0), top: num('corte.cima', 0), right: num('corte.direita', 0), bottom: num('corte.baixo', 0) }));
  if (e.vinheta) lista.push(fx('vignette', { ...VINHETA_PADRAO, amount: num('vinheta.quantidade', -50) }));
  if (e.pb) lista.push(fx('black_white', {}));
  if (e.inverter) lista.push(fx('invert', {}));
  if (e.espelhoH) lista.push(fx('horizontal_flip', {}));
  if (e.espelhoV) lista.push(fx('vertical_flip', {}));
  return lista;
}

function efeitosDoClipe(item, t, materiais) {
  return [
    fx('motion', motionDe(item, t, materiais)),
    fx('opacity', opacityDe(item)),
    ...efeitosExtras(item),
    ...(item.filmcraft?.efeitos ?? []),
  ];
}

// Assinatura para saber, na volta, se o usuário mexeu nesse grupo de parâmetros no Filmcraft.
function assinaturaParam(p) {
  if (!p) return null;
  const valor = (v) => {
    if (!v) return null;
    if (v.Vec2) return [redondo(v.Vec2.x, 1), redondo(v.Vec2.y, 1)];
    if ('Float' in v) return redondo(v.Float, 2);
    if ('Choice' in v) return v.Choice;
    return JSON.stringify(v);
  };
  if (p.keyframes?.length) {
    return p.keyframes.map((k) => [Math.round((k.time / TICKS) * 100), valor(k.value), k.interp]);
  }
  return valor(p.value);
}
const assinatura = (params, nomes) => JSON.stringify(nomes.map((n) => assinaturaParam(params?.[n])));

// ---------- ida: timeline -> OTIO ----------

const rt = (seg, fps) => ({ OTIO_SCHEMA: 'RationalTime.1', rate: fps, value: redondo(seg * fps, 3) });
const tr = (ini, dur, fps) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rt(ini, fps), duration: rt(dur, fps) });

function referencia(arquivo, assets) {
  const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(assets, arquivo);
  return {
    OTIO_SCHEMA: 'ExternalReference.1',
    name: path.basename(arquivo),
    target_url: pathToFileURL(caminho).href,
    available_image_bounds: null,
    available_range: null,
    metadata: {},
  };
}

function clipe(nome, ini, dur, arquivo, assets, fps, meta, velocidade) {
  const r = referencia(arquivo, assets);
  return {
    OTIO_SCHEMA: 'Clip.2',
    name: nome,
    source_range: tr(ini, dur, fps),
    effects: velocidade && velocidade !== 1 ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', name: '', effect_name: 'LinearTimeWarp', time_scalar: velocidade, metadata: {} }] : [],
    markers: [],
    enabled: true,
    active_media_reference_key: 'DEFAULT_MEDIA',
    media_references: { DEFAULT_MEDIA: r },
    metadata: { filmcraft: meta },
  };
}

const lacuna = (dur, fps) => ({ OTIO_SCHEMA: 'Gap.1', name: '', source_range: tr(0, dur, fps), effects: [], markers: [], enabled: true, metadata: {} });

function trilhaOtio(nome, kind, filhos, { habilitada = true, muda = false, travada = false } = {}) {
  return {
    OTIO_SCHEMA: 'Track.1', name: nome, kind, children: filhos, source_range: null, effects: [], markers: [], enabled: habilitada,
    metadata: { filmcraft: { muted: muda, locked: travada, sync_lock: true, solo: false, volume_db: 0, pan: 0 } },
  };
}

// Uma trilha do app aceita itens sobrepostos; no OTIO cada um vai numa faixa própria.
function emFaixas(itens) {
  const faixas = [];
  for (const i of [...itens].sort((a, b) => a.inicio - b.inicio)) {
    let f = faixas.find((x) => x.at(-1).inicio + x.at(-1).duracao <= i.inicio + 0.001);
    if (!f) faixas.push((f = []));
    f.push(i);
  }
  return faixas.length ? faixas : [[]];
}

function folgas(x) {
  if (x.alinhamento === 'inicio') return [0, x.duracao];
  if (x.alinhamento === 'fim') return [x.duracao, 0];
  return [x.duracao / 2, x.duracao / 2];
}

function transicaoOtio(x, fps) {
  const [antes, depois] = folgas(x);
  const raw = x.filmcraft?.effect?.effect === x.tipo ? x.filmcraft.effect : { effect: x.tipo, enabled: true, params: {} };
  return {
    OTIO_SCHEMA: 'Transition.1',
    name: x.tipo,
    transition_type: x.tipo === 'cross_dissolve' ? 'SMPTE_Dissolve' : 'Custom_Transition',
    in_offset: rt(antes, fps),
    out_offset: rt(depois, fps),
    metadata: { filmcraft: { effect: raw, align: { centro: 'CenterAtCut', inicio: 'StartAtCut', fim: 'EndAtCut' }[x.alinhamento ?? 'centro'], reverse: x.filmcraft?.reverse ?? false } },
  };
}

function fadeOtio(dur, entrando, fps) {
  return {
    OTIO_SCHEMA: 'Transition.1', name: 'constant_power', transition_type: 'SMPTE_Dissolve',
    in_offset: rt(entrando ? 0 : dur, fps), out_offset: rt(entrando ? dur : 0, fps),
    metadata: { filmcraft: { effect: { effect: 'constant_power', enabled: true, params: {} }, align: entrando ? 'StartAtCut' : 'EndAtCut', reverse: false } },
  };
}

const metaClipe = (efeitos, ganho) => ({ effects: efeitos, gain_db: ganho, scale_to_frame: false, custom_label_color: null, group: null, link: null });
const ganhoDb = (v) => (v > 0 ? redondo(20 * Math.log10(v), 2) : -96);

function filhosDaFaixa(faixa, transicoes, t, materiais, assets, avisos) {
  const fps = t.fps;
  const filhos = [];
  let pos = 0;
  for (const i of faixa) {
    if (i.inicio > pos + 0.0005) filhos.push(lacuna(i.inicio - pos, fps));
    const colado = Math.abs(i.inicio - pos) <= 0.0005 && pos > 0;
    for (const x of transicoes.filter((y) => y.para === i.id)) filhos.push(transicaoOtio(x, fps));
    if (i.tipo === 'audio' && i.fadeIn) {
      if (colado) avisos.push(`O fade de entrada de ${i.arquivo} encosta em outro áudio e não foi para o Filmcraft.`);
      else filhos.push(fadeOtio(i.fadeIn, true, fps));
    }
    const vel = i.velocidade ?? 1;
    const ini = temFonte(i) ? i.corteInicio ?? 0 : 0;
    const efeitos = i.tipo === 'audio' ? i.filmcraft?.efeitos ?? [] : efeitosDoClipe(i, t, materiais);
    const nome = `${path.basename(i.arquivo)} ⟦${i.id}⟧`;
    filhos.push(clipe(nome, ini, i.duracao, i.arquivo, assets, fps, metaClipe(efeitos, i.tipo === 'audio' ? ganhoDb(i.volume ?? 1) : 0), vel));
    pos = i.inicio + i.duracao;
    const prox = faixa[faixa.indexOf(i) + 1];
    const encosta = prox && Math.abs(prox.inicio - pos) <= 0.0005;
    for (const x of transicoes.filter((y) => y.de === i.id && !y.para)) filhos.push(transicaoOtio(x, fps));
    if (i.tipo === 'audio' && i.fadeOut) {
      if (encosta) avisos.push(`O fade de saída de ${i.arquivo} encosta em outro áudio e não foi para o Filmcraft.`);
      else filhos.push(fadeOtio(i.fadeOut, false, fps));
    }
  }
  return filhos;
}

function configuracao(t) {
  return {
    audio_master: 'Stereo', color: { auto_tone_map: false, wide_gamut: false, working: 'Rec709' }, drop_frame: false,
    frame_rate: { den: 1, num: t.fps }, height: t.altura, max_bit_depth: false, max_render_quality: false, par: [1, 1],
    preset: `${t.largura}x${t.altura} ${t.fps}`, preview_codec: 'ProRes 422', sample_rate: 48000, width: t.largura, working_space: 'Rec. 709',
  };
}

// camada: vídeo transparente com texto, legendas e blocos, já renderizado pelo Remotion.
export function paraOtio(t, projeto, { assets, camada } = {}) {
  const fps = t.fps;
  const materiais = [...(projeto.materiais ?? []), ...(projeto.narracao ? [{ ...projeto.narracao, tipo: 'audio' }] : [])];
  const avisos = [];
  const videos = [];
  const audios = [];
  const comAudio = [];
  for (const trilha of t.trilhas) {
    if (trilha.tipo === 'legenda') continue;
    const audio = trilha.tipo === 'audio';
    const itens = trilha.itens.filter((i) => i.arquivo);
    if (!audio) comAudio.push(...itens.filter((i) => i.tipo === 'video' && (i.volume ?? 0) > 0));
    emFaixas(itens).forEach((faixa, n) => {
      const nome = (trilha.nome ?? trilha.id) + (n ? ` · ${n + 1}` : '');
      const filhos = filhosDaFaixa(faixa, trilha.transicoes ?? [], t, materiais, assets, avisos);
      (audio ? audios : videos).push(trilhaOtio(nome, audio ? 'Audio' : 'Video', filhos, audio ? { muda: !!trilha.muda } : { habilitada: !trilha.oculta }));
    });
  }
  // No app o som do vídeo é um campo do item; no Filmcraft é um clipe de áudio.
  if (comAudio.length) {
    emFaixas(comAudio).forEach((faixa, n) => {
      const filhos = [];
      let pos = 0;
      for (const i of faixa) {
        if (i.inicio > pos + 0.0005) filhos.push(lacuna(i.inicio - pos, fps));
        filhos.push(clipe(`${path.basename(i.arquivo)} ⟦${i.id}⟧`, i.corteInicio ?? 0, i.duracao, i.arquivo, assets, fps, metaClipe([], ganhoDb(i.volume)), i.velocidade ?? 1));
        pos = i.inicio + i.duracao;
      }
      audios.push(trilhaOtio(NOME_AUDIO_VIDEOS + (n ? ` · ${n + 1}` : ''), 'Audio', filhos));
    });
  }
  if (camada) {
    const c = clipe(`${NOME_CAMADA} ⟦camada⟧`, 0, camada.duracao, camada.arquivo, assets, fps, metaClipe([fx('motion', {
      position: { value: { Vec2: { x: t.largura / 2, y: t.altura / 2 } } }, scale: { value: { Float: 100 } },
    }), fx('opacity', { opacity: { value: { Float: 100 } }, blend: { value: { Choice: 0 } } })], 0));
    videos.push(trilhaOtio(NOME_CAMADA, 'Video', [c], { travada: true }));
  }
  return {
    otio: {
      OTIO_SCHEMA: 'Timeline.1',
      name: projeto.nome ?? 'Claude Video Studio',
      global_start_time: null,
      metadata: { filmcraft: { settings: configuracao(t), start_timecode: 0, master_volume_db: 0, master_effects: [] } },
      tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: [...videos, ...audios], effects: [], markers: [], enabled: true, source_range: null, metadata: {} },
    },
    avisos,
  };
}

// ---------- volta: OTIO -> timeline ----------

function segundos(r) {
  return r ? r.value / r.rate : 0;
}

function kfDoFilmcraft(k, conv, item) {
  const media = k.time / TICKS;
  const t = temFonte(item) ? (media - (item.corteInicio ?? 0)) / (item.velocidade ?? 1) : media;
  return { t: redondo(Math.max(0, t)), v: redondo(conv(k.value)), curva: CURVA[k.interp] ?? 'linear' };
}

function lerFloat(item, param, conv = (x) => x) {
  const fl = (v) => conv(v?.Float ?? 0);
  if (param?.keyframes?.length) return { kfs: param.keyframes.map((k) => kfDoFilmcraft(k, fl, item)) };
  return { valor: redondo(fl(param?.value)) };
}

function aplicar(item, caminho, lido, padrao) {
  item.keyframes ??= {};
  if (lido.kfs) {
    item.keyframes[caminho] = lido.kfs;
    return;
  }
  delete item.keyframes[caminho];
  const partes = caminho.split('.');
  const ultimo = partes.pop();
  let o = item;
  for (const k of partes) o = o[k] ??= {};
  if (lido.valor === padrao) delete o[ultimo];
  else o[ultimo] = lido.valor;
}

function aplicarMotion(item, params, t, materiais) {
  const base = escalaBase(item, t, materiais);
  const pos = params.position;
  if (pos?.keyframes?.length) {
    item.keyframes ??= {};
    item.keyframes.x = pos.keyframes.map((k) => kfDoFilmcraft(k, (v) => v.Vec2.x - t.largura / 2, item));
    item.keyframes.y = pos.keyframes.map((k) => kfDoFilmcraft(k, (v) => v.Vec2.y - t.altura / 2, item));
    delete item.x;
    delete item.y;
  } else {
    if (item.keyframes) {
      delete item.keyframes.x;
      delete item.keyframes.y;
    }
    item.x = redondo((pos?.value?.Vec2?.x ?? t.largura / 2) - t.largura / 2);
    item.y = redondo((pos?.value?.Vec2?.y ?? t.altura / 2) - t.altura / 2);
  }
  aplicar(item, 'escala', lerFloat(item, params.scale, (v) => v / 100 / base), 1);
  aplicar(item, 'rotacao', lerFloat(item, params.rotation), 0);
  delete item.zoom;
  delete item.entrada;
  delete item.saida;
}

const MAPA_EFEITOS = {
  lumetri: { chave: 'cor', campos: { exposure: ['exposicao', 0], contrast: ['contraste', 0], saturation: ['saturacao', 100], temperature: ['temperatura', 0], tint: ['matiz', 0] } },
  gaussian_blur: { chave: 'desfoque', campos: { blurriness: ['raio', 0] } },
  crop: { chave: 'corte', campos: { left: ['esquerda', 0], top: ['cima', 0], right: ['direita', 0], bottom: ['baixo', 0] } },
  vignette: { chave: 'vinheta', campos: { amount: ['quantidade', -50] } },
};
const MAPA_LIGADOS = { black_white: 'pb', invert: 'inverter', horizontal_flip: 'espelhoH', vertical_flip: 'espelhoV' };

// Lumetri além do básico (curvas, LUTs, looks) não tem como desenhar aqui: segue guardado para o Filmcraft.
function lumetriExtra(params) {
  const extra = {};
  const conhecidos = Object.keys(MAPA_EFEITOS.lumetri.campos);
  for (const [k, v] of Object.entries(params)) {
    if (conhecidos.includes(k)) continue;
    if (JSON.stringify(v) !== JSON.stringify(LUMETRI_PADRAO[k])) extra[k] = v;
  }
  return extra;
}

function aplicarEfeitos(item, efeitos, avisos) {
  const novos = {};
  const crus = [];
  const kfAntigos = Object.keys(item.keyframes ?? {}).filter((k) => k.startsWith('efeitos.'));
  for (const k of kfAntigos) delete item.keyframes[k];
  item.filmcraft && delete item.filmcraft.lumetri;
  for (const e of efeitos) {
    if (['motion', 'opacity', 'time_remap'].includes(e.effect)) continue;
    if (e.enabled === false) {
      crus.push(e);
      continue;
    }
    if (MAPA_LIGADOS[e.effect]) {
      novos[MAPA_LIGADOS[e.effect]] = true;
      continue;
    }
    const mapa = MAPA_EFEITOS[e.effect];
    if (!mapa) {
      crus.push(e);
      continue;
    }
    novos[mapa.chave] = {};
    for (const [fc, [campo, padrao]] of Object.entries(mapa.campos)) {
      const lido = lerFloat(item, e.params?.[fc]);
      if (lido.kfs) (item.keyframes ??= {})[`efeitos.${mapa.chave}.${campo}`] = lido.kfs;
      else novos[mapa.chave][campo] = lido.valor ?? padrao;
    }
    if (e.effect === 'lumetri') {
      const extra = lumetriExtra(e.params ?? {});
      if (Object.keys(extra).length) {
        (item.filmcraft ??= {}).lumetri = extra;
        avisos.push(`${item.arquivo}: curvas, LUT ou look do Lumetri valem só no Filmcraft; a prévia usa exposição, contraste, saturação, temperatura e matiz.`);
      }
    }
  }
  if (Object.keys(novos).length) item.efeitos = novos;
  else delete item.efeitos;
  if (crus.length) {
    (item.filmcraft ??= {}).efeitos = crus;
    const nomes = crus.filter((e) => e.enabled !== false).map((e) => e.effect);
    if (nomes.length) avisos.push(`${item.arquivo}: ${nomes.join(', ')} só aparece no Filmcraft; a prévia e o render do app não desenham.`);
  } else if (item.filmcraft) {
    delete item.filmcraft.efeitos;
  }
  if (item.filmcraft && !Object.keys(item.filmcraft).length) delete item.filmcraft;
  if (item.keyframes && !Object.keys(item.keyframes).length) delete item.keyframes;
}

// O Filmcraft escreve caminhos relativos à pasta do OTIO quando pode.
function arquivoDoClipe(c, base, mapaArquivos) {
  const ref = c.media_references?.[c.active_media_reference_key ?? 'DEFAULT_MEDIA'] ?? c.media_reference;
  const url = ref?.target_url;
  if (!url) return null;
  let caminho;
  try {
    caminho = url.startsWith('file:') ? fileURLToPath(url) : path.resolve(base, decodeURIComponent(url));
  } catch {
    return null;
  }
  return { caminho, arquivo: mapaArquivos?.[caminho] ?? path.basename(caminho) };
}

// Arquivos usados no OTIO que ainda não estão em assets/: o usuário os importou no Filmcraft.
export function arquivosDeFora(otio, assets, base) {
  const fora = new Set();
  for (const tr of otio.tracks.children) {
    if (tr.name === NOME_CAMADA) continue;
    for (const c of tr.children) {
      if (!c.OTIO_SCHEMA.startsWith('Clip')) continue;
      const a = arquivoDoClipe(c, base);
      if (a && path.resolve(path.dirname(a.caminho)) !== path.resolve(assets)) fora.add(a.caminho);
    }
  }
  return [...fora];
}

const TIPOS_IMAGEM = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

// novoId vem de fora para este arquivo não depender do resto do app.
export function deOtio(otio, original, projeto, { novoId, mapaArquivos, base: pastaOtio } = {}) {
  const t = JSON.parse(JSON.stringify(original));
  const avisos = [];
  const materiais = [...(projeto.materiais ?? []), ...(projeto.narracao ? [{ ...projeto.narracao, tipo: 'audio' }] : [])];
  const antigos = new Map(t.trilhas.flatMap((tr) => tr.itens).map((i) => [i.id, i]));
  const usados = new Set();
  const porTrilha = new Map();
  const volumes = new Map();
  const ordemNova = [];

  const trilhaPara = (nome, audio) => {
    const limpo = nome.replace(/ · \d+$/, '');
    let tr = t.trilhas.find((x) => (x.nome ?? x.id) === limpo && (x.tipo === 'audio') === audio && x.tipo !== 'legenda');
    if (!tr) {
      tr = { id: novoId('t'), tipo: audio ? 'audio' : 'sobreposicao', nome: limpo, itens: [] };
      ordemNova.push(tr);
    }
    return tr;
  };

  for (const tro of otio.tracks.children) {
    if (tro.OTIO_SCHEMA?.startsWith('Track') !== true) continue;
    if (tro.name === NOME_CAMADA) continue;
    const audio = tro.kind === 'Audio';
    const ehAudioDosVideos = tro.name.replace(/ · \d+$/, '') === NOME_AUDIO_VIDEOS;
    const fps = t.fps;
    let pos = 0;
    let anterior = null;
    const transPendentes = [];
    const tr = ehAudioDosVideos ? null : trilhaPara(tro.name, audio);
    const lista = tr ? (porTrilha.get(tr) ?? { itens: [], transicoes: [] }) : null;
    if (tr) {
      porTrilha.set(tr, lista);
      if (audio) {
        if (tro.metadata?.filmcraft?.muted) tr.muda = true;
        else delete tr.muda;
      } else if (tro.enabled === false) tr.oculta = true;
      else delete tr.oculta;
    }
    for (const c of tro.children) {
      const esquema = c.OTIO_SCHEMA ?? '';
      if (esquema.startsWith('Gap')) {
        pos += segundos(c.source_range?.duration);
        anterior = null;
        continue;
      }
      if (esquema.startsWith('Transition')) {
        transPendentes.push({ c, anterior });
        continue;
      }
      if (!esquema.startsWith('Clip')) {
        avisos.push(`Trilha ${tro.name}: "${c.name}" é uma sequência aninhada e não voltou para o app.`);
        pos += segundos(c.source_range?.duration);
        anterior = null;
        continue;
      }
      const meta = c.metadata?.filmcraft ?? {};
      const dur = meta.duration_ticks ? meta.duration_ticks / TICKS : segundos(c.source_range?.duration);
      const inicioFonte = meta.source_in_ticks != null ? meta.source_in_ticks / TICKS : segundos(c.source_range?.start_time);
      const id = c.name?.match(ID_NO_NOME)?.[1];
      if (ehAudioDosVideos) {
        if (id && meta.gain_db != null) volumes.set(id, redondo(Math.min(1, 10 ** (meta.gain_db / 20)), 3));
        pos += dur;
        continue;
      }
      const dadosArquivo = arquivoDoClipe(c, pastaOtio, mapaArquivos);
      if (!dadosArquivo) {
        avisos.push(`Trilha ${tro.name}: "${c.name}" não aponta para um arquivo e ficou de fora.`);
        pos += dur;
        anterior = null;
        continue;
      }
      const velEfeito = c.effects?.find((e) => e.OTIO_SCHEMA?.startsWith('LinearTimeWarp'))?.time_scalar;
      const base = id ? antigos.get(id) : null;
      const repetido = id && usados.has(id);
      // Clipe dividido no Filmcraft: o segundo pedaço herda os campos do item e ganha id novo.
      const item = base ? JSON.parse(JSON.stringify(base)) : {
        tipo: audio ? 'audio' : TIPOS_IMAGEM.test(dadosArquivo.arquivo) ? 'imagem' : 'video',
        arquivo: dadosArquivo.arquivo,
        ajuste: audio ? undefined : 'cover',
      };
      item.id = base && !repetido ? id : novoId('f');
      if (id) usados.add(id);
      item.inicio = redondo(pos);
      item.duracao = redondo(dur);
      item.arquivo = dadosArquivo.arquivo;
      if (temFonte(item)) item.corteInicio = redondo(inicioFonte);
      if (velEfeito) item.velocidade = Math.abs(velEfeito);
      else delete item.velocidade;
      if (velEfeito < 0) avisos.push(`${item.arquivo}: velocidade invertida não existe no app e toca para a frente.`);

      if (item.tipo === 'audio') {
        item.volume = meta.gain_db != null ? redondo(Math.min(1, 10 ** (meta.gain_db / 20)), 3) : item.volume ?? 1;
        const crus = (meta.effects ?? []).filter((e) => !['volume', 'channel_volume', 'panner'].includes(e.effect));
        if (crus.length) (item.filmcraft ??= {}).efeitos = crus;
        else if (item.filmcraft) delete item.filmcraft.efeitos;
        if (item.filmcraft && !Object.keys(item.filmcraft).length) delete item.filmcraft;
      } else {
        const efeitos = meta.effects ?? [];
        const motion = efeitos.find((e) => e.effect === 'motion')?.params ?? {};
        const opacity = efeitos.find((e) => e.effect === 'opacity')?.params ?? {};
        // Compara com o que o item mandaria, ajustado ao novo corte: sem mudança, zoom e animações do app ficam.
        const ref = base ? { ...base, corteInicio: temFonte(base) ? base.corteInicio : undefined } : null;
        const motionMudou = !ref || assinatura(motionDe(ref, t, materiais), ['position', 'scale', 'rotation']) !== assinatura(motion, ['position', 'scale', 'rotation']);
        const opacMudou = !ref || assinatura(opacityDe(ref), ['opacity', 'blend']) !== assinatura(opacity, ['opacity', 'blend']);
        if (motionMudou) aplicarMotion(item, motion, t, materiais);
        if (opacMudou) {
          aplicar(item, 'opacidade', lerFloat(item, opacity.opacity, (v) => v / 100), 1);
          const b = opacity.blend?.value?.Choice ?? 0;
          if (BLEND_NOME[b]) {
            if (b) item.mesclagem = BLEND_NOME[b];
            else delete item.mesclagem;
            if (item.filmcraft) delete item.filmcraft.blend;
          } else {
            (item.filmcraft ??= {}).blend = b;
            delete item.mesclagem;
            avisos.push(`${item.arquivo}: este modo de mesclagem só existe no Filmcraft; a prévia usa o normal.`);
          }
        }
        const fxExtras = (e) => JSON.stringify(e.filter((x) => !['motion', 'opacity', 'time_remap'].includes(x.effect)).map((x) => [x.effect, x.enabled !== false]));
        // Efeitos sempre vêm do Filmcraft, a não ser quando continuam iguais aos do item.
        const iguais = base && fxExtras(efeitos) === fxExtras([...efeitosExtras(base), ...(base.filmcraft?.efeitos ?? [])])
          && JSON.stringify(efeitos.filter((x) => MAPA_EFEITOS[x.effect]).map((x) => Object.keys(MAPA_EFEITOS[x.effect].campos).map((k) => assinaturaParam(x.params?.[k]))))
            === JSON.stringify(efeitosExtras(base).filter((x) => MAPA_EFEITOS[x.effect]).map((x) => Object.keys(MAPA_EFEITOS[x.effect].campos).map((k) => assinaturaParam(x.params?.[k]))));
        if (!iguais) aplicarEfeitos(item, efeitos, avisos);
        if (item.keyframes && !Object.keys(item.keyframes).length) delete item.keyframes;
      }
      lista.itens.push(item);
      for (const p of transPendentes.splice(0)) {
        p.para = item;
        lista.transicoes.push(p);
      }
      anterior = item;
      pos += dur;
    }
    for (const p of transPendentes.splice(0)) lista?.transicoes.push(p);
  }

  for (const tr of t.trilhas.concat(ordemNova)) {
    if (tr.tipo === 'legenda') continue;
    const r = porTrilha.get(tr);
    const fixos = tr.itens.filter((i) => !i.arquivo);
    const comArquivo = r?.itens ?? [];
    tr.itens = [...comArquivo, ...fixos];
    const audio = tr.tipo === 'audio';
    if (audio) {
      for (const p of r?.transicoes ?? []) {
        const inn = segundos(p.c.in_offset);
        const out = segundos(p.c.out_offset);
        if (p.para && !p.anterior) p.para.fadeIn = redondo(inn + out);
        else if (p.anterior && !p.para) p.anterior.fadeOut = redondo(inn + out);
        else if (p.anterior && p.para) {
          p.anterior.fadeOut = redondo(inn + out);
          p.para.fadeIn = redondo(inn + out);
        }
      }
      delete tr.transicoes;
      continue;
    }
    const antigas = tr.transicoes ?? [];
    const novas = (r?.transicoes ?? []).map((p) => {
      const m = p.c.metadata?.filmcraft ?? {};
      const inn = segundos(p.c.in_offset);
      const out = segundos(p.c.out_offset);
      const tipo = m.effect?.effect ?? (p.c.transition_type === 'SMPTE_Dissolve' ? 'cross_dissolve' : p.c.name);
      const x = {
        id: antigas.find((a) => a.de === p.anterior?.id && a.para === p.para?.id)?.id ?? novoId('x'),
        tipo,
        duracao: redondo(inn + out),
        alinhamento: { CenterAtCut: 'centro', StartAtCut: 'inicio', EndAtCut: 'fim' }[m.align] ?? 'centro',
        ...(p.anterior ? { de: p.anterior.id } : {}),
        ...(p.para ? { para: p.para.id } : {}),
      };
      if (m.effect && Object.keys(m.effect.params ?? {}).length) x.filmcraft = { effect: m.effect, reverse: m.reverse };
      else if (m.reverse) x.filmcraft = { reverse: true };
      const anterior = antigas.find((a) => a.id === x.id);
      if (anterior?.direcao) x.direcao = anterior.direcao;
      return x;
    });
    if (novas.length) tr.transicoes = novas;
    else delete tr.transicoes;
  }

  // Trilhas novas entram por cima dos vídeos e antes do áudio.
  for (const tr of ordemNova) {
    const pos = tr.tipo === 'audio' ? t.trilhas.length : t.trilhas.findIndex((x) => x.tipo === 'audio');
    t.trilhas.splice(pos < 0 ? t.trilhas.length : pos, 0, tr);
  }
  // Volume dos vídeos, que no Filmcraft é clipe de áudio.
  for (const tr of t.trilhas) {
    for (const i of tr.itens) if (i.tipo === 'video' && volumes.has(i.id)) i.volume = volumes.get(i.id);
  }
  const removidos = [...antigos.values()].filter((i) => i.arquivo && !t.trilhas.some((tr) => tr.itens.some((x) => x.id === i.id)));
  if (removidos.length) avisos.push(`${removidos.length} clipe(s) apagado(s) no Filmcraft saíram da timeline.`);
  return { timeline: t, avisos };
}
