// Timeline editável e prévia ao vivo dos projetos Remotion. O dado é o timeline.json do projeto,
// o mesmo que o Claude edita e que o render lê.

const TL = (() => {
  const LARGURA_CAB = 120;
  const ALTURA_POR_TIPO = { video: 54, sobreposicao: 34, legenda: 34, audio: 44 };
  const ACEITA = {
    video: ['video', 'imagem'],
    sobreposicao: ['video', 'imagem', 'texto', 'bloco'],
    legenda: ['legenda'],
    audio: ['audio'],
  };
  const FONTES = ['Montserrat', 'Inter', 'Poppins', 'Roboto', 'Anton', 'Bebas Neue', 'Oswald', 'Playfair Display'];
  const ANIMACOES = ['', 'fade', 'slide-cima', 'slide-baixo', 'slide-esq', 'slide-dir', 'zoom', 'pop'];
  const MESCLAGENS = ['', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  const CURVAS = [['linear', 'Linear'], ['bezier', 'Suave'], ['easeOut', 'Sair suave'], ['easeIn', 'Chegar suave'], ['hold', 'Segurar']];
  const TRANSICOES = [['', 'Nenhuma'], ['cross_dissolve', 'Dissolver'], ['dip_to_black', 'Fade pelo preto'], ['dip_to_white', 'Fade pelo branco'], ['flash', 'Flash'], ['push', 'Empurrar'], ['whip', 'Chicote'], ['slide', 'Deslizar'], ['linear_wipe', 'Cortina'], ['iris_round', 'Íris'], ['cross_zoom', 'Zoom']];
  const MARGEM_ENCOSTO = 0.05;
  const FORMATOS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
  const ICONES = { video: '🎬', imagem: '🖼', audio: '🎵' };
  const FERRAMENTAS = { v: 'selecao', b: 'ripple', n: 'roll', y: 'slip', u: 'slide', r: 'taxa', c: 'navalha' };
  const ANIMAVEIS = new Set(['x', 'y', 'escala', 'rotacao', 'opacidade', 'efeitos.cor.exposicao', 'efeitos.cor.contraste', 'efeitos.cor.saturacao', 'efeitos.cor.temperatura', 'efeitos.cor.matiz', 'efeitos.desfoque.raio', 'efeitos.corte.esquerda', 'efeitos.corte.cima', 'efeitos.corte.direita', 'efeitos.corte.baixo', 'efeitos.vinheta.quantidade']);

  const s = {
    id: null,
    t: null,
    previa: null,
    midia: {},
    sel: null,
    pps: 40,
    ima: true,
    ferramenta: 'selecao',
    camposKf: [],
    materiais: [],
    aba: 'materiais',
    desfazer: [],
    refazer: [],
    tempo: 0,
    tocando: false,
    bloqueada: false,
    timerSalvar: null,
    alterandoCampo: false,
  };

  const clonar = (x) => JSON.parse(JSON.stringify(x));
  const qs = (sel) => document.querySelector(sel);
  const ativa = () => !!s.t && !qs('#tl').hidden;
  const fps = () => s.t.fps;
  const arredondar = (x) => Math.round(x * 1000) / 1000;
  const noQuadro = (x) => Math.round(x * fps()) / fps();

  function formatarTempo(seg) {
    const m = Math.floor(seg / 60);
    const r = Math.floor(seg % 60);
    const f = Math.round((seg - Math.floor(seg)) * fps()) % fps();
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
  }

  const todosItens = () => s.t.trilhas.flatMap((tr) => tr.itens);
  const duracaoTotal = () => Math.max(1, ...todosItens().map((i) => i.inicio + i.duracao));
  const itemSel = () => todosItens().find((i) => i.id === s.sel) ?? null;
  const trilhaDe = (id) => s.t.trilhas.find((tr) => tr.itens.some((i) => i.id === id));
  // De cima para baixo na tela: a camada mais alta primeiro, áudio embaixo.
  const ordemNaTela = () => [
    ...s.t.trilhas.filter((tr) => tr.tipo !== 'audio').reverse(),
    ...s.t.trilhas.filter((tr) => tr.tipo === 'audio'),
  ];

  let contadorId = 0;
  const novoId = () => `u${Date.now().toString(36)}${(contadorId++).toString(36)}`;

  // ---------- guardar e desfazer ----------

  function salvarDepois() {
    clearTimeout(s.timerSalvar);
    s.timerSalvar = setTimeout(salvarAgora, 300);
  }

  async function salvarAgora() {
    if (s.timerSalvar == null || !s.t) return;
    clearTimeout(s.timerSalvar);
    s.timerSalvar = null;
    try {
      await api.salvarTimeline({ id: s.id, timeline: s.t });
      avisar('');
    } catch (e) {
      avisar('Não salvou: ' + e.message.split('\n').at(-1));
    }
  }

  function avisar(texto) {
    qs('#tl-aviso').textContent = texto;
  }

  function guardarEstado() {
    s.desfazer.push(JSON.stringify(s.t));
    if (s.desfazer.length > 200) s.desfazer.shift();
    s.refazer = [];
  }

  // Toda edição passa por aqui: guarda o estado anterior, aplica, atualiza a tela e a prévia, grava.
  function alterar(fn) {
    if (s.bloqueada) return;
    guardarEstado();
    fn();
    aposAlterar();
  }

  // Clipes que deixaram de se encostar perdem o vínculo: a transição vira só a entrada de quem restou.
  function soltarTransicoes() {
    for (const tr of s.t.trilhas) {
      if (!tr.transicoes) continue;
      tr.transicoes = tr.transicoes.filter((x) => {
        const a = tr.itens.find((i) => i.id === x.de);
        const b = tr.itens.find((i) => i.id === x.para);
        if (a && b && Math.abs(a.inicio + a.duracao - b.inicio) > MARGEM_ENCOSTO) delete x.de;
        return x.de || x.para;
      });
      if (!tr.transicoes.length) delete tr.transicoes;
    }
  }

  function aposAlterar() {
    soltarTransicoes();
    atualizarPrevia();
    salvarDepois();
    desenhar();
  }

  function trocarEstado(de, para) {
    if (s.bloqueada || !de.length) return;
    para.push(JSON.stringify(s.t));
    s.t = JSON.parse(de.pop());
    if (!itemSel()) s.sel = null;
    aposAlterar();
  }

  // ---------- prévia ----------

  function atualizarPrevia() {
    s.previa?.ref.current?.atualizar(clonar(s.t));
  }

  // Só remonta o player se o código da composição mudou; dados novos entram sem interromper.
  async function montarPrevia() {
    let info;
    try {
      info = await api.previaTimeline(s.id);
    } catch (e) {
      avisar('A prévia não compilou: ' + e.message.split('\n')[0]);
      return;
    }
    if (s.previa && s.versaoPrevia === info.versao) {
      atualizarPrevia();
      return;
    }
    desmontarPrevia();
    s.versaoPrevia = info.versao;
    const host = qs('#previa-host');
    host.innerHTML = '';
    const idAberto = s.id;
    await new Promise((ok, falha) => {
      qs('#previa-script')?.remove();
      const script = document.createElement('script');
      script.id = 'previa-script';
      script.src = urlArquivo(info.arquivo) + '?v=' + info.versao;
      script.onload = ok;
      script.onerror = () => falha(new Error('script da prévia'));
      document.head.append(script);
    });
    if (s.id !== idAberto) return;
    s.proxies = Object.fromEntries(Object.entries(info.proxies).map(([a, c]) => [a, c && urlArquivo(c)]));
    s.pastaAssets = info.assets;
    desenharMateriais();
    const raiz = document.createElement('div');
    raiz.className = 'previa-raiz';
    host.append(raiz);
    s.previa = window.PreviaTimeline.montar(raiz, {
      timeline: clonar(s.t),
      baseAssets: urlArquivo(info.assets) + '/',
      proxies: s.proxies,
      frameInicial: Math.round(s.tempo * fps()),
      aoQuadro: (f) => {
        s.tempo = f / fps();
        desenharCursor();
      },
      aoTocar: (t) => {
        s.tocando = t;
        qs('#tl-tocar').textContent = t ? '❚❚' : '▶';
      },
    });
  }

  function desmontarPrevia() {
    s.previa?.desmontar();
    s.previa = null;
  }

  function irPara(seg) {
    s.tempo = Math.max(0, Math.min(seg, duracaoTotal()));
    verPrevia();
    s.previa?.ref.current?.irPara(Math.round(s.tempo * fps()));
    desenharCursor();
  }

  // O player mostra a prévia ao vivo ou o arquivo renderizado.
  function verPrevia() {
    qs('#previa-host').hidden = false;
    qs('#player').hidden = true;
    qs('#player').pause();
    qs('#player-vazio').hidden = true;
    marcarModoPlayer('previa');
  }

  function verRender() {
    qs('#previa-host').hidden = true;
    qs('#player').hidden = false;
    s.previa?.ref.current?.pausar();
    marcarModoPlayer('render');
  }

  function marcarModoPlayer(modo) {
    qs('#seg-player').querySelectorAll('button').forEach((b) => b.classList.toggle('ativo', b.dataset.v === modo));
  }

  // ---------- desenho ----------

  function desenhar() {
    if (!s.t) return;
    const larguraConteudo = LARGURA_CAB + duracaoTotal() * s.pps + 400;
    const conteudo = qs('#tl-conteudo');
    conteudo.style.width = larguraConteudo + 'px';
    desenharRegua();
    const box = qs('#tl-trilhas');
    box.innerHTML = '';
    for (const trilha of ordemNaTela()) box.append(desenharTrilha(trilha));
    desenharCursor();
    desenharInspetor();
    qs('#tl-desfazer').disabled = !s.desfazer.length || s.bloqueada;
    qs('#tl-refazer').disabled = !s.refazer.length || s.bloqueada;
    qs('#tl-excluir').disabled = !s.sel || s.bloqueada;
    qs('#tl-fc-abrir').disabled = s.bloqueada;
    qs('#tl-fc-trazer').disabled = s.bloqueada;
    qs('#tl').classList.toggle('bloqueada', s.bloqueada);
    qs('#tl-ima').classList.toggle('ativo', s.ima);
    qs('#tl-total').textContent = formatarTempo(duracaoTotal());
    desenharFormato();
  }

  function desenharRegua() {
    const regua = qs('#tl-regua');
    regua.innerHTML = '';
    const passos = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const passo = passos.find((p) => p * s.pps >= 70) ?? 600;
    const fim = duracaoTotal() + 400 / s.pps;
    for (let t = 0; t <= fim; t += passo) {
      const m = document.createElement('span');
      m.className = 'tl-marca';
      m.style.left = t * s.pps + 'px';
      const min = Math.floor(t / 60);
      m.textContent = `${min}:${String(Math.floor(t % 60)).padStart(2, '0')}${passo < 1 && t % 1 ? '.5' : ''}`;
      regua.append(m);
    }
  }

  // Itens sobrepostos na mesma trilha vão para faixas diferentes, para um não esconder o outro.
  function distribuirFaixas(itens) {
    const fins = [];
    const faixas = new Map();
    for (const i of [...itens].sort((a, b) => a.inicio - b.inicio)) {
      let f = fins.findIndex((fim) => fim <= i.inicio + 0.001);
      if (f < 0) f = fins.length;
      fins[f] = i.inicio + i.duracao;
      faixas.set(i.id, f);
    }
    return { faixas, total: Math.max(1, fins.length) };
  }

  function desenharTrilha(trilha) {
    const { faixas, total } = distribuirFaixas(trilha.itens);
    const alturaFaixa = ALTURA_POR_TIPO[trilha.tipo];
    const linha = document.createElement('div');
    linha.className = `tl-linha tipo-${trilha.tipo}`;
    linha.style.height = alturaFaixa * total + 'px';

    const cab = document.createElement('div');
    cab.className = 'tl-cab';
    const nome = document.createElement('span');
    nome.className = 'tl-nome';
    nome.textContent = trilha.nome ?? trilha.id;
    nome.title = nome.textContent;
    const botao = document.createElement('button');
    const audio = trilha.tipo === 'audio';
    const desligada = audio ? trilha.muda : trilha.oculta;
    botao.textContent = audio ? (desligada ? '🔇' : '🔊') : desligada ? '🚫' : '👁';
    botao.title = audio ? 'Silenciar trilha' : 'Ocultar trilha';
    botao.onclick = () =>
      alterar(() => {
        if (audio) trilha.muda = !trilha.muda;
        else trilha.oculta = !trilha.oculta;
      });
    cab.append(nome, botao);

    const pista = document.createElement('div');
    pista.className = 'tl-pista';
    pista.dataset.trilha = trilha.id;
    pista.addEventListener('pointerdown', (e) => {
      if (e.target !== pista) return;
      selecionar(null);
      irPara(tempoDoEvento(e));
    });
    for (const item of trilha.itens) {
      const el = desenharItem(item, trilha);
      el.style.top = faixas.get(item.id) * alturaFaixa + 2 + 'px';
      el.style.height = alturaFaixa - 4 + 'px';
      pista.append(el);
    }
    for (const x of trilha.transicoes ?? []) {
      const b = trilha.itens.find((i) => i.id === x.para);
      const a = trilha.itens.find((i) => i.id === x.de);
      if (!a && !b) continue;
      const antes = x.alinhamento === 'inicio' ? 0 : x.alinhamento === 'fim' ? x.duracao : x.duracao / 2;
      const marca = document.createElement('div');
      marca.className = 'tl-trans';
      marca.title = TRANSICOES.find(([id]) => id === x.tipo)?.[1] ?? `${x.tipo} (Filmcraft)`;
      marca.style.left = ((b ? b.inicio : a.inicio + a.duracao) - antes) * s.pps + 'px';
      marca.style.width = Math.max(4, x.duracao * s.pps) + 'px';
      pista.append(marca);
    }
    linha.append(cab, pista);
    linha.classList.toggle('desligada', !!desligada);
    return linha;
  }

  function rotuloItem(item) {
    if (item.tipo === 'bloco') return `✦ ${item.componente}`;
    if (item.texto != null) return item.texto;
    return item.arquivo ?? item.tipo;
  }

  function posicionar(el, item) {
    el.style.left = item.inicio * s.pps + 'px';
    el.style.width = Math.max(2, item.duracao * s.pps) + 'px';
  }

  function desenharItem(item, trilha) {
    const el = document.createElement('div');
    el.className = `tl-item item-${item.tipo}` + (item.id === s.sel ? ' selecionado' : '');
    el.dataset.id = item.id;
    posicionar(el, item);
    desenharMidia(el, item, ALTURA_POR_TIPO[trilha.tipo]);
    const rotulo = document.createElement('span');
    rotulo.className = 'tl-rotulo';
    rotulo.textContent = rotuloItem(item);
    const esq = document.createElement('div');
    esq.className = 'tl-alca esq';
    const dir = document.createElement('div');
    dir.className = 'tl-alca dir';
    el.append(rotulo, esq, dir);
    for (const t of temposKeyframe(item)) el.append(desenharMarcaKf(item, t));
    el.addEventListener('pointerdown', (e) => iniciarArraste(e, item, trilha, e.target === esq ? 'esq' : e.target === dir ? 'dir' : 'mover'));
    return el;
  }

  // Miniaturas do vídeo e forma de onda do áudio, alinhadas ao trecho do arquivo que o item usa.
  function desenharMidia(el, item, altura) {
    const m = s.midia[item.arquivo];
    if (!m) return;
    const vel = item.velocidade ?? 1;
    const corte = item.corteInicio ?? 0;
    if (m.onda) {
      const fundo = document.createElement('div');
      fundo.className = 'tl-onda';
      fundo.style.backgroundImage = `url("${urlArquivo(m.onda)}")`;
      fundo.style.backgroundSize = `${(m.duracao / vel) * s.pps}px 100%`;
      fundo.style.backgroundPosition = `${(-corte / vel) * s.pps}px 0`;
      // A força do traço mostra o volume do item.
      fundo.style.opacity = Math.max(0.25, Math.min(1, item.volume ?? 1));
      el.append(fundo);
    } else if (m.tira) {
      const larguraMini = (m.larguraQuadro / m.altura) * altura;
      const larguraItem = item.duracao * s.pps;
      const tira = document.createElement('div');
      tira.className = 'tl-tira';
      for (let x = 0; x < larguraItem && x < 6000; x += larguraMini) {
        const seg = corte + (x / s.pps) * vel;
        const quadro = Math.min(m.quadros - 1, Math.floor(seg / m.passo));
        const mini = document.createElement('div');
        mini.style.cssText = `width:${larguraMini}px;background-image:url("${urlArquivo(m.tira)}");background-size:${m.quadros * larguraMini}px 100%;background-position:${-quadro * larguraMini}px 0`;
        tira.append(mini);
      }
      el.append(tira);
    }
  }

  // ---------- keyframes ----------
  // { t (segundos desde o início do item), v, curva }. Mesma conta da composição em TimelineVideo.tsx.

  function bezierY(x1, y1, x2, y2, x) {
    let lo = 0;
    let hi = 1;
    let p = x;
    for (let n = 0; n < 40; n++) {
      p = (lo + hi) / 2;
      const bx = 3 * (1 - p) * (1 - p) * p * x1 + 3 * (1 - p) * p * p * x2 + p * p * p;
      if (bx < x) lo = p;
      else hi = p;
    }
    return 3 * (1 - p) * (1 - p) * p * y1 + 3 * (1 - p) * p * p * y2 + p * p * p;
  }

  function valorEm(kfs, t) {
    const k = [...kfs].sort((a, b) => a.t - b.t);
    if (t <= k[0].t) return k[0].v;
    if (t >= k.at(-1).t) return k.at(-1).v;
    const i = k.findIndex((x) => x.t > t);
    const [a, b] = [k[i - 1], k[i]];
    if (a.curva === 'hold') return a.v;
    const sai = a.curva === 'bezier' || a.curva === 'easeOut';
    const chega = b.curva === 'bezier' || b.curva === 'easeIn' || a.curva === 'bezier';
    const u = (t - a.t) / (b.t - a.t);
    return a.v + (b.v - a.v) * (sai || chega ? bezierY(1 / 3, sai ? 0 : 1 / 3, 2 / 3, chega ? 1 : 2 / 3, u) : u);
  }

  const tempoNoItem = (item) => noQuadro(Math.max(0, Math.min(item.duracao, s.tempo - item.inicio)));
  const naMesmaHora = (a, b) => Math.abs(a - b) < 1 / (2 * fps());
  const temposKeyframe = (item) => [...new Set(Object.values(item.keyframes ?? {}).flat().map((k) => k.t))];

  function limparKeyframes(item) {
    for (const [p, kfs] of Object.entries(item.keyframes ?? {})) if (!kfs.length) delete item.keyframes[p];
    if (item.keyframes && !Object.keys(item.keyframes).length) delete item.keyframes;
  }

  // Aparar o começo tira tempo de antes dos keyframes: eles ficam presos ao mesmo ponto do arquivo.
  function deslocarKeyframes(item, delta) {
    for (const kfs of Object.values(item.keyframes ?? {})) for (const k of kfs) k.t = arredondar(Math.max(0, k.t + delta));
  }

  function dividirKeyframes(item, novo, offset) {
    if (!item.keyframes) return;
    const original = clonar(item.keyframes);
    item.keyframes = {};
    novo.keyframes = {};
    for (const [p, kfs] of Object.entries(original)) {
      const corte = { t: arredondar(offset), v: valorEm(kfs, offset), curva: 'linear' };
      item.keyframes[p] = [...kfs.filter((k) => k.t < offset), corte];
      novo.keyframes[p] = [{ ...corte, t: 0 }, ...kfs.filter((k) => k.t > offset).map((k) => ({ ...k, t: arredondar(k.t - offset) }))];
    }
  }

  function desenharMarcaKf(item, t) {
    const m = document.createElement('div');
    m.className = 'tl-kf';
    m.style.left = t * s.pps + 'px';
    m.title = 'Keyframe. Arraste para mover.';
    m.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selecionar(item.id);
      irPara(item.inicio + t);
      if (s.bloqueada) return;
      m.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const antes = JSON.stringify(s.t);
      const donos = Object.values(item.keyframes).flat().filter((k) => k.t === t);
      let atual = t;
      const mover = (ev) => {
        atual = noQuadro(Math.max(0, Math.min(item.duracao, t + (ev.clientX - x0) / s.pps)));
        for (const k of donos) k.t = atual;
        m.style.left = atual * s.pps + 'px';
      };
      const soltar = () => {
        m.removeEventListener('pointermove', mover);
        m.removeEventListener('pointerup', soltar);
        if (atual === t) return;
        s.desfazer.push(antes);
        s.refazer = [];
        aposAlterar();
      };
      m.addEventListener('pointermove', mover);
      m.addEventListener('pointerup', soltar);
    });
    return m;
  }

  // O inspetor mostra o valor no cursor enquanto o parâmetro é animado.
  function atualizarCamposKf() {
    for (const c of s.camposKf) {
      const kfs = c.item.keyframes?.[c.caminho];
      const t = tempoNoItem(c.item);
      if (kfs?.length && document.activeElement !== c.entrada) c.entrada.value = arredondar(valorEm(kfs, t));
      const aqui = kfs?.find((k) => naMesmaHora(k.t, t));
      c.diamante.classList.toggle('ativo', !!kfs?.length);
      c.diamante.classList.toggle('no-ponto', !!aqui);
      c.curva.hidden = !aqui;
      if (aqui) c.curva.value = aqui.curva ?? 'linear';
    }
  }

  function controlesKf(item, caminho, entrada, valorFixo) {
    const box = document.createElement('span');
    box.className = 'kf-controles';
    const botao = (rotulo, titulo, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = rotulo;
      b.title = titulo;
      b.onclick = (e) => {
        e.preventDefault();
        fn();
      };
      return b;
    };
    const ir = (dir) => {
      const kfs = item.keyframes?.[caminho];
      if (!kfs?.length) return;
      const t = s.tempo - item.inicio;
      const ordem = [...kfs].sort((a, b) => a.t - b.t);
      const alvo = dir < 0 ? ordem.filter((k) => k.t < t - 0.001).at(-1) : ordem.find((k) => k.t > t + 0.001);
      if (alvo) irPara(item.inicio + alvo.t);
    };
    const diamante = botao('◆', 'Criar ou tirar keyframe no cursor', () => {
      alterar(() => {
        const t = tempoNoItem(item);
        item.keyframes ??= {};
        const kfs = (item.keyframes[caminho] ??= []);
        const i = kfs.findIndex((k) => naMesmaHora(k.t, t));
        if (i >= 0) kfs.splice(i, 1);
        else kfs.push({ t, v: kfs.length ? valorEm(kfs, t) : valorFixo(), curva: 'linear' });
        kfs.sort((a, b) => a.t - b.t);
        limparKeyframes(item);
      });
    });
    const curva = document.createElement('select');
    curva.className = 'kf-curva';
    curva.title = 'Curva do trecho que sai deste keyframe';
    for (const [id, nome] of CURVAS) {
      const op = document.createElement('option');
      op.value = id;
      op.textContent = nome;
      curva.append(op);
    }
    curva.onchange = () => {
      alterar(() => {
        const k = item.keyframes?.[caminho]?.find((x) => naMesmaHora(x.t, tempoNoItem(item)));
        if (k) k.curva = curva.value;
      });
    };
    box.append(botao('◀', 'Keyframe anterior', () => ir(-1)), diamante, botao('▶', 'Próximo keyframe', () => ir(1)), curva);
    s.camposKf.push({ item, caminho, entrada, diamante, curva });
    return box;
  }

  function desenharCursor() {
    if (!s.t) return;
    qs('#tl-cursor').style.left = LARGURA_CAB + s.tempo * s.pps + 'px';
    atualizarCamposKf();
    qs('#tl-tempo').textContent = formatarTempo(s.tempo);
    // Tocando, a timeline acompanha o cursor.
    if (s.tocando) {
      const corpo = qs('#tl-corpo');
      const x = LARGURA_CAB + s.tempo * s.pps;
      if (x > corpo.scrollLeft + corpo.clientWidth - 40) corpo.scrollLeft = x - LARGURA_CAB - 60;
    }
  }

  function tempoDoEvento(e) {
    const r = qs('#tl-regua').getBoundingClientRect();
    return Math.max(0, (e.clientX - r.left) / s.pps);
  }

  function selecionar(id) {
    if (s.sel === id) return;
    s.sel = id;
    if (id) mostrarAba('inspetor');
    document.querySelectorAll('.tl-item').forEach((el) => el.classList.toggle('selecionado', el.dataset.id === id));
    qs('#tl-excluir').disabled = !id || s.bloqueada;
    desenharInspetor();
  }

  // ---------- arrastar: mover e aparar ----------

  function pontosDeImã(idIgnorado) {
    const pontos = [0, s.tempo];
    for (const i of todosItens()) {
      if (i.id === idIgnorado) continue;
      pontos.push(i.inicio, i.inicio + i.duracao);
    }
    return pontos;
  }

  function imantar(valor, pontos) {
    if (!s.ima) return { valor, guia: null };
    const margem = 8 / s.pps;
    let melhor = null;
    for (const p of pontos) if (Math.abs(p - valor) <= margem && (melhor == null || Math.abs(p - valor) < Math.abs(melhor - valor))) melhor = p;
    return melhor == null ? { valor, guia: null } : { valor: melhor, guia: melhor };
  }

  function mostrarGuia(t) {
    const g = qs('#tl-guia');
    g.hidden = t == null;
    if (t != null) g.style.left = LARGURA_CAB + t * s.pps + 'px';
  }

  // Quanto do arquivo ainda existe depois do corte, em segundos da timeline.
  function limiteFonte(item) {
    const m = s.midia[item.arquivo];
    const dur = m?.duracao;
    if (!dur || (item.tipo !== 'video' && item.tipo !== 'audio')) return Infinity;
    return (dur - (item.corteInicio ?? 0)) / (item.velocidade ?? 1);
  }

  // ---------- ferramentas de corte ----------

  function vizinhos(item, trilha) {
    return {
      antes: trilha.itens.find((i) => i !== item && Math.abs(i.inicio + i.duracao - item.inicio) <= MARGEM_ENCOSTO),
      depois: trilha.itens.find((i) => i !== item && Math.abs(item.inicio + item.duracao - i.inicio) <= MARGEM_ENCOSTO),
    };
  }

  const prende = (x, min, max) => Math.max(min, Math.min(max, x));
  const umQuadro = () => 1 / fps();
  const sobraNoFim = (i) => (limiteFonte(i) === Infinity ? Infinity : limiteFonte(i) - i.duracao);
  const sobraNoInicio = (i) => (i.tipo === 'video' || i.tipo === 'audio' ? (i.corteInicio ?? 0) / (i.velocidade ?? 1) : Infinity);

  // Muda o começo do item mantendo o resto no lugar: é o que aparar à esquerda faz com arquivo e keyframes.
  function moverComeco(i, d) {
    i.inicio = arredondar(i.inicio + d);
    i.duracao = arredondar(i.duracao - d);
    if (i.tipo === 'video' || i.tipo === 'audio') i.corteInicio = arredondar((i.corteInicio ?? 0) + d * (i.velocidade ?? 1));
    deslocarKeyframes(i, -d);
  }

  // Aplica a ferramenta a partir do estado do começo do arraste: não acumula erro nem sai dos limites.
  const OPERACOES = {
    ripple(item, trilha, modo, delta) {
      const seguintes = trilha.itens.filter((i) => i !== item && i.inicio >= item.inicio + item.duracao - 0.001);
      let mudanca;
      if (modo === 'dir') {
        const d = prende(delta, umQuadro() - item.duracao, sobraNoFim(item));
        item.duracao = arredondar(item.duracao + d);
        mudanca = d;
      } else {
        const d = prende(delta, -sobraNoInicio(item), item.duracao - umQuadro());
        const inicio = item.inicio;
        moverComeco(item, d);
        item.inicio = inicio;
        mudanca = -d;
      }
      for (const i of seguintes) i.inicio = arredondar(i.inicio + mudanca);
    },
    roll(item, trilha, modo, delta) {
      const { antes, depois } = vizinhos(item, trilha);
      const [a, b] = modo === 'dir' ? [item, depois] : [antes, item];
      if (!a || !b) return;
      const d = prende(delta, Math.max(umQuadro() - a.duracao, -sobraNoInicio(b)), Math.min(b.duracao - umQuadro(), sobraNoFim(a)));
      a.duracao = arredondar(a.duracao + d);
      moverComeco(b, d);
    },
    slip(item, trilha, modo, delta) {
      if (item.tipo !== 'video' && item.tipo !== 'audio') return;
      const vel = item.velocidade ?? 1;
      const d = prende(-delta, -sobraNoInicio(item), sobraNoFim(item));
      item.corteInicio = arredondar((item.corteInicio ?? 0) + d * vel);
    },
    slide(item, trilha, modo, delta) {
      const { antes, depois } = vizinhos(item, trilha);
      if (!antes && !depois) return;
      const min = antes ? Math.max(umQuadro() - antes.duracao, -sobraNoInicio(item)) : -item.inicio;
      const max = depois ? Math.min(depois.duracao - umQuadro(), antes ? sobraNoFim(antes) : Infinity) : antes ? sobraNoFim(antes) : Infinity;
      const d = prende(delta, min, max);
      if (antes) antes.duracao = arredondar(antes.duracao + d);
      if (depois) moverComeco(depois, d);
      item.inicio = arredondar(item.inicio + d);
    },
    taxa(item, trilha, modo, delta) {
      if (item.tipo !== 'video' && item.tipo !== 'audio') return;
      const vel = item.velocidade ?? 1;
      const trecho = item.duracao * vel;
      const dur = prende(item.duracao + (modo === 'esq' ? -delta : delta), trecho / 10, trecho / 0.1);
      const fator = dur / item.duracao;
      for (const kfs of Object.values(item.keyframes ?? {})) for (const k of kfs) k.t = arredondar(k.t * fator);
      if (modo === 'esq') item.inicio = arredondar(item.inicio + item.duracao - dur);
      item.duracao = arredondar(dur);
      item.velocidade = arredondar(trecho / dur);
      if (item.velocidade === 1) delete item.velocidade;
    },
  };

  function iniciarFerramenta(e, item, trilha, modo) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const antes = JSON.stringify(s.t);
    const inicial = clonar(trilha.itens);
    const pontos = pontosDeImã(item.id);
    const fimOriginal = item.inicio + item.duracao;
    let mudou = false;
    const aoMover = (ev) => {
      if (Math.abs(ev.clientX - x0) > 2) mudou = true;
      if (!mudou) return;
      let delta = (ev.clientX - x0) / s.pps;
      // Ímã só nas pontas: é onde se mira um corte.
      if (modo !== 'mover') {
        const borda = modo === 'dir' ? fimOriginal : inicial.find((i) => i.id === item.id).inicio;
        const alvo = imantar(borda + delta, pontos);
        mostrarGuia(alvo.guia);
        delta = alvo.valor - borda;
      }
      delta = Math.round(delta * fps()) / fps();
      inicial.forEach((copia) => {
        const atual = trilha.itens.find((i) => i.id === copia.id);
        for (const k of Object.keys(atual)) delete atual[k];
        Object.assign(atual, clonar(copia));
      });
      OPERACOES[s.ferramenta](item, trilha, modo, delta);
      for (const i of trilha.itens) {
        const alvo = document.querySelector(`.tl-item[data-id="${i.id}"]`);
        if (alvo) posicionar(alvo, i);
      }
    };
    const aoSoltar = () => {
      el.removeEventListener('pointermove', aoMover);
      el.removeEventListener('pointerup', aoSoltar);
      el.removeEventListener('pointercancel', aoSoltar);
      mostrarGuia(null);
      if (!mudou) return;
      s.desfazer.push(antes);
      s.refazer = [];
      aposAlterar();
    };
    el.addEventListener('pointermove', aoMover);
    el.addEventListener('pointerup', aoSoltar);
    el.addEventListener('pointercancel', aoSoltar);
  }

  function iniciarArraste(e, item, trilha, modo) {
    if (e.button !== 0) return;
    e.stopPropagation();
    selecionar(item.id);
    if (s.bloqueada) return;
    if (s.ferramenta === 'navalha') {
      const c = imantar(tempoDoEvento(e), pontosDeImã(item.id)).valor;
      alterar(() => dividirItem(item, trilha, noQuadro(c)));
      return;
    }
    const f = s.ferramenta;
    const naBorda = modo !== 'mover';
    if ((f === 'ripple' || f === 'roll' || f === 'taxa') && naBorda) return iniciarFerramenta(e, item, trilha, modo);
    if ((f === 'slip' || f === 'slide') && !naBorda) return iniciarFerramenta(e, item, trilha, modo);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const original = { inicio: item.inicio, duracao: item.duracao, corteInicio: item.corteInicio };
    const antes = JSON.stringify(s.t);
    const pontos = pontosDeImã(item.id);
    const vel = item.velocidade ?? 1;
    const temFonte = item.tipo === 'video' || item.tipo === 'audio';
    let destino = trilha;
    let mudou = false;

    const aoMover = (ev) => {
      const delta = (ev.clientX - x0) / s.pps;
      if (Math.abs(ev.clientX - x0) > 2) mudou = true;
      if (modo === 'mover') {
        let inicio = Math.max(0, original.inicio + delta);
        const a = imantar(inicio, pontos);
        const b = imantar(inicio + original.duracao, pontos);
        const peloFim = b.guia != null && (a.guia == null || Math.abs(b.valor - (inicio + original.duracao)) < Math.abs(a.valor - inicio));
        inicio = peloFim ? b.valor - original.duracao : a.valor;
        item.inicio = noQuadro(Math.max(0, inicio));
        mostrarGuia(peloFim ? b.guia : a.guia);
        const alvo = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.tl-pista');
        const tr = alvo && s.t.trilhas.find((x) => x.id === alvo.dataset.trilha);
        if (tr && tr !== destino && ACEITA[tr.tipo].includes(item.tipo)) {
          destino = tr;
          alvo.append(el);
          mudou = true;
        }
      } else if (modo === 'esq') {
        // Aparar o começo: o corte no arquivo anda junto, e o fim do item fica onde está.
        const fim = original.inicio + original.duracao;
        let inicio = imantar(original.inicio + delta, pontos);
        mostrarGuia(inicio.guia);
        let novo = Math.min(inicio.valor, fim - 1 / fps());
        novo = Math.max(0, novo);
        if (temFonte) novo = Math.max(novo, original.inicio - (original.corteInicio ?? 0) / vel);
        item.inicio = noQuadro(novo);
        item.duracao = arredondar(fim - item.inicio);
        if (temFonte) item.corteInicio = arredondar((original.corteInicio ?? 0) + (item.inicio - original.inicio) * vel);
        // Enquanto arrasta só mostra; os keyframes andam quando soltar.
        original.aparado = item.inicio - original.inicio;
      } else {
        const fim = imantar(original.inicio + original.duracao + delta, pontos);
        mostrarGuia(fim.guia);
        const dur = Math.max(1 / fps(), fim.valor - original.inicio);
        item.duracao = arredondar(Math.min(dur, limiteFonte(item)));
      }
      posicionar(el, item);
      qs('#tl-inspetor-tempo') && (qs('#tl-inspetor-tempo').textContent = `${item.inicio.toFixed(2)} s → ${(item.inicio + item.duracao).toFixed(2)} s`);
    };

    const aoSoltar = () => {
      el.removeEventListener('pointermove', aoMover);
      el.removeEventListener('pointerup', aoSoltar);
      el.removeEventListener('pointercancel', aoSoltar);
      mostrarGuia(null);
      if (!mudou) return;
      if (original.aparado) deslocarKeyframes(item, -original.aparado);
      if (destino !== trilha) {
        trilha.itens.splice(trilha.itens.indexOf(item), 1);
        destino.itens.push(item);
        // Transição só existe entre itens da mesma trilha.
        trilha.transicoes = (trilha.transicoes ?? []).filter((x) => x.de !== item.id && x.para !== item.id);
        if (!trilha.transicoes.length) delete trilha.transicoes;
      }
      s.desfazer.push(antes);
      s.refazer = [];
      aposAlterar();
    };

    el.addEventListener('pointermove', aoMover);
    el.addEventListener('pointerup', aoSoltar);
    el.addEventListener('pointercancel', aoSoltar);
  }

  function arrastarCursor(e) {
    irPara(tempoDoEvento(e));
    const mover = (ev) => irPara(tempoDoEvento(ev));
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  // ---------- comandos ----------

  function dividirItem(item, trilha, c) {
    const offset = c - item.inicio;
    if (offset <= 0.001 || offset >= item.duracao - 0.001) return false;
    const novo = clonar(item);
    novo.id = novoId();
    novo.inicio = arredondar(c);
    novo.duracao = arredondar(item.duracao - offset);
    item.duracao = arredondar(offset);
    if (item.tipo === 'video' || item.tipo === 'audio') {
      novo.corteInicio = arredondar((item.corteInicio ?? 0) + offset * (item.velocidade ?? 1));
    }
    if (item.palavras) {
      const dentro = item.palavras.filter((p) => p.inicio < offset);
      const resto = item.palavras.filter((p) => p.inicio >= offset);
      item.palavras = dentro;
      novo.palavras = resto.map((p) => ({ ...p, inicio: p.inicio - offset, fim: p.fim - offset }));
      item.texto = dentro.map((p) => p.texto).join(' ');
      novo.texto = resto.map((p) => p.texto).join(' ');
    }
    delete item.saida;
    delete novo.entrada;
    dividirKeyframes(item, novo, offset);
    for (const x of trilha.transicoes ?? []) if (x.de === item.id) x.de = novo.id;
    trilha.itens.splice(trilha.itens.indexOf(item) + 1, 0, novo);
    return true;
  }

  // Divide o item selecionado; sem seleção, tudo o que está sob o cursor.
  function dividir() {
    const c = s.tempo;
    const noCursor = (i) => i.inicio < c && i.inicio + i.duracao > c;
    const sel = itemSel();
    const alvos = sel && noCursor(sel)
      ? [[sel, trilhaDe(sel.id)]]
      : s.t.trilhas.flatMap((tr) => tr.itens.filter(noCursor).map((i) => [i, tr]));
    if (!alvos.length) return;
    alterar(() => alvos.forEach(([i, tr]) => dividirItem(i, tr, c)));
  }

  function excluir(fecharVao) {
    const item = itemSel();
    if (!item) return;
    const trilha = trilhaDe(item.id);
    alterar(() => {
      trilha.itens.splice(trilha.itens.indexOf(item), 1);
      if (trilha.transicoes) {
        trilha.transicoes = trilha.transicoes.filter((x) => x.de !== item.id && x.para !== item.id);
        if (!trilha.transicoes.length) delete trilha.transicoes;
      }
      if (fecharVao) {
        for (const i of trilha.itens) if (i.inicio >= item.inicio + item.duracao - 0.001) i.inicio = arredondar(i.inicio - item.duracao);
      }
      s.sel = null;
    });
  }

  function adicionarTexto() {
    const trilha = s.t.trilhas.find((tr) => tr.tipo === 'sobreposicao');
    if (!trilha) return;
    const item = {
      id: novoId(), tipo: 'texto', inicio: arredondar(s.tempo), duracao: 3, texto: 'Texto',
      estilo: { fonte: 'Montserrat', tamanho: Math.round(s.t.largura * 0.08), peso: 800, cor: '#ffffff' },
      x: 0, y: 0, entrada: { tipo: 'fade', duracao: 0.3 },
    };
    alterar(() => {
      trilha.itens.push(item);
      s.sel = item.id;
    });
  }

  // Importa para a aba Materiais sem mexer na timeline.
  async function adicionarAoProjeto(caminhos) {
    if (!caminhos.length || s.bloqueada) return;
    const id = s.id;
    avisar('Importando…');
    const tirarLog = api.aoLog((l) => avisar(l));
    try {
      await api.importarTimeline({ id, caminhos });
      avisar('');
    } catch (e) {
      avisar('Não importou: ' + e.message);
    } finally {
      tirarLog();
    }
    if (s.id !== id) return;
    const antes = s.materiais.length;
    await carregarMateriais();
    if (s.materiais.length === antes) avisar('Nenhum material novo: não há vídeo, imagem nem áudio nesse local.');
    carregarMidia();
  }

  // Materiais novos: vídeo e imagem entram no fim da trilha de vídeo; áudio no cursor, na última trilha de áudio.
  async function adicionarArquivos(caminhos) {
    if (!caminhos.length || s.bloqueada) return;
    const id = s.id;
    avisar('Importando…');
    const tirarLog = api.aoLog((l) => avisar(l));
    let novos;
    try {
      novos = await api.importarTimeline({ id, caminhos });
    } catch (e) {
      avisar('Não importou: ' + e.message);
      return;
    } finally {
      tirarLog();
    }
    if (s.id !== id) return;
    avisar('');
    await carregarMateriais();
    alterar(() => {
      for (const m of novos) {
        if (m.tipo === 'audio') {
          const tr = s.t.trilhas.filter((x) => x.tipo === 'audio').at(-1);
          tr?.itens.push({ id: novoId(), tipo: 'audio', arquivo: m.arquivo, inicio: arredondar(s.tempo), duracao: m.duracao ?? 5, corteInicio: 0, volume: 0.5 });
        } else {
          const tr = s.t.trilhas.find((x) => x.tipo === 'video');
          if (!tr) continue;
          const inicio = Math.max(0, ...tr.itens.map((i) => i.inicio + i.duracao));
          tr.itens.push({
            id: novoId(), tipo: m.tipo, arquivo: m.arquivo, inicio, duracao: m.tipo === 'video' ? m.duracao ?? 5 : 3, ajuste: 'cover',
            ...(m.tipo === 'video' ? { corteInicio: 0, volume: 0 } : {}),
          });
        }
      }
    });
    carregarMidia();
  }

  // ---------- materiais: arrastar para a timeline e substituir ----------

  function mostrarAba(aba) {
    s.aba = aba;
    qs('#materiais').hidden = aba !== 'materiais';
    qs('#inspetor').hidden = aba !== 'inspetor';
    document.querySelectorAll('.abas-lateral button').forEach((b) => b.classList.toggle('ativo', b.dataset.aba === aba));
  }

  async function carregarMateriais() {
    const id = s.id;
    const p = await api.projeto(id);
    if (s.id !== id) return;
    s.materiais = [...p.materiais, ...(p.narracao ? [{ ...p.narracao, tipo: 'audio' }] : [])];
    desenharMateriais();
    desenharInspetor();
  }

  const materialDe = (arquivo) => s.materiais.find((m) => m.arquivo === arquivo);
  const mesmoGrupo = (a, b) => (a === 'audio') === (b === 'audio');

  function itemDoMaterial(m, inicio) {
    const base = { id: novoId(), tipo: m.tipo, arquivo: m.arquivo, inicio: arredondar(inicio) };
    if (m.tipo === 'audio') return { ...base, duracao: m.duracao ?? 5, corteInicio: 0, volume: 0.5 };
    return { ...base, duracao: m.tipo === 'video' ? m.duracao ?? 5 : 3, ajuste: 'cover', ...(m.tipo === 'video' ? { corteInicio: 0, volume: 0 } : {}) };
  }

  // Coloca na trilha pedida; se ela não aceita esse tipo, na primeira que aceita.
  function inserirMaterial(m, trilha, inicio) {
    const destino = trilha && ACEITA[trilha.tipo].includes(m.tipo) ? trilha : s.t.trilhas.find((tr) => ACEITA[tr.tipo].includes(m.tipo));
    if (!destino) return avisar('Nenhuma trilha aceita este material.');
    const item = itemDoMaterial(m, inicio);
    alterar(() => destino.itens.push(item));
    selecionar(item.id);
  }

  // Troca o arquivo e mantém lugar, efeitos e animações. O item só encolhe se o arquivo novo for mais curto.
  function trocarArquivoDoItem(item, m) {
    const vinhaDeImagem = item.tipo === 'imagem';
    item.arquivo = m.arquivo;
    item.tipo = m.tipo;
    if (m.tipo === 'imagem') {
      delete item.corteInicio;
      delete item.velocidade;
      delete item.volume;
      return;
    }
    const vel = item.velocidade ?? 1;
    const dur = m.duracao ?? item.duracao;
    item.corteInicio = arredondar(Math.max(0, Math.min(item.corteInicio ?? 0, dur - umQuadro())));
    item.duracao = arredondar(Math.min(item.duracao, (dur - item.corteInicio) / vel));
    if (vinhaDeImagem) item.volume = 0;
    for (const kfs of Object.values(item.keyframes ?? {})) for (const k of kfs) k.t = Math.min(k.t, item.duracao);
  }

  function substituirItem(item, m) {
    if (!mesmoGrupo(item.tipo, m.tipo)) return avisar('Áudio só troca por áudio, e vídeo ou imagem por vídeo ou imagem.');
    alterar(() => trocarArquivoDoItem(item, m));
    carregarMidia();
    avisar(`Trocado por ${m.arquivo}.`);
  }

  async function importarUm() {
    const [caminho] = await api.escolher({ tipo: 'materiais', multiplos: false });
    if (!caminho) return null;
    const id = s.id;
    const tirarLog = api.aoLog((l) => avisar(l));
    try {
      const [m] = await api.importarTimeline({ id, caminhos: [caminho] });
      avisar('');
      if (s.id !== id) return null;
      await carregarMateriais();
      return m ?? null;
    } catch (e) {
      avisar('Não importou: ' + e.message);
      return null;
    } finally {
      tirarLog();
    }
  }

  // Substitui o material em todos os clipes que o usam.
  async function substituirMaterial(antigo) {
    if (s.bloqueada) return;
    const m = await importarUm();
    if (!m) return;
    if (!mesmoGrupo(antigo.tipo, m.tipo)) return avisar('Áudio só troca por áudio, e vídeo ou imagem por vídeo ou imagem.');
    const alvos = todosItens().filter((i) => i.arquivo === antigo.arquivo);
    alterar(() => alvos.forEach((i) => trocarArquivoDoItem(i, m)));
    carregarMidia();
    avisar(`${m.arquivo} entrou em ${alvos.length} clipe(s).`);
  }

  function desenharMateriais() {
    const box = qs('#materiais');
    box.innerHTML = '';
    const importar = document.createElement('button');
    importar.textContent = '+ Importar arquivos';
    importar.onclick = async () => adicionarAoProjeto(await api.escolher({ tipo: 'materiais', multiplos: true }));
    const pasta = document.createElement('button');
    pasta.textContent = '+ Importar pasta';
    pasta.title = 'Importa os materiais da pasta e das subpastas';
    pasta.onclick = async () => adicionarAoProjeto(await api.escolherPasta());
    box.append(importar, pasta);
    const grade = document.createElement('div');
    grade.className = 'materiais-grade';
    for (const m of s.materiais) {
      const card = document.createElement('div');
      card.className = 'material';
      card.draggable = true;
      card.dataset.arquivo = m.arquivo;
      card.title = m.arquivo;
      const mini = document.createElement('div');
      mini.className = 'material-mini';
      const midia = s.midia[m.arquivo];
      if (m.tipo === 'imagem' && s.pastaAssets) mini.style.backgroundImage = `url("${urlArquivo(s.pastaAssets + '/' + m.arquivo)}")`;
      else if (midia?.tira) {
        mini.style.backgroundImage = `url("${urlArquivo(midia.tira)}")`;
        mini.style.backgroundSize = `${midia.quadros * 100}% 100%`;
        mini.style.backgroundPosition = '0 0';
      } else if (midia?.onda) {
        mini.style.backgroundImage = `url("${urlArquivo(midia.onda)}")`;
        mini.style.backgroundSize = '100% 100%';
      } else mini.textContent = ICONES[m.tipo] ?? '';
      const nome = document.createElement('div');
      nome.className = 'material-nome';
      nome.textContent = m.arquivo;
      const info = document.createElement('div');
      info.className = 'material-info';
      info.textContent = m.tipo === 'imagem' ? 'Imagem' : `${(m.duracao ?? 0).toFixed(1)} s`;
      const trocar = document.createElement('button');
      trocar.className = 'material-trocar';
      trocar.textContent = '⇄';
      trocar.title = 'Substituir este material em todos os clipes da timeline';
      trocar.onclick = (e) => {
        e.stopPropagation();
        substituirMaterial(m);
      };
      card.append(mini, nome, info, trocar);
      card.addEventListener('dragstart', (e) => {
        s.arrastando = m;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', m.arquivo);
      });
      card.addEventListener('dragend', () => {
        s.arrastando = null;
        limparAlvosDeSoltar();
      });
      // Duplo clique: no fim da trilha que aceita, ou no cursor para áudio.
      card.addEventListener('dblclick', () => {
        if (s.bloqueada) return;
        const tr = s.t.trilhas.find((x) => ACEITA[x.tipo].includes(m.tipo));
        inserirMaterial(m, tr, m.tipo === 'audio' ? s.tempo : Math.max(0, ...(tr?.itens ?? []).map((i) => i.inicio + i.duracao)));
      });
      grade.append(card);
    }
    box.append(grade);
    const dica = document.createElement('div');
    dica.className = 'materiais-dica';
    dica.textContent = 'Arraste para uma trilha para adicionar, ou solte em cima de um clipe para substituir o arquivo dele. Arquivos e pastas soltos aqui entram só na lista.';
    box.append(dica);
  }

  function limparAlvosDeSoltar() {
    document.querySelectorAll('.alvo-troca, .alvo-soltar').forEach((el) => el.classList.remove('alvo-troca', 'alvo-soltar'));
    mostrarGuia(null);
  }

  function ligarSoltarMateriais() {
    const trilhas = qs('#tl-trilhas');
    trilhas.addEventListener('dragover', (e) => {
      const m = s.arrastando;
      if (!m || s.bloqueada) return;
      e.preventDefault();
      limparAlvosDeSoltar();
      const clipe = e.target.closest('.tl-item');
      const it = clipe && todosItens().find((i) => i.id === clipe.dataset.id);
      if (it?.arquivo && mesmoGrupo(it.tipo, m.tipo)) {
        clipe.classList.add('alvo-troca');
        return;
      }
      e.target.closest('.tl-pista')?.classList.add('alvo-soltar');
      mostrarGuia(imantar(tempoDoEvento(e), pontosDeImã(null)).valor);
    });
    trilhas.addEventListener('dragleave', (e) => {
      if (!trilhas.contains(e.relatedTarget)) limparAlvosDeSoltar();
    });
    trilhas.addEventListener('drop', (e) => {
      const m = s.arrastando;
      if (!m || s.bloqueada) return;
      e.preventDefault();
      limparAlvosDeSoltar();
      s.arrastando = null;
      const clipe = e.target.closest('.tl-item');
      const it = clipe && todosItens().find((i) => i.id === clipe.dataset.id);
      if (it?.arquivo && mesmoGrupo(it.tipo, m.tipo)) return substituirItem(it, m);
      const pista = e.target.closest('.tl-pista');
      const tr = pista && s.t.trilhas.find((x) => x.id === pista.dataset.trilha);
      inserirMaterial(m, tr, noQuadro(imantar(tempoDoEvento(e), pontosDeImã(null)).valor));
    });
  }

  function secaoArquivo(item) {
    const box = document.createElement('div');
    box.className = 'ins-secao';
    box.innerHTML = '<h5>Substituir arquivo</h5>';
    const seletor = document.createElement('select');
    for (const m of s.materiais.filter((x) => mesmoGrupo(x.tipo, item.tipo))) {
      const op = document.createElement('option');
      op.value = m.arquivo;
      op.textContent = m.arquivo;
      seletor.append(op);
    }
    seletor.value = item.arquivo;
    seletor.onchange = () => {
      const m = materialDe(seletor.value);
      if (m) substituirItem(item, m);
    };
    const outro = document.createElement('button');
    outro.textContent = 'Outro arquivo…';
    outro.onclick = async () => {
      if (s.bloqueada) return;
      const m = await importarUm();
      if (m) substituirItem(item, m);
    };
    box.append(seletor, outro);
    return box;
  }

  // ---------- formato ----------

  // Posições, textos e larguras acompanham o quadro novo; vídeo com "cover" se ajusta sozinho.
  function mudarFormato(formato) {
    const alvo = FORMATOS[formato];
    if (!alvo || s.bloqueada) return;
    const [largura, altura] = alvo;
    const rx = largura / s.t.largura;
    const ry = altura / s.t.altura;
    const rm = Math.min(largura, altura) / Math.min(s.t.largura, s.t.altura);
    alterar(() => {
      for (const i of todosItens()) {
        if (i.x) i.x = arredondar(i.x * rx);
        if (i.y) i.y = arredondar(i.y * ry);
        if (i.largura) i.largura = Math.round(i.largura * rm);
        for (const k of i.keyframes?.x ?? []) k.v = arredondar(k.v * rx);
        for (const k of i.keyframes?.y ?? []) k.v = arredondar(k.v * ry);
        if (i.estilo?.tamanho) i.estilo.tamanho = Math.round(i.estilo.tamanho * rm);
        if (i.estilo?.contornoLargura) i.estilo.contornoLargura = Math.round(i.estilo.contornoLargura * rm);
      }
      s.t.largura = largura;
      s.t.altura = altura;
    });
  }

  function desenharFormato() {
    const sel = qs('#tl-formato');
    const atual = Object.keys(FORMATOS).find((f) => FORMATOS[f][0] === s.t.largura && FORMATOS[f][1] === s.t.altura);
    if (!sel.options.length) {
      for (const f of Object.keys(FORMATOS)) {
        const op = document.createElement('option');
        op.value = f;
        op.textContent = `${f} (${FORMATOS[f].join('x')})`;
        sel.append(op);
      }
    }
    sel.value = atual ?? '';
    const info = qs('#ed-info');
    info.textContent = info.textContent.replace(/\d+x\d+/, `${s.t.largura}x${s.t.altura}`);
  }

  async function gerarLegendas() {
    if (s.bloqueada) return;
    await salvarAgora();
    guardarEstado();
    try {
      const n = await api.legendasTimeline({ id: s.id });
      s.t = await api.lerTimeline(s.id);
      s.sel = null;
      atualizarPrevia();
      desenhar();
      avisar(`${n} legendas criadas.`);
    } catch (e) {
      s.desfazer.pop();
      avisar(e.message.split('\n').at(-1).replace(/^Error: /, ''));
    }
  }

  function aplicarZoom(pps, ancoraX) {
    const corpo = qs('#tl-corpo');
    const x = ancoraX ?? corpo.clientWidth / 2;
    const seg = (corpo.scrollLeft + x - LARGURA_CAB) / s.pps;
    s.pps = Math.max(4, Math.min(400, pps));
    qs('#tl-zoom').value = Math.log(s.pps);
    desenhar();
    corpo.scrollLeft = seg * s.pps + LARGURA_CAB - x;
  }

  function ajustarNaTela() {
    const largura = qs('#tl-corpo').clientWidth - LARGURA_CAB - 30;
    aplicarZoom(Math.max(4, largura / duracaoTotal()), 0);
    qs('#tl-corpo').scrollLeft = 0;
  }

  // ---------- inspetor ----------

  const COMUNS_VISUAIS = [
    ['x', 'Posição X', 'num'], ['y', 'Posição Y', 'num'], ['escala', 'Escala', 'num', 0.05, 1],
    ['rotacao', 'Rotação', 'num'], ['opacidade', 'Opacidade', 'faixa', 1], ['mesclagem', 'Mesclagem', MESCLAGENS],
    ['entrada.tipo', 'Entrada', ANIMACOES], ['entrada.duracao', 'Duração da entrada', 'num', 0.05, 0.3],
    ['saida.tipo', 'Saída', ANIMACOES], ['saida.duracao', 'Duração da saída', 'num', 0.05, 0.3],
  ];
  const ESTILO = [
    ['estilo.fonte', 'Fonte', FONTES], ['estilo.tamanho', 'Tamanho', 'num'], ['estilo.peso', 'Peso', ['400', '600', '800']],
    ['estilo.cor', 'Cor', 'cor'], ['estilo.contorno', 'Contorno', 'cor'], ['estilo.contornoLargura', 'Largura do contorno', 'num'],
    ['estilo.maiusculas', 'Maiúsculas', 'marca'],
  ];
  const CAMPOS = {
    video: [['corteInicio', 'Corte no arquivo', 'num', 0.1], ['velocidade', 'Velocidade', 'num', 0.1, 1], ['volume', 'Volume', 'faixa', 0], ['ajuste', 'Ajuste', ['cover', 'contain']], ...COMUNS_VISUAIS],
    imagem: [['ajuste', 'Ajuste', ['contain', 'cover']], ['largura', 'Largura (px)', 'num'], ...COMUNS_VISUAIS],
    audio: [['corteInicio', 'Corte no arquivo', 'num', 0.1], ['volume', 'Volume', 'faixa', 1], ['fadeIn', 'Fade de entrada (s)', 'num', 0.1], ['fadeOut', 'Fade de saída (s)', 'num', 0.1]],
    texto: [['texto', 'Texto', 'area'], ...ESTILO, ...COMUNS_VISUAIS],
    legenda: [['texto', 'Texto', 'area'], ...ESTILO, ['estilo.corDestaque', 'Cor da palavra falada', 'cor'], ['x', 'Posição X', 'num'], ['y', 'Posição Y', 'num']],
    bloco: [['props', 'Propriedades (JSON)', 'json'], ...COMUNS_VISUAIS],
  };

  // Liga-se o efeito pela marca; os campos só aparecem com ele ligado.
  const EFEITOS = [
    ['cor', 'Correção de cor', [['exposicao', 'Exposição', 0.1, 0], ['contraste', 'Contraste', 1, 0], ['saturacao', 'Saturação', 1, 100], ['temperatura', 'Temperatura', 1, 0], ['matiz', 'Matiz', 1, 0]]],
    ['desfoque', 'Desfoque', [['raio', 'Quantidade', 1, 10]]],
    ['corte', 'Recorte (%)', [['esquerda', 'Esquerda', 1, 0], ['cima', 'Cima', 1, 0], ['direita', 'Direita', 1, 0], ['baixo', 'Baixo', 1, 0]]],
    ['vinheta', 'Vinheta', [['quantidade', 'Quantidade', 1, -50]]],
    ['pb', 'Preto e branco'],
    ['inverter', 'Inverter'],
    ['espelhoH', 'Espelhar na horizontal'],
    ['espelhoV', 'Espelhar na vertical'],
  ];

  function secaoEfeitos(item) {
    const box = document.createElement('div');
    box.className = 'ins-secao';
    box.innerHTML = '<h5>Efeitos</h5>';
    for (const [id, nome, campos] of EFEITOS) {
      const linha = document.createElement('label');
      linha.className = 'ins-marca';
      const marca = document.createElement('input');
      marca.type = 'checkbox';
      marca.checked = !!item.efeitos?.[id];
      marca.onchange = () =>
        alterar(() => {
          item.efeitos ??= {};
          if (marca.checked) item.efeitos[id] = campos ? Object.fromEntries(campos.map(([c, , , p]) => [c, p])) : true;
          else {
            delete item.efeitos[id];
            for (const p of Object.keys(item.keyframes ?? {})) if (p.startsWith(`efeitos.${id}.`)) delete item.keyframes[p];
            limparKeyframes(item);
          }
          if (!Object.keys(item.efeitos).length) delete item.efeitos;
        });
      linha.append(marca, document.createTextNode(nome));
      box.append(linha);
      if (marca.checked && campos) for (const [c, rotulo, passo] of campos) box.append(criarCampo(item, [`efeitos.${id}.${c}`, rotulo, 'num', passo]));
    }
    for (const e of item.filmcraft?.efeitos ?? []) {
      const aviso = document.createElement('div');
      aviso.className = 'ins-filmcraft';
      aviso.textContent = `${e.effect}: só no Filmcraft`;
      box.append(aviso);
    }
    return box;
  }

  // Quanto de arquivo sobra dos dois lados decide onde a transição cabe.
  function alinhamentoPossivel(a, b, d) {
    const folgaA = a ? sobraNoFim(a) : Infinity;
    const folgaB = b ? sobraNoInicio(b) : Infinity;
    if (folgaA >= d / 2 && folgaB >= d / 2) return 'centro';
    if (folgaB >= d) return 'fim';
    if (folgaA >= d) return 'inicio';
    return null;
  }

  function secaoTransicao(item, trilha) {
    const box = document.createElement('div');
    box.className = 'ins-secao';
    box.innerHTML = '<h5>Transição de entrada</h5>';
    const atual = (trilha.transicoes ?? []).find((x) => x.para === item.id);
    const { antes } = vizinhos(item, trilha);
    const tipo = document.createElement('select');
    const opcoes = [...TRANSICOES];
    if (atual && !opcoes.some(([id]) => id === atual.tipo)) opcoes.push([atual.tipo, `${atual.tipo} (Filmcraft)`]);
    for (const [id, nome] of opcoes) {
      const op = document.createElement('option');
      op.value = id;
      op.textContent = nome;
      tipo.append(op);
    }
    tipo.value = atual?.tipo ?? '';
    const dur = document.createElement('input');
    dur.type = 'number';
    dur.step = 0.1;
    dur.min = 0.1;
    dur.value = atual?.duracao ?? 0.5;
    const aplicar = () =>
      alterar(() => {
        trilha.transicoes = (trilha.transicoes ?? []).filter((x) => x.para !== item.id);
        if (tipo.value) {
          const d = Math.max(umQuadro(), Number(dur.value) || 0.5);
          const lugar = alinhamentoPossivel(antes, item, d);
          if (!lugar) avisar('Falta sobra de arquivo nos clipes: a transição vai ficar seca em parte. Apare as pontas para dar folga.');
          trilha.transicoes.push({
            id: atual?.id ?? novoId(), tipo: tipo.value, duracao: arredondar(d), alinhamento: lugar ?? 'centro',
            ...(antes ? { de: antes.id } : {}), para: item.id,
            ...(atual?.tipo === tipo.value && atual.filmcraft ? { filmcraft: atual.filmcraft } : {}),
            ...(atual?.direcao ? { direcao: atual.direcao } : {}),
          });
        }
        if (!trilha.transicoes.length) delete trilha.transicoes;
      });
    tipo.onchange = aplicar;
    dur.onchange = aplicar;
    const l1 = document.createElement('label');
    l1.textContent = 'Tipo';
    l1.append(tipo);
    const l2 = document.createElement('label');
    l2.textContent = 'Duração (s)';
    l2.append(dur);
    box.append(l1, l2);
    return box;
  }

  const lerCampo = (item, caminho) => caminho.split('.').reduce((o, k) => o?.[k], item);

  function gravarCampo(item, caminho, valor) {
    const partes = caminho.split('.');
    const ultimo = partes.pop();
    let o = item;
    for (const k of partes) o = o[k] ??= {};
    if (valor === '' || valor == null) delete o[ultimo];
    else o[ultimo] = valor;
    // Sem tipo de animação, o grupo inteiro sai.
    for (const a of ['entrada', 'saida']) if (item[a] && !item[a].tipo) delete item[a];
    if (caminho === 'texto' && item.palavras) sincronizarPalavras(item);
  }

  // Texto de legenda editado: com o mesmo número de palavras os tempos ficam; senão são redistribuídos.
  function sincronizarPalavras(item) {
    const novas = String(item.texto ?? '').split(/\s+/).filter(Boolean);
    if (novas.length === item.palavras.length) {
      item.palavras = item.palavras.map((p, n) => ({ ...p, texto: novas[n] }));
    } else {
      const d = item.duracao / Math.max(1, novas.length);
      item.palavras = novas.map((texto, n) => ({ texto, inicio: n * d, fim: (n + 1) * d }));
    }
  }

  function aoEditarCampo(item, caminho, valor) {
    if (s.bloqueada) return;
    if (!s.alterandoCampo) {
      guardarEstado();
      s.alterandoCampo = true;
    }
    // Parâmetro animado: o valor digitado vira keyframe no cursor.
    const kfs = item.keyframes?.[caminho];
    if (kfs?.length && typeof valor === 'number') {
      const t = tempoNoItem(item);
      const k = kfs.find((x) => naMesmaHora(x.t, t));
      if (k) k.v = valor;
      else {
        kfs.push({ t, v: valor, curva: 'linear' });
        kfs.sort((a, b) => a.t - b.t);
        desenhar();
      }
      atualizarPrevia();
      salvarDepois();
      atualizarCamposKf();
      return;
    }
    gravarCampo(item, caminho, valor);
    atualizarPrevia();
    salvarDepois();
    const rotulo = document.querySelector(`.tl-item[data-id="${item.id}"] .tl-rotulo`);
    if (rotulo) rotulo.textContent = rotuloItem(item);
  }

  function criarCampo(item, [caminho, titulo, tipo, passo, padrao]) {
    const rotulo = document.createElement('label');
    rotulo.textContent = titulo;
    const atual = lerCampo(item, caminho);
    let entrada;
    const emitir = () => {
      const bruto = entrada.type === 'checkbox' ? entrada.checked : entrada.value;
      if (tipo === 'json') {
        try {
          aoEditarCampo(item, caminho, JSON.parse(bruto || '{}'));
          entrada.classList.remove('invalido');
        } catch {
          entrada.classList.add('invalido');
        }
        return;
      }
      const numerico = tipo === 'num' || tipo === 'faixa' || caminho === 'estilo.peso';
      aoEditarCampo(item, caminho, numerico && bruto !== '' ? Number(bruto) : bruto === false ? '' : bruto);
    };
    if (Array.isArray(tipo)) {
      entrada = document.createElement('select');
      for (const o of tipo) {
        const op = document.createElement('option');
        op.value = o;
        op.textContent = o || 'Nenhuma';
        entrada.append(op);
      }
      entrada.value = atual ?? '';
    } else if (tipo === 'area' || tipo === 'json') {
      entrada = document.createElement('textarea');
      entrada.rows = tipo === 'json' ? 4 : 2;
      entrada.value = tipo === 'json' ? JSON.stringify(atual ?? {}, null, 1) : atual ?? '';
    } else {
      entrada = document.createElement('input');
      if (tipo === 'num') {
        entrada.type = 'number';
        entrada.step = passo ?? 1;
        entrada.value = atual ?? '';
        if (padrao != null) entrada.placeholder = padrao;
      } else if (tipo === 'faixa') {
        entrada.type = 'range';
        entrada.min = 0;
        entrada.max = 1;
        entrada.step = 0.01;
        entrada.value = atual ?? passo ?? 1;
      } else if (tipo === 'cor') {
        entrada.type = 'color';
        entrada.value = atual ?? '#ffffff';
      } else if (tipo === 'marca') {
        entrada.type = 'checkbox';
        entrada.checked = !!atual;
      }
    }
    entrada.addEventListener('input', emitir);
    entrada.addEventListener('change', () => {
      emitir();
      s.alterandoCampo = false;
    });
    rotulo.append(entrada);
    if (ANIMAVEIS.has(caminho)) {
      const padroes = { escala: 1, opacidade: 1, 'efeitos.cor.saturacao': 100, 'efeitos.vinheta.quantidade': -50 };
      rotulo.append(controlesKf(item, caminho, entrada, () => lerCampo(item, caminho) ?? padroes[caminho] ?? 0));
    }
    return rotulo;
  }

  function desenharInspetor() {
    const box = qs('#inspetor');
    // Não reconstrói enquanto o usuário digita num campo do próprio inspetor.
    if (box.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON' && box.dataset.item === String(s.sel)) return;
    box.innerHTML = '';
    box.dataset.item = String(s.sel);
    s.camposKf = [];
    const item = itemSel();
    if (!item) {
      box.innerHTML = `<h4>Atalhos</h4><dl class="tl-atalhos">
        <dt>Espaço</dt><dd>tocar / pausar</dd><dt>S</dt><dd>dividir no cursor</dd>
        <dt>Del</dt><dd>excluir</dd><dt>Shift+Del</dt><dd>excluir e fechar o vão</dd>
        <dt>← →</dt><dd>um quadro</dd><dt>Ctrl+Z / Y</dt><dd>desfazer / refazer</dd>
        <dt>Ctrl+roda</dt><dd>zoom</dd>
        <dt>V</dt><dd>selecionar</dd><dt>B</dt><dd>ripple: apara e empurra o resto</dd>
        <dt>N</dt><dd>roll: move o corte entre dois clipes</dd><dt>Y</dt><dd>slip: troca o trecho do arquivo</dd>
        <dt>U</dt><dd>slide: desliza entre os vizinhos</dd><dt>R</dt><dd>velocidade pela duração</dd>
        <dt>C</dt><dd>navalha</dd></dl>`;
      return;
    }
    const titulo = document.createElement('h4');
    titulo.textContent = { video: 'Vídeo', imagem: 'Imagem', audio: 'Áudio', texto: 'Texto', legenda: 'Legenda', bloco: `Efeito: ${item.componente}` }[item.tipo];
    const tempo = document.createElement('div');
    tempo.id = 'tl-inspetor-tempo';
    tempo.className = 'tl-inspetor-tempo';
    tempo.textContent = `${item.inicio.toFixed(2)} s → ${(item.inicio + item.duracao).toFixed(2)} s`;
    box.append(titulo, tempo);
    if (item.arquivo) {
      const a = document.createElement('div');
      a.className = 'tl-inspetor-tempo';
      a.textContent = item.arquivo;
      box.append(a);
    }
    for (const c of CAMPOS[item.tipo] ?? []) box.append(criarCampo(item, c));
    if (item.arquivo) box.append(secaoArquivo(item));
    if (item.tipo !== 'audio' && item.tipo !== 'legenda') box.append(secaoEfeitos(item));
    const trilhaDoItem = trilhaDe(item.id);
    if (['video', 'sobreposicao'].includes(trilhaDoItem?.tipo)) box.append(secaoTransicao(item, trilhaDoItem));
    atualizarCamposKf();
    if (item.tipo === 'legenda') {
      const b = document.createElement('button');
      b.textContent = 'Aplicar este estilo a todas';
      b.onclick = () =>
        alterar(() => {
          for (const i of trilhaDe(item.id).itens) {
            i.estilo = clonar(item.estilo ?? {});
            i.x = item.x;
            i.y = item.y;
          }
        });
      box.append(b);
    }
  }

  // ---------- teclado e mouse ----------

  function aoTeclar(e) {
    if (!ativa() || estado.vista !== 'editor') return;
    if (e.target.closest?.('input, textarea, select, dialog')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) trocarEstado(s.desfazer, s.refazer);
    else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) trocarEstado(s.refazer, s.desfazer);
    else if (ctrl) return;
    else if (e.code === 'Space') tocarOuPausar();
    else if (e.key.toLowerCase() === 's') dividir();
    else if (FERRAMENTAS[e.key.toLowerCase()]) escolherFerramenta(FERRAMENTAS[e.key.toLowerCase()]);
    else if (e.key === 'Delete' || e.key === 'Backspace') excluir(e.shiftKey);
    else if (e.key === 'ArrowLeft') irPara(s.tempo - (e.shiftKey ? 1 : 1 / fps()));
    else if (e.key === 'ArrowRight') irPara(s.tempo + (e.shiftKey ? 1 : 1 / fps()));
    else if (e.key === 'Home') irPara(0);
    else if (e.key === 'End') irPara(duracaoTotal());
    else return;
    e.preventDefault();
  }

  function escolherFerramenta(f) {
    s.ferramenta = f;
    qs('#tl-ferramentas').querySelectorAll('button').forEach((b) => b.classList.toggle('ativo', b.dataset.f === f));
    qs('#tl').dataset.ferramenta = f;
  }

  async function comFilmcraft(acao) {
    if (s.bloqueada) return;
    const botoes = [qs('#tl-fc-abrir'), qs('#tl-fc-trazer')];
    botoes.forEach((b) => (b.disabled = true));
    const tirarLog = api.aoLog((l) => avisar(l));
    try {
      await salvarAgora();
      await acao();
    } catch (e) {
      avisar('Filmcraft: ' + e.message.split('\n').at(-1).replace(/^Error: /, ''));
    } finally {
      tirarLog();
      botoes.forEach((b) => (b.disabled = false));
    }
  }

  const abrirFilmcraft = () =>
    comFilmcraft(async () => {
      let r = await api.abrirFilmcraft({ id: s.id });
      if (r.pendente) {
        if (!confirm('O projeto foi salvo no Filmcraft e ainda não voltou para cá. Abrir de novo descarta essas edições (uma cópia fica como .anterior). Continuar?')) {
          avisar('Use "Trazer" para receber as edições do Filmcraft.');
          return;
        }
        r = await api.abrirFilmcraft({ id: s.id, descartar: true });
      }
      avisar(r.avisos?.length ? r.avisos.join(' ') : 'Aberto no Filmcraft. Salve lá (Ctrl+S) e clique em Trazer.');
    });

  const trazerFilmcraft = () =>
    comFilmcraft(async () => {
      const { avisos } = await api.trazerFilmcraft(s.id);
      await recarregar();
      avisar(avisos.length ? avisos.join(' ') : 'Edições do Filmcraft recebidas. Ctrl+Z desfaz.');
    });

  function tocarOuPausar() {
    verPrevia();
    s.previa?.ref.current?.alternar();
  }

  function ligarControles() {
    qs('#tl-regua-linha').addEventListener('pointerdown', arrastarCursor);
    qs('#tl-tocar').onclick = tocarOuPausar;
    qs('#tl-inicio').onclick = () => irPara(0);
    qs('#tl-dividir').onclick = dividir;
    qs('#tl-excluir').onclick = () => excluir(false);
    qs('#tl-desfazer').onclick = () => trocarEstado(s.desfazer, s.refazer);
    qs('#tl-refazer').onclick = () => trocarEstado(s.refazer, s.desfazer);
    qs('#tl-add-texto').onclick = adicionarTexto;
    qs('#tl-add-midia').onclick = async () => adicionarArquivos(await api.escolher({ tipo: 'materiais', multiplos: true }));
    qs('#tl-legendas').onclick = gerarLegendas;
    ligarSoltarMateriais();
    document.querySelectorAll('.abas-lateral button').forEach((b) => {
      b.onclick = () => mostrarAba(b.dataset.aba);
    });
    qs('#tl-formato').onchange = (e) => mudarFormato(e.target.value);
    qs('#tl-fc-abrir').onclick = abrirFilmcraft;
    qs('#tl-fc-trazer').onclick = trazerFilmcraft;
    qs('#tl-ferramentas').querySelectorAll('button').forEach((b) => {
      b.onclick = () => escolherFerramenta(b.dataset.f);
    });
    qs('#tl-ima').onclick = () => {
      s.ima = !s.ima;
      qs('#tl-ima').classList.toggle('ativo', s.ima);
    };
    qs('#tl-ajustar').onclick = ajustarNaTela;
    qs('#tl-zoom').oninput = (e) => aplicarZoom(Math.exp(Number(e.target.value)));
    qs('#tl-corpo').addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const r = qs('#tl-corpo').getBoundingClientRect();
        aplicarZoom(s.pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left);
      },
      { passive: false },
    );
    window.addEventListener('keydown', aoTeclar);
    areaDeSoltar(qs('#tl'), adicionarArquivos);
    areaDeSoltar(qs('#materiais'), adicionarAoProjeto);
    qs('#seg-player').querySelectorAll('button').forEach((b) => {
      b.onclick = () => (b.dataset.v === 'previa' ? verPrevia() : verRender());
    });
    // Divisor: arrastar muda a altura da timeline.
    qs('#tl-divisor').addEventListener('pointerdown', (e) => {
      const editor = qs('#v-editor');
      const y0 = e.clientY;
      const a0 = qs('#tl').getBoundingClientRect().height;
      const mover = (ev) => editor.style.setProperty('--tl-altura', Math.max(160, Math.min(window.innerHeight - 300, a0 + y0 - ev.clientY)) + 'px');
      const soltar = () => {
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
      };
      window.addEventListener('pointermove', mover);
      window.addEventListener('pointerup', soltar);
    });
  }

  // ---------- ciclo de vida ----------

  async function carregarMidia() {
    const id = s.id;
    const arquivos = [...new Set([...todosItens().map((i) => i.arquivo).filter(Boolean), ...s.materiais.map((m) => m.arquivo)])].filter((a) => !s.midia[a]);
    for (const arquivo of arquivos) {
      const m = await api.midiaTimeline({ id, arquivo }).catch(() => null);
      if (s.id !== id) return;
      if (m) {
        s.midia[arquivo] = m;
        desenhar();
        desenharMateriais();
        if (m.proxy && !s.proxies?.[arquivo]) {
          s.proxies = { ...s.proxies, [arquivo]: urlArquivo(m.proxy) };
          s.previa?.ref.current?.atualizarProxies(s.proxies);
        }
      }
    }
  }

  async function abrir(p) {
    await fechar();
    s.id = p.id;
    s.midia = {};
    s.sel = null;
    s.desfazer = [];
    s.refazer = [];
    s.tempo = 0;
    s.tocando = false;
    s.t = await api.lerTimeline(p.id);
    if (s.id !== p.id) return;
    qs('#v-editor').classList.add('com-timeline');
    qs('#tl').hidden = false;
    qs('#painel-lateral').hidden = false;
    mostrarAba('materiais');
    await carregarMateriais();
    if (s.id !== p.id) return;
    qs('#seg-player').hidden = false;
    avisar('');
    qs('#tl-tocar').textContent = '▶';
    const comFc = !!estado.ambiente?.filmcraft;
    qs('#tl-fc-abrir').hidden = !comFc;
    qs('#tl-fc-trazer').hidden = !comFc;
    escolherFerramenta('selecao');
    verPrevia();
    desenhar();
    ajustarNaTela();
    await montarPrevia();
    carregarMidia();
  }

  async function fechar() {
    await salvarAgora();
    desmontarPrevia();
    s.t = null;
    s.id = null;
    qs('#v-editor').classList.remove('com-timeline');
    qs('#tl').hidden = true;
    qs('#painel-lateral').hidden = true;
    qs('#seg-player').hidden = true;
    qs('#previa-host').hidden = true;
    qs('#previa-host').innerHTML = '';
    qs('#player').hidden = false;
  }

  // Claude trabalhando: a timeline fica só para ver, para as edições não se atropelarem.
  function bloquear(sim) {
    s.bloqueada = sim;
    if (!s.t) return;
    avisar(sim ? 'O Claude está editando. A timeline volta quando ele terminar.' : '');
    desenhar();
  }

  // Lê de novo o que o Claude gravou. O estado anterior vai para o desfazer.
  async function recarregar() {
    if (!s.t) return;
    const id = s.id;
    let nova;
    try {
      nova = await api.lerTimeline(id);
    } catch (e) {
      avisar('timeline.json ficou inválido: ' + e.message.split('\n').at(-1));
      return;
    }
    if (s.id !== id) return;
    const duracaoAntes = duracaoTotal();
    if (JSON.stringify(nova) !== JSON.stringify(s.t)) {
      s.desfazer.push(JSON.stringify(s.t));
      s.refazer = [];
      s.t = nova;
      if (!itemSel()) s.sel = null;
    }
    await carregarMateriais();
    await montarPrevia();
    // O vídeo mudou de tamanho (a primeira montagem, por exemplo): mostra ele inteiro de novo.
    if (duracaoTotal() !== duracaoAntes) ajustarNaTela();
    else desenhar();
    carregarMidia();
  }

  function contexto() {
    if (!s.t) return null;
    const item = itemSel();
    const partes = [`cursor em ${s.tempo.toFixed(2)} s de ${duracaoTotal().toFixed(2)} s`];
    if (item) partes.push(`item selecionado: id "${item.id}" (${item.tipo}${item.arquivo ? `, ${item.arquivo}` : ''}${item.texto ? `, "${item.texto}"` : ''}), de ${item.inicio.toFixed(2)} s a ${(item.inicio + item.duracao).toFixed(2)} s`);
    return partes.join('; ');
  }

  ligarControles();

  return { abrir, fechar, bloquear, recarregar, contexto, salvarAgora, verRender, ativa: () => !!s.t, estado: s, irPara, dividir, excluir, adicionarTexto, gerarLegendas };
})();
