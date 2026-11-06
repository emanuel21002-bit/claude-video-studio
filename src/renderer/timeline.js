// Timeline editável e prévia ao vivo dos projetos Remotion. O dado é o timeline.json do projeto,
// o mesmo que o Claude edita e que o render lê.

const TL = (() => {
  const LARGURA_CAB = 120;
  // Como no Filmcraft e no CapCut: faixas de vídeo (V1 embaixo, as de cima cobrem as de baixo) e de áudio (A1, A2…).
  // Qualquer item visual cabe em qualquer faixa de vídeo. sobreposicao e legenda são tipos antigos, tratados como vídeo.
  const VISUAIS = ['video', 'imagem', 'texto', 'bloco', 'legenda'];
  const ACEITA = { video: VISUAIS, sobreposicao: VISUAIS, legenda: VISUAIS, audio: ['audio'] };
  const ehAudio = (tr) => tr.tipo === 'audio';
  // Faixa com vídeo ou imagem mostra miniaturas: fica mais alta que as de texto e legenda.
  const alturaDe = (tr) => (ehAudio(tr) ? 44 : tr.itens.some((i) => i.tipo === 'video' || i.tipo === 'imagem') ? 54 : tr.itens.length ? 36 : 40);
  const FONTES = ['Montserrat', 'Inter', 'Poppins', 'Roboto', 'Anton', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Red Hat Display', 'Red Hat Text'];
  const ANIMACOES = ['', 'fade', 'slide-cima', 'slide-baixo', 'slide-esq', 'slide-dir', 'zoom', 'pop'];
  const MESCLAGENS = ['', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  const CURVAS = [['linear', 'Linear'], ['bezier', 'Suave'], ['easeOut', 'Sair suave'], ['easeIn', 'Chegar suave'], ['hold', 'Segurar']];
  const TRANSICOES = [['', 'Nenhuma'], ['cross_dissolve', 'Dissolver'], ['dip_to_black', 'Fade pelo preto'], ['dip_to_white', 'Fade pelo branco'], ['flash', 'Flash'], ['push', 'Empurrar'], ['whip', 'Chicote'], ['slide', 'Deslizar'], ['linear_wipe', 'Cortina'], ['iris_round', 'Íris'], ['cross_zoom', 'Zoom']];
  const MARGEM_ENCOSTO = 0.05;
  const EXT_ROTEIRO = /\.(pdf|docx|odt|txt|md|rtf)$/i;
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
    selecao: new Set(),
    projetoId: null,
    pps: 40,
    ima: true,
    ferramenta: 'selecao',
    camposKf: [],
    materiais: [],
    roteiros: [],
    midiaPedida: new Set(),
    pastasFechadas: new Set(),
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

  // V1, V2… na ordem das faixas de vídeo em trilhas (V1 é a camada de baixo); A1, A2… nas de áudio.
  function codigoDe(tr) {
    const mesmas = s.t.trilhas.filter((x) => ehAudio(x) === ehAudio(tr));
    return (ehAudio(tr) ? 'A' : 'V') + (mesmas.indexOf(tr) + 1);
  }

  // Faixa nova: a de vídeo entra logo acima da mais alta que tem vídeo ou imagem (abaixo de textos e legendas);
  // a de áudio, no fim.
  function novaFaixa(tipo, { acimaDeTudo = false } = {}) {
    const nova = { id: novoId(), tipo, itens: [] };
    if (tipo === 'audio') s.t.trilhas.push(nova);
    else {
      const tipos = s.t.trilhas.map((tr) => (ehAudio(tr) ? 'audio' : 'video'));
      const comMidia = s.t.trilhas.map((tr, n) => (!ehAudio(tr) && tr.itens.some((i) => i.tipo === 'video' || i.tipo === 'imagem') ? n : -1));
      const pos = acimaDeTudo ? tipos.lastIndexOf('video') : Math.max(...comMidia, tipos.indexOf('video'));
      s.t.trilhas.splice(pos + 1, 0, nova);
    }
    return nova;
  }

  // Itens com o mesmo vínculo são o vídeo e o áudio do mesmo trecho: andam, são aparados e apagados juntos.
  const parceiros = (id) => {
    const i = todosItens().find((x) => x.id === id);
    return i?.vinculo ? todosItens().filter((x) => x.vinculo === i.vinculo && x.id !== id) : [];
  };

  // ---------- guardar e desfazer ----------

  function salvarDepois() {
    clearTimeout(s.timerSalvar);
    s.timerSalvar = setTimeout(salvarAgora, 600);
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

  // Cada passo guarda a timeline inteira, com as palavras das legendas: sem limite, a memória só cresce.
  function empilharDesfazer(estadoAnterior) {
    s.desfazer.push(estadoAnterior);
    if (s.desfazer.length > 60) s.desfazer.shift();
    s.refazer = [];
  }

  function guardarEstado() {
    empilharDesfazer(JSON.stringify(s.t));
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
    gerarProxies(s.id);
  }

  function trocarEstado(de, para) {
    if (s.bloqueada || !de.length) return;
    para.push(JSON.stringify(s.t));
    s.t = JSON.parse(de.pop());
    if (!itemSel()) s.sel = null;
    aposAlterar();
  }

  // ---------- prévia ----------

  // Várias edições no mesmo quadro (um campo sendo arrastado, por exemplo) viram uma atualização só.
  let previaAgendada = false;
  function atualizarPrevia() {
    if (previaAgendada) return;
    previaAgendada = true;
    requestAnimationFrame(() => {
      previaAgendada = false;
      if (s.t) s.previa?.ref.current?.atualizar(clonar(s.t));
    });
  }

  // Cada execução do pacote da prévia (React e Remotion inteiros) deixa cerca de 1 MB preso na memória.
  // Por isso cada versão roda uma vez só, e trocar de timeline reaproveita.
  const pacotes = new Map();
  const MAX_PACOTES = 8;
  async function carregarPacote(info) {
    if (pacotes.has(info.versao)) return pacotes.get(info.versao);
    await new Promise((ok, falha) => {
      const script = document.createElement('script');
      script.src = urlArquivo(info.arquivo) + '?v=' + info.versao;
      script.onload = ok;
      script.onerror = () => falha(new Error('script da prévia'));
      document.head.append(script);
      script.addEventListener('load', () => script.remove());
    });
    pacotes.set(info.versao, window.PreviaTimeline);
    if (pacotes.size > MAX_PACOTES) pacotes.delete(pacotes.keys().next().value);
    return window.PreviaTimeline;
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
    const pacote = await carregarPacote(info);
    if (s.id !== idAberto) return;
    s.proxies = Object.fromEntries(Object.entries(info.proxies).map(([a, c]) => [a, c && urlArquivo(c)]));
    s.pastaAssets = info.assets;
    desenharMateriais();
    const raiz = document.createElement('div');
    raiz.className = 'previa-raiz';
    host.append(raiz);
    s.previa = pacote.montar(raiz, {
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

  // O cursor anda na hora; o player busca no máximo uma vez por quadro, sempre a posição mais recente.
  let buscaAgendada = false;
  function irPara(seg) {
    s.tempo = Math.max(0, Math.min(seg, duracaoTotal()));
    verPrevia();
    desenharCursor();
    if (buscaAgendada) return;
    buscaAgendada = true;
    requestAnimationFrame(() => {
      buscaAgendada = false;
      if (s.t) s.previa?.ref.current?.irPara(Math.round(s.tempo * fps()));
    });
  }

  // O player mostra a prévia ao vivo ou o arquivo renderizado.
  function verPrevia() {
    if (!qs('#previa-host').hidden && qs('#player').hidden && qs('#player-vazio').hidden) return;
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
    normalizarSelecao();
    const larguraConteudo = LARGURA_CAB + duracaoTotal() * s.pps + 400;
    const conteudo = qs('#tl-conteudo');
    conteudo.style.width = larguraConteudo + 'px';
    desenharRegua();
    const canto = qs('#tl-regua-linha .tl-canto');
    if (canto && !canto.children.length) {
      for (const [tipo, rotulo, dica] of [['video', '+V', 'Nova faixa de vídeo'], ['audio', '+A', 'Nova faixa de áudio']]) {
        const b = document.createElement('button');
        b.className = 'tl-nova-faixa';
        b.textContent = rotulo;
        b.title = dica;
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.onclick = () => alterar(() => novaFaixa(tipo, { acimaDeTudo: true }));
        canto.append(b);
      }
    }
    canto?.querySelectorAll('button').forEach((b) => (b.disabled = s.bloqueada));
    const box = qs('#tl-trilhas');
    obsMiniaturas.disconnect();
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
    const alturaFaixa = alturaDe(trilha);
    const linha = document.createElement('div');
    linha.className = `tl-linha tipo-${ehAudio(trilha) ? 'audio' : 'video'}`;
    linha.style.height = alturaFaixa * total + 'px';

    const cab = document.createElement('div');
    cab.className = 'tl-cab';
    const audio = ehAudio(trilha);
    const codigo = document.createElement('span');
    codigo.className = 'tl-codigo' + (audio ? ' audio' : '');
    codigo.textContent = codigoDe(trilha);
    const nome = document.createElement('span');
    nome.className = 'tl-nome';
    nome.textContent = trilha.nome ?? (audio ? 'Áudio ' : 'Vídeo ') + codigo.textContent.slice(1);
    nome.title = nome.textContent;
    const botao = document.createElement('button');
    const desligada = audio ? trilha.muda : trilha.oculta;
    botao.textContent = audio ? (desligada ? '🔇' : '🔊') : desligada ? '🚫' : '👁';
    botao.title = audio ? 'Silenciar trilha' : 'Ocultar trilha';
    botao.onclick = () =>
      alterar(() => {
        if (audio) trilha.muda = !trilha.muda;
        else trilha.oculta = !trilha.oculta;
      });
    cab.append(codigo, nome, botao);
    // Faixa vazia pode sair, desde que fique pelo menos uma de cada tipo.
    if (!trilha.itens.length && s.t.trilhas.filter((x) => ehAudio(x) === audio).length > 1) {
      const tirar = document.createElement('button');
      tirar.className = 'tl-tirar-faixa';
      tirar.textContent = '×';
      tirar.title = 'Remover esta faixa vazia';
      tirar.onclick = () => alterar(() => s.t.trilhas.splice(s.t.trilhas.indexOf(trilha), 1));
      cab.append(tirar);
    }

    const pista = document.createElement('div');
    pista.className = 'tl-pista';
    pista.dataset.trilha = trilha.id;
    pista.addEventListener('pointerdown', (e) => {
      if (e.target !== pista || e.button !== 0) return;
      iniciarMarquee(e);
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
    el.className = `tl-item item-${item.tipo}` + (s.selecao.has(item.id) ? ' selecionado' : '');
    el.dataset.id = item.id;
    posicionar(el, item);
    desenharMidia(el, item, alturaDe(trilha));
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
    if (m.onda && item.tipo === 'audio') {
      const fundo = document.createElement('div');
      fundo.className = 'tl-onda';
      fundo.style.backgroundImage = `url("${urlArquivo(m.onda)}")`;
      fundo.style.backgroundSize = `${(m.duracao / vel) * s.pps}px 100%`;
      fundo.style.backgroundPosition = `${(-corte / vel) * s.pps}px 0`;
      // A força do traço mostra o volume do item.
      fundo.style.opacity = Math.max(0.25, Math.min(1, item.volume ?? 1));
      el.append(fundo);
    } else if (m.tira && item.tipo !== 'audio') {
      const larguraMini = (m.larguraQuadro / m.altura) * altura;
      const larguraItem = item.duracao * s.pps;
      const tira = document.createElement('div');
      tira.className = 'tl-tira';
      el.append(tira);
      // Só cria os quadros quando o clipe chega perto da área visível: com zoom alto seriam milhares de elementos.
      el.pintarTira = () => {
        const imagem = urlArquivo(m.tira);
        const quadros = document.createDocumentFragment();
        for (let x = 0; x < larguraItem && x < 6000; x += larguraMini) {
          const seg = corte + (x / s.pps) * vel;
          const quadro = Math.min(m.quadros - 1, Math.floor(seg / m.passo));
          const mini = document.createElement('div');
          mini.style.cssText = `width:${larguraMini}px;background-image:url("${imagem}");background-size:${m.quadros * larguraMini}px 100%;background-position:${-quadro * larguraMini}px 0`;
          quadros.append(mini);
        }
        tira.append(quadros);
      };
      obsMiniaturas.observe(el);
    }
  }

  const obsMiniaturas = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        obsMiniaturas.unobserve(e.target);
        e.target.pintarTira?.();
      }
    },
    { root: qs('#tl-corpo'), rootMargin: '0px 600px' },
  );

  // A miniatura de um arquivo ficou pronta: entra nos clipes dele e no cartão, sem redesenhar a timeline.
  // Redesenhar a cada arquivo também soltaria um clipe que o usuário estivesse arrastando.
  function pintarMidia(arquivo) {
    for (const tr of s.t.trilhas) {
      for (const item of tr.itens) {
        if (item.arquivo !== arquivo) continue;
        const el = qs(`.tl-item[data-id="${CSS.escape(item.id)}"]`);
        if (!el || el.querySelector('.tl-tira, .tl-onda')) continue;
        desenharMidia(el, item, alturaDe(tr));
        const nova = el.querySelector('.tl-tira, .tl-onda');
        if (nova) el.prepend(nova);
      }
    }
    const mini = qs(`#materiais .material[data-arquivo="${CSS.escape(arquivo)}"] .material-mini`);
    const m = materialDe(arquivo);
    if (mini && m) pintarMini(mini, m);
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
        empilharDesfazer(antes);
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

  // Roda a cada quadro tocando. transform move o cursor sem recalcular o layout da timeline inteira.
  const cursorEl = qs('#tl-cursor');
  const tempoEl = qs('#tl-tempo');
  function desenharCursor() {
    if (!s.t) return;
    cursorEl.style.transform = `translateX(${LARGURA_CAB + s.tempo * s.pps}px)`;
    atualizarCamposKf();
    const texto = formatarTempo(s.tempo);
    if (tempoEl.textContent !== texto) tempoEl.textContent = texto;
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

  // A seleção pode ter vários itens: s.sel é o principal (o do inspetor) e s.selecao guarda todos.
  function normalizarSelecao() {
    const existentes = new Set(todosItens().map((i) => i.id));
    for (const id of [...s.selecao]) if (!existentes.has(id)) s.selecao.delete(id);
    if (s.sel && !existentes.has(s.sel)) s.sel = null;
    if (s.sel && !s.selecao.has(s.sel)) s.selecao = new Set([s.sel]);
    if (!s.sel) s.sel = [...s.selecao].at(-1) ?? null;
  }

  function atualizarSelecaoNaTela() {
    if (s.sel) mostrarAba('inspetor');
    document.querySelectorAll('.tl-item').forEach((el) => el.classList.toggle('selecionado', s.selecao.has(el.dataset.id)));
    qs('#tl-excluir').disabled = !s.selecao.size || s.bloqueada;
    qs('#tl-copiar').disabled = !s.selecao.size;
    desenharInspetor();
  }

  // alternar: Ctrl ou Shift + clique liga e desliga um item sem tirar os outros.
  function selecionar(id, { alternar = false } = {}) {
    if (alternar && id) {
      if (s.selecao.has(id)) {
        s.selecao.delete(id);
        if (s.sel === id) s.sel = [...s.selecao].at(-1) ?? null;
      } else {
        s.selecao.add(id);
        s.sel = id;
      }
    } else {
      const nova = id ? [id, ...parceiros(id).map((p) => p.id)] : [];
      if (s.sel === id && s.selecao.size === nova.length && nova.every((x) => s.selecao.has(x))) return;
      s.sel = id;
      s.selecao = new Set(nova);
    }
    atualizarSelecaoNaTela();
  }

  function selecionarVarios(ids) {
    const chave = [...ids].sort().join('|');
    if (chave === [...s.selecao].sort().join('|')) return;
    s.selecao = new Set(ids);
    s.sel = ids.at(-1) ?? null;
    atualizarSelecaoNaTela();
  }

  // Arrastar num espaço vazio das trilhas desenha um retângulo e seleciona o que ele toca.
  // Sem arrastar, é o clique de sempre: tira a seleção e leva o cursor até ali.
  function iniciarMarquee(e) {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const somar = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = somar ? [...s.selecao] : [];
    let caixa = null;
    let moveu = false;
    const mover = (ev) => {
      if (!moveu && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moveu = true;
      if (!caixa) {
        caixa = document.createElement('div');
        caixa.className = 'tl-marquee';
        document.body.append(caixa);
      }
      const x = Math.min(x0, ev.clientX);
      const y = Math.min(y0, ev.clientY);
      const w = Math.abs(ev.clientX - x0);
      const h = Math.abs(ev.clientY - y0);
      Object.assign(caixa.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      const ids = new Set(base);
      document.querySelectorAll('.tl-item').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right >= x && r.left <= x + w && r.bottom >= y && r.top <= y + h) ids.add(el.dataset.id);
      });
      selecionarVarios([...ids]);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      caixa?.remove();
      if (moveu) return;
      if (!somar) selecionar(null);
      irPara(tempoDoEvento(e));
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  // Move todos os itens selecionados juntos, mantendo a distância entre eles.
  function arrastarGrupo(e, principal) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const antes = JSON.stringify(s.t);
    const membros = todosItens()
      .filter((i) => s.selecao.has(i.id))
      .map((i) => ({ i, inicio: i.inicio, el: qs(`.tl-item[data-id="${CSS.escape(i.id)}"]`) }));
    const menor = Math.min(...membros.map((m) => m.inicio));
    const pontos = [0, s.tempo];
    for (const i of todosItens()) if (!s.selecao.has(i.id)) pontos.push(i.inicio, i.inicio + i.duracao);
    const ref = membros.find((m) => m.i === principal);
    let mudou = false;
    const aoMover = (ev) => {
      if (Math.abs(ev.clientX - x0) > 2) mudou = true;
      if (!mudou) return;
      let delta = Math.max(-menor, (ev.clientX - x0) / s.pps);
      const a = imantar(ref.inicio + delta, pontos);
      const b = imantar(ref.inicio + delta + principal.duracao, pontos);
      const peloFim = b.guia != null && (a.guia == null || Math.abs(b.valor - (ref.inicio + delta + principal.duracao)) < Math.abs(a.valor - (ref.inicio + delta)));
      delta = (peloFim ? b.valor - principal.duracao : a.valor) - ref.inicio;
      mostrarGuia(peloFim ? b.guia : a.guia);
      delta = Math.max(-menor, noQuadro(delta));
      for (const m of membros) {
        m.i.inicio = arredondar(m.inicio + delta);
        if (m.el) posicionar(m.el, m.i);
      }
    };
    const aoSoltar = () => {
      el.removeEventListener('pointermove', aoMover);
      el.removeEventListener('pointerup', aoSoltar);
      el.removeEventListener('pointercancel', aoSoltar);
      mostrarGuia(null);
      // Clicar num item do grupo, sem arrastar, deixa só ele selecionado.
      if (!mudou) return selecionar(principal.id);
      empilharDesfazer(antes);
      aposAlterar();
    };
    el.addEventListener('pointermove', aoMover);
    el.addEventListener('pointerup', aoSoltar);
    el.addEventListener('pointercancel', aoSoltar);
  }

  // ---------- copiar e colar ----------

  // Fora de s para sobreviver à troca de timeline: dá para copiar numa e colar noutra.
  let areaTransferencia = null;

  function copiarSelecao() {
    const itens = todosItens().filter((i) => s.selecao.has(i.id));
    if (!itens.length) return false;
    const base = Math.min(...itens.map((i) => i.inicio));
    areaTransferencia = {
      projeto: s.projetoId,
      itens: itens.map((i) => {
        const tr = trilhaDe(i.id);
        return { item: clonar(i), trilhaId: tr.id, trilhaTipo: tr.tipo, desloc: arredondar(i.inicio - base) };
      }),
    };
    qs('#tl-colar').disabled = s.bloqueada;
    avisar(`${itens.length} ${itens.length > 1 ? 'itens copiados' : 'item copiado'}. Ctrl+V cola no cursor, também em outra timeline.`);
    return true;
  }

  // Cola na mesma trilha de onde veio; se ela não existe aqui, na primeira do mesmo tipo que aceite o item.
  function trilhaParaColar(c) {
    const aceita = (tr) => ACEITA[tr.tipo].includes(c.item.tipo);
    return (
      s.t.trilhas.find((tr) => tr.id === c.trilhaId && aceita(tr)) ??
      s.t.trilhas.find((tr) => tr.tipo === c.trilhaTipo && aceita(tr)) ??
      s.t.trilhas.find(aceita)
    );
  }

  function colarSelecao() {
    if (s.bloqueada || !areaTransferencia) return;
    const t0 = noQuadro(s.tempo);
    const plano = [];
    let semMidia = 0;
    // No mesmo projeto os arquivos são os mesmos (áudio de narração, trilha, decupado…), estejam ou não na lista de materiais.
    const mesmoProjeto = !!s.projetoId && areaTransferencia.projeto === s.projetoId;
    // O que foi colado ganha vínculos novos: senão ficaria preso ao original.
    const vinculos = {};
    for (const c of areaTransferencia.itens) {
      // Mídia de outro projeto não está nos materiais deste: o item não teria o que mostrar.
      if (c.item.arquivo && !mesmoProjeto && !materialDe(c.item.arquivo) && !s.midia[c.item.arquivo]) {
        semMidia++;
        continue;
      }
      const tr = trilhaParaColar(c);
      if (!tr) continue;
      const novo = clonar(c.item);
      novo.id = novoId();
      novo.inicio = arredondar(t0 + c.desloc);
      if (novo.vinculo) novo.vinculo = vinculos[novo.vinculo] ??= 'k' + novoId();
      plano.push([tr, novo]);
    }
    if (!plano.length) return avisar(semMidia ? 'A mídia copiada não existe neste projeto: importe os arquivos nele primeiro.' : 'Nada para colar aqui.');
    alterar(() => plano.forEach(([tr, novo]) => tr.itens.push(novo)));
    selecionarVarios(plano.map(([, novo]) => novo.id));
    // Miniaturas e forma de onda dos itens colados (áudio inclusive) podem não ter sido lidas nesta timeline.
    carregarMidia();
    avisar(`${plano.length} ${plano.length > 1 ? 'itens colados' : 'item colado'} no cursor.` + (semMidia ? ` ${semMidia} ficou de fora: a mídia não existe neste projeto.` : ''));
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
    const elementos = new Map(trilha.itens.map((i) => [i.id, qs(`.tl-item[data-id="${CSS.escape(i.id)}"]`)]));
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
        const alvo = elementos.get(i.id);
        if (alvo) posicionar(alvo, i);
      }
    };
    const aoSoltar = () => {
      el.removeEventListener('pointermove', aoMover);
      el.removeEventListener('pointerup', aoSoltar);
      el.removeEventListener('pointercancel', aoSoltar);
      mostrarGuia(null);
      if (!mudou) return;
      empilharDesfazer(antes);
      aposAlterar();
    };
    el.addEventListener('pointermove', aoMover);
    el.addEventListener('pointerup', aoSoltar);
    el.addEventListener('pointercancel', aoSoltar);
  }

  function iniciarArraste(e, item, trilha, modo) {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Ctrl ou Shift + clique liga e desliga o item na seleção.
    if (e.ctrlKey || e.metaKey || e.shiftKey) return selecionar(item.id, { alternar: true });
    // Alt + clique pega só este item, sem o vídeo ou o áudio vinculado.
    const sozinho = e.altKey;
    let grupo = !sozinho && s.selecao.has(item.id) && s.selecao.size > 1 && s.ferramenta === 'selecao' && modo === 'mover';
    if (sozinho) {
      s.sel = item.id;
      s.selecao = new Set([item.id]);
      atualizarSelecaoNaTela();
    } else if (!grupo) {
      selecionar(item.id);
      grupo = s.selecao.size > 1 && s.ferramenta === 'selecao' && modo === 'mover';
    }
    if (s.bloqueada) return;
    if (s.ferramenta === 'navalha') {
      const c = noQuadro(imantar(tempoDoEvento(e), pontosDeImã(item.id)).valor);
      alterar(() => {
        dividirItem(item, trilha, c);
        if (!sozinho) for (const p of parceiros(item.id)) dividirItem(p, trilhaDe(p.id), c);
      });
      return;
    }
    const f = s.ferramenta;
    const naBorda = modo !== 'mover';
    if ((f === 'ripple' || f === 'roll' || f === 'taxa') && naBorda) return iniciarFerramenta(e, item, trilha, modo);
    if ((f === 'slip' || f === 'slide') && !naBorda) return iniciarFerramenta(e, item, trilha, modo);
    if (grupo) return arrastarGrupo(e, item);
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
      // Aparar um lado do vínculo apara o outro igual.
      if (modo !== 'mover' && !sozinho) {
        for (const p of parceiros(item.id)) {
          p.inicio = item.inicio;
          p.duracao = item.duracao;
          if (item.corteInicio != null && (p.tipo === 'video' || p.tipo === 'audio')) p.corteInicio = item.corteInicio;
        }
      }
      if (destino !== trilha) {
        trilha.itens.splice(trilha.itens.indexOf(item), 1);
        destino.itens.push(item);
        // Transição só existe entre itens da mesma trilha.
        trilha.transicoes = (trilha.transicoes ?? []).filter((x) => x.de !== item.id && x.para !== item.id);
        if (!trilha.transicoes.length) delete trilha.transicoes;
      }
      empilharDesfazer(antes);
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
    // Os dois lados de um vínculo divididos no mesmo ponto continuam vinculados entre si.
    if (item.vinculo) novo.vinculo = `${item.vinculo}@${arredondar(c)}`;
    dividirKeyframes(item, novo, offset);
    for (const x of trilha.transicoes ?? []) if (x.de === item.id) x.de = novo.id;
    trilha.itens.splice(trilha.itens.indexOf(item) + 1, 0, novo);
    return true;
  }

  // Divide o item selecionado; sem seleção, tudo o que está sob o cursor.
  function dividir() {
    const c = s.tempo;
    const noCursor = (i) => i.inicio < c && i.inicio + i.duracao > c;
    const selecionados = todosItens().filter((i) => s.selecao.has(i.id) && noCursor(i));
    const alvos = selecionados.length
      ? selecionados.map((i) => [i, trilhaDe(i.id)])
      : s.t.trilhas.flatMap((tr) => tr.itens.filter(noCursor).map((i) => [i, tr]));
    if (!alvos.length) return;
    alterar(() => alvos.forEach(([i, tr]) => dividirItem(i, tr, c)));
  }

  function excluir(fecharVao) {
    // Do último para o primeiro: fechar o vão de um item não desloca os que ainda faltam apagar.
    const alvos = todosItens().filter((i) => s.selecao.has(i.id)).sort((a, b) => b.inicio - a.inicio);
    if (!alvos.length) return;
    alterar(() => {
      for (const item of alvos) {
        const trilha = trilhaDe(item.id);
        trilha.itens.splice(trilha.itens.indexOf(item), 1);
        if (trilha.transicoes) {
          trilha.transicoes = trilha.transicoes.filter((x) => x.de !== item.id && x.para !== item.id);
          if (!trilha.transicoes.length) delete trilha.transicoes;
        }
        if (fecharVao) {
          for (const i of trilha.itens) if (i.inicio >= item.inicio + item.duracao - 0.001) i.inicio = arredondar(i.inicio - item.duracao);
        }
      }
      s.sel = null;
      s.selecao = new Set();
    });
  }

  function adicionarTexto() {
    const livres = s.t.trilhas.filter((tr) => !ehAudio(tr) && !tr.itens.some((i) => ['video', 'imagem', 'legenda'].includes(i.tipo)));
    const item = {
      id: novoId(), tipo: 'texto', inicio: arredondar(s.tempo), duracao: 3, texto: 'Texto',
      estilo: { fonte: 'Montserrat', tamanho: Math.round(s.t.largura * 0.08), peso: 800, cor: '#ffffff' },
      x: 0, y: 0, entrada: { tipo: 'fade', duracao: 0.3 },
    };
    alterar(() => {
      const trilha = livres[0] ?? novaFaixa('video', { acimaDeTudo: true });
      trilha.itens.push(item);
      s.sel = item.id;
      s.selecao = new Set([item.id]);
    });
  }

  // Importa para a aba Materiais sem mexer na timeline.
  // Documento solto junto com os materiais é roteiro. Devolve o resto.
  function separarRoteiros(caminhos) {
    const documentos = caminhos.filter((c) => EXT_ROTEIRO.test(c));
    if (documentos.length) enviarRoteiros(documentos);
    return caminhos.filter((c) => !EXT_ROTEIRO.test(c));
  }

  async function enviarRoteiros(caminhos) {
    if (!caminhos.length || s.bloqueada) return;
    const id = s.id;
    avisar('Lendo o roteiro…');
    try {
      const { roteiros, erros } = await api.adicionarRoteiros({ id, caminhos });
      if (s.id !== id) return;
      s.roteiros = roteiros;
      desenharMateriais();
      avisar(erros.length ? 'Não li: ' + erros.join('; ') : 'Roteiro enviado. Clique em "Gerar legendas" para refazê-las com ele.');
    } catch (e) {
      avisar('Não li o roteiro: ' + e.message.split('\n').at(-1));
    }
  }

  async function adicionarAoProjeto(todos) {
    const caminhos = separarRoteiros(todos);
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
  async function adicionarArquivos(todos) {
    const caminhos = separarRoteiros(todos);
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
    s.projetoId = p.projetoId ?? s.projetoId;
    // As narrações das outras timelines também ficam à mão, numa pasta própria.
    const narracoes = (p.narracoes ?? []).filter((n) => n.arquivo !== p.narracao?.arquivo).map((n) => ({ ...n, tipo: 'audio', pasta: 'Narrações' }));
    s.materiais = [...p.materiais, ...(p.narracao ? [{ ...p.narracao, tipo: 'audio' }] : []), ...narracoes];
    s.roteiros = p.roteiros ?? [];
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

  // Monta a árvore a partir do campo pasta de cada material ("Feed/15.10").
  function arvoreDePastas(materiais) {
    const raiz = { nome: '', caminho: '', filhas: new Map(), itens: [] };
    for (const m of materiais) {
      let no = raiz;
      for (const nome of (m.pasta ?? '').split('/').filter(Boolean)) {
        if (!no.filhas.has(nome)) no.filhas.set(nome, { nome, caminho: no.caminho ? `${no.caminho}/${nome}` : nome, filhas: new Map(), itens: [] });
        no = no.filhas.get(nome);
      }
      no.itens.push(m);
    }
    return raiz;
  }

  const totalNaPasta = (no) => no.itens.length + [...no.filhas.values()].reduce((n, f) => n + totalNaPasta(f), 0);

  function desenharPastas(no, cartao) {
    const box = document.createElement('div');
    for (const filha of no.filhas.values()) {
      const fechada = s.pastasFechadas.has(filha.caminho);
      const titulo = document.createElement('button');
      titulo.className = 'material-pasta';
      titulo.dataset.pasta = filha.caminho;
      titulo.title = filha.caminho;
      titulo.textContent = `${fechada ? '▸' : '▾'} 📁 ${filha.nome} (${totalNaPasta(filha)})`;
      titulo.onclick = () => {
        if (fechada) s.pastasFechadas.delete(filha.caminho);
        else s.pastasFechadas.add(filha.caminho);
        desenharMateriais();
      };
      box.append(titulo);
      if (!fechada) {
        const dentro = desenharPastas(filha, cartao);
        dentro.className = 'material-dentro';
        box.append(dentro);
      }
    }
    if (no.itens.length) {
      const grade = document.createElement('div');
      grade.className = 'materiais-grade';
      for (const m of no.itens) grade.append(cartao(m));
      box.append(grade);
    }
    return box;
  }

  function pintarMini(mini, m) {
    const midia = s.midia[m.arquivo];
    mini.classList.toggle('com-capa', m.tipo === 'imagem' || !!midia?.capa);
    if (m.tipo === 'imagem' && s.pastaAssets) mini.style.backgroundImage = `url("${urlArquivo(s.pastaAssets + '/' + m.arquivo)}")`;
    else if (midia?.capa) {
      mini.textContent = '';
      mini.style.backgroundImage = `url("${urlArquivo(midia.capa)}")`;
      mini.style.backgroundSize = '';
      mini.style.backgroundPosition = '';
    } else if (midia?.tira) {
      mini.textContent = '';
      mini.style.backgroundImage = `url("${urlArquivo(midia.tira)}")`;
      mini.style.backgroundSize = `${midia.quadros * 100}% 100%`;
      mini.style.backgroundPosition = '0 0';
    } else if (midia?.onda) {
      mini.textContent = '';
      mini.style.backgroundImage = `url("${urlArquivo(midia.onda)}")`;
      mini.style.backgroundSize = '100% 100%';
    } else mini.textContent = ICONES[m.tipo] ?? '';
  }

  // Passar o mouse pelo cartão do vídeo folheia os quadros, como no CapCut: a posição do mouse é o momento do vídeo.
  function folhear(mini, m, e) {
    const p = s.midia[m.arquivo]?.previa;
    const r = mini.getBoundingClientRect();
    const frac = Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width));
    let linha = mini.querySelector('.mini-linha');
    if (!linha) {
      linha = document.createElement('div');
      linha.className = 'mini-linha';
      mini.append(linha);
    }
    linha.style.left = frac * 100 + '%';
    let rotulo = mini.querySelector('.mini-tempo');
    if (!rotulo && m.duracao) {
      rotulo = document.createElement('div');
      rotulo.className = 'mini-tempo';
      mini.append(rotulo);
    }
    if (rotulo) rotulo.textContent = formatarTempo(frac * m.duracao);
    if (!p) return;
    let q = mini.querySelector('.mini-folhear');
    if (!q) {
      q = document.createElement('div');
      q.className = 'mini-folhear';
      mini.prepend(q);
    }
    // Cabe inteiro no cartão (sem esticar), centralizado.
    const a = p.largura / p.altura;
    const w = Math.min(r.width, r.height * a);
    const h = w / a;
    const n = Math.floor(frac * p.quadros);
    q.style.cssText = `width:${w}px;height:${h}px;left:${(r.width - w) / 2}px;top:${(r.height - h) / 2}px;background-image:url("${urlArquivo(p.arquivo)}");background-size:${p.quadros * w}px ${h}px;background-position:${-n * w}px 0`;
  }

  function pararFolhear(mini) {
    mini.querySelectorAll('.mini-folhear, .mini-linha, .mini-tempo').forEach((x) => x.remove());
  }

  // ---------- janela de origem (clique duplo no material), como o monitor Source do Filmcraft ----------

  const fonte = { m: null, entrada: 0, saida: 0, modo: 'ambos', el: null, sobre: false, anim: 0 };
  const urlDaMidia = (arquivo) => s.proxies?.[arquivo] ?? (s.pastaAssets ? urlArquivo(s.pastaAssets + '/' + arquivo) : '');

  function criarFonte() {
    const box = document.createElement('div');
    box.id = 'fonte';
    box.className = 'fonte';
    box.hidden = true;
    box.innerHTML = `
      <div class="fonte-cab"><span class="fonte-titulo">Origem</span><span class="fonte-nome"></span><button type="button" class="fonte-fechar" title="Fechar (Esc)">×</button></div>
      <div class="fonte-tela"><video class="fonte-video" preload="auto" playsinline></video><img class="fonte-img" alt="" /><div class="fonte-onda"></div></div>
      <div class="fonte-trilho" title="Clique ou arraste para ir até o momento"><div class="fonte-faixa"></div><div class="fonte-cursor"></div></div>
      <div class="fonte-ctrl">
        <span class="fonte-tempo">00:00.00</span>
        <div class="fonte-botoes">
          <button type="button" data-a="entrada" title="Marcar entrada (I)">{</button>
          <button type="button" data-a="voltar" title="Voltar um quadro">‹</button>
          <button type="button" data-a="tocar" title="Tocar ou pausar (K)">▶</button>
          <button type="button" data-a="avancar" title="Avançar um quadro">›</button>
          <button type="button" data-a="saida" title="Marcar saída (O)">}</button>
        </div>
        <span class="fonte-dur"></span>
      </div>
      <div class="fonte-acoes">
        <div class="segmentado fonte-modo">
          <button type="button" data-v="ambos" title="O vídeo numa faixa V e o som dele numa faixa A, vinculados">Vídeo e áudio</button>
          <button type="button" data-v="video">Só vídeo</button>
          <button type="button" data-v="audio">Só áudio</button>
        </div>
        <div class="fonte-arrastar" draggable="true" title="Arraste o trecho marcado para uma faixa da timeline">⠿ Arrastar</div>
        <button type="button" class="primario" data-a="inserir" title="Insere o trecho marcado no cursor da timeline (,)">Inserir no cursor</button>
      </div>`;
    qs('.area-player').insertBefore(box, qs('.area-player .player'));
    const video = box.querySelector('.fonte-video');
    const tempoAtual = () => (fonte.m?.tipo === 'imagem' ? 0 : video.currentTime || 0);
    const ir = (t) => {
      if (fonte.m?.tipo === 'imagem') return;
      video.currentTime = Math.max(0, Math.min(fonte.m.duracao ?? 0, t));
      desenharFonte();
    };
    box.addEventListener('mouseenter', () => (fonte.sobre = true));
    box.addEventListener('mouseleave', () => (fonte.sobre = false));
    box.querySelector('.fonte-fechar').onclick = fecharFonte;
    const trilho = box.querySelector('.fonte-trilho');
    trilho.addEventListener('pointerdown', (e) => {
      if (!fonte.m || fonte.m.tipo === 'imagem') return;
      const r = trilho.getBoundingClientRect();
      const mover = (ev) => ir(((ev.clientX - r.left) / r.width) * (fonte.m.duracao ?? 0));
      mover(e);
      const soltar = () => {
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
      };
      window.addEventListener('pointermove', mover);
      window.addEventListener('pointerup', soltar);
    });
    box.querySelectorAll('.fonte-botoes button, .fonte-acoes button[data-a]').forEach((b) => {
      b.onclick = () => acaoFonte(b.dataset.a);
    });
    fonte.acao = (a) => {
      const um = 1 / (s.t?.fps || 30);
      if (a === 'entrada') {
        fonte.entrada = Math.min(tempoAtual(), Math.max(0, fonte.saida - um));
      } else if (a === 'saida') {
        fonte.saida = Math.max(tempoAtual(), fonte.entrada + um);
      } else if (a === 'tocar') {
        if (fonte.m?.tipo === 'imagem') return;
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      } else if (a === 'voltar') ir(tempoAtual() - um);
      else if (a === 'avancar') ir(tempoAtual() + um);
      else if (a === 'inserir') return inserirTrecho(fonte.m, trechoDaFonte(), s.tempo);
      desenharFonte();
    };
    video.addEventListener('play', () => {
      const passo = () => {
        desenharFonte();
        if (!video.paused) fonte.anim = requestAnimationFrame(passo);
      };
      passo();
    });
    video.addEventListener('pause', desenharFonte);
    video.addEventListener('loadedmetadata', desenharFonte);
    const pegar = box.querySelector('.fonte-arrastar');
    pegar.addEventListener('dragstart', (e) => {
      if (!fonte.m) return e.preventDefault();
      s.arrastando = { ...fonte.m, trecho: trechoDaFonte() };
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', fonte.m.arquivo);
    });
    pegar.addEventListener('dragend', () => {
      s.arrastando = null;
      limparAlvosDeSoltar();
    });
    fonte.el = box;
  }

  const acaoFonte = (a) => fonte.acao?.(a);
  const trechoDaFonte = () => ({ entrada: fonte.entrada, saida: fonte.saida, modo: fonte.modo });

  function modosDe(m) {
    if (m.tipo === 'audio') return ['audio'];
    if (m.tipo === 'imagem' || m.temAudio === false) return ['video'];
    return ['ambos', 'video', 'audio'];
  }

  function abrirFonte(m) {
    if (!fonte.el) criarFonte();
    const box = fonte.el;
    const video = box.querySelector('.fonte-video');
    const img = box.querySelector('.fonte-img');
    const onda = box.querySelector('.fonte-onda');
    fonte.m = m;
    fonte.entrada = 0;
    fonte.saida = m.tipo === 'imagem' ? 3 : m.duracao ?? 5;
    const modos = modosDe(m);
    if (!modos.includes(fonte.modo)) fonte.modo = modos[0];
    box.querySelectorAll('.fonte-modo button').forEach((b) => (b.disabled = !modos.includes(b.dataset.v)));
    segmentado(box.querySelector('.fonte-modo'), fonte.modo, (v) => (fonte.modo = v));
    box.querySelector('.fonte-nome').textContent = m.arquivo;
    box.querySelector('.fonte-nome').title = m.arquivo;
    video.pause();
    img.hidden = m.tipo !== 'imagem';
    video.hidden = m.tipo === 'imagem';
    onda.hidden = m.tipo !== 'audio';
    if (m.tipo === 'imagem') {
      video.removeAttribute('src');
      img.src = urlDaMidia(m.arquivo);
    } else {
      video.src = urlDaMidia(m.arquivo);
      video.currentTime = 0;
      const o = s.midia[m.arquivo]?.onda;
      onda.style.backgroundImage = o ? `url("${urlArquivo(o)}")` : '';
    }
    box.hidden = false;
    qs('.area-player').classList.add('com-fonte');
    desenharFonte();
  }

  function fecharFonte() {
    if (!fonte.el) return;
    const video = fonte.el.querySelector('.fonte-video');
    video.pause();
    video.removeAttribute('src');
    video.load();
    cancelAnimationFrame(fonte.anim);
    fonte.el.hidden = true;
    fonte.m = null;
    qs('.area-player').classList.remove('com-fonte');
  }

  function desenharFonte() {
    if (!fonte.m || !fonte.el) return;
    const box = fonte.el;
    const video = box.querySelector('.fonte-video');
    const dur = fonte.m.tipo === 'imagem' ? fonte.saida : fonte.m.duracao || 1;
    const t = fonte.m.tipo === 'imagem' ? 0 : video.currentTime || 0;
    box.querySelector('.fonte-cursor').style.left = (t / dur) * 100 + '%';
    const faixa = box.querySelector('.fonte-faixa');
    faixa.style.left = (fonte.entrada / dur) * 100 + '%';
    faixa.style.width = ((fonte.saida - fonte.entrada) / dur) * 100 + '%';
    box.querySelector('.fonte-tempo').textContent = formatarTempo(t);
    box.querySelector('.fonte-dur').textContent = `Trecho ${formatarTempo(fonte.saida - fonte.entrada)}`;
    box.querySelector('[data-a="tocar"]').textContent = video.paused ? '▶' : '❚❚';
    box.querySelector('[data-a="inserir"]').disabled = s.bloqueada;
  }

  // Atalhos da janela de origem com o mouse em cima dela: I e O marcam, K toca, setas andam um quadro, Esc fecha.
  function teclaDaFonte(e) {
    if (!fonte.m || !fonte.sobre || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.toLowerCase();
    const mapa = { i: 'entrada', o: 'saida', k: 'tocar', ' ': 'tocar', arrowleft: 'voltar', arrowright: 'avancar', ',': 'inserir' };
    if (k === 'escape') fecharFonte();
    else if (mapa[k]) acaoFonte(mapa[k]);
    else return false;
    e.preventDefault();
    return true;
  }

  // Põe o trecho marcado na timeline. Sem faixa pedida, vai na faixa de vídeo mais baixa (e na de áudio) que está
  // livre nesse intervalo; se nenhuma está, cria uma. Vídeo e áudio juntos ficam vinculados.
  function inserirTrecho(m, trecho, inicio, alvo) {
    if (!m || s.bloqueada) return;
    const dur = noQuadro(trecho.saida - trecho.entrada);
    if (!(dur > 0)) return avisar('Marque a saída depois da entrada.');
    const ini = noQuadro(Math.max(0, inicio));
    const fim = ini + dur;
    const livre = (tr) => !tr.itens.some((i) => i.inicio < fim - 0.001 && i.inicio + i.duracao > ini + 0.001);
    const faixa = (tipo) => {
      if (alvo && ehAudio(alvo) === (tipo === 'audio')) return alvo;
      const candidatas = s.t.trilhas.filter((tr) => ehAudio(tr) === (tipo === 'audio'));
      const ok = candidatas.find((tr) => livre(tr) && (tipo === 'audio' || !tr.itens.some((i) => ['texto', 'legenda', 'bloco'].includes(i.tipo))));
      return ok ?? novaFaixa(tipo);
    };
    const modo = modosDe(m).includes(trecho.modo) ? trecho.modo : modosDe(m)[0];
    const novos = [];
    alterar(() => {
      const vinculo = modo === 'ambos' ? 'k' + novoId() : undefined;
      const corte = arredondar(trecho.entrada);
      if (modo !== 'audio') {
        const item = { id: novoId(), tipo: m.tipo, arquivo: m.arquivo, inicio: ini, duracao: dur, ajuste: 'cover' };
        if (m.tipo === 'video') Object.assign(item, { corteInicio: corte, volume: 0 });
        if (vinculo) item.vinculo = vinculo;
        faixa('video').itens.push(item);
        novos.push(item.id);
      }
      if (modo !== 'video') {
        const item = { id: novoId(), tipo: 'audio', arquivo: m.arquivo, inicio: ini, duracao: dur, corteInicio: corte, volume: 1 };
        if (vinculo) item.vinculo = vinculo;
        faixa('audio').itens.push(item);
        novos.push(item.id);
      }
    });
    selecionarVarios(novos);
    carregarMidia();
  }

  function blocoRoteiro() {
    const box = document.createElement('div');
    box.className = 'materiais-roteiro';
    box.innerHTML = '<h5>Roteiro</h5><small>Base das legendas e da ordem das cenas, para todas as timelines do projeto.</small>';
    const lista = document.createElement('div');
    lista.className = 'lista-referencia';
    for (const r of s.roteiros) {
      const chip = document.createElement('div');
      chip.className = 'chip-referencia';
      chip.title = r.original ?? r.nome;
      chip.innerHTML = '<span></span><button type="button" title="Remover">×</button>';
      chip.querySelector('span').textContent = r.nome;
      chip.querySelector('button').onclick = async () => {
        if (s.bloqueada) return;
        s.roteiros = await api.removerRoteiro({ id: s.id, arquivo: r.arquivo });
        desenharMateriais();
      };
      lista.append(chip);
    }
    const enviar = document.createElement('button');
    enviar.textContent = '+ Enviar roteiro';
    enviar.title = 'PDF, Word ou texto. Pode ter os roteiros de vários áudios: cada áudio usa o trecho dele.';
    enviar.onclick = async () => enviarRoteiros(await api.escolher({ tipo: 'roteiro', multiplos: true }));
    box.append(enviar, lista);
    return box;
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
    box.append(importar, pasta, blocoRoteiro());
    const cartao = (m) => {
      const card = document.createElement('div');
      card.className = 'material';
      card.draggable = true;
      card.dataset.arquivo = m.arquivo;
      card.title = m.arquivo;
      const mini = document.createElement('div');
      mini.className = 'material-mini';
      pintarMini(mini, m);
      if (m.tipo !== 'imagem') {
        mini.addEventListener('mousemove', (e) => folhear(mini, m, e));
        mini.addEventListener('mouseleave', () => pararFolhear(mini));
      }
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
      // Duplo clique abre a janela de origem, para marcar o trecho e escolher vídeo, áudio ou os dois.
      card.addEventListener('dblclick', () => abrirFonte(m));
      return card;
    };
    box.append(desenharPastas(arvoreDePastas(s.materiais), cartao));
    const dica = document.createElement('div');
    dica.className = 'materiais-dica';
    dica.textContent = 'Passe o mouse num vídeo para folhear. Clique duas vezes para abrir na janela de origem e escolher o trecho. Arraste para uma faixa para adicionar, ou solte em cima de um clipe para substituir o arquivo dele.';
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
      if (!m.trecho && it?.arquivo && mesmoGrupo(it.tipo, m.tipo)) {
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
      const pista = e.target.closest('.tl-pista');
      const tr = pista && s.t.trilhas.find((x) => x.id === pista.dataset.trilha);
      if (m.trecho) return inserirTrecho(m, m.trecho, noQuadro(imantar(tempoDoEvento(e), pontosDeImã(null)).valor), tr);
      if (it?.arquivo && mesmoGrupo(it.tipo, m.tipo)) return substituirItem(it, m);
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
      const resumo = await api.legendasTimeline({ id: s.id });
      s.t = await api.lerTimeline(s.id);
      s.sel = null;
      atualizarPrevia();
      desenhar();
      avisar(resumo);
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
    if (s.selecao.size > 1) {
      box.dataset.item = 'varios';
      box.innerHTML = '<h4>' + s.selecao.size + ' itens selecionados</h4><dl class="tl-atalhos"><dt>Arrastar</dt><dd>move todos juntos</dd><dt>Ctrl+C / X / V</dt><dd>copiar, recortar, colar no cursor</dd><dt>Del</dt><dd>excluir todos</dd><dt>Ctrl+clique</dt><dd>liga ou desliga um item</dd><dt>Ctrl+A</dt><dd>seleciona tudo</dd></dl>';
      return;
    }
    const item = itemSel();
    if (!item) {
      box.innerHTML = `<h4>Atalhos</h4><dl class="tl-atalhos">
        <dt>Espaço</dt><dd>tocar / pausar</dd><dt>S</dt><dd>dividir no cursor</dd>
        <dt>Del</dt><dd>excluir</dd><dt>Shift+Del</dt><dd>excluir e fechar o vão</dd>
        <dt>Ctrl+clique</dt><dd>vários itens (ou arraste um retângulo)</dd><dt>Ctrl+C / X / V</dt><dd>copiar, recortar, colar</dd><dt>Ctrl+A</dt><dd>seleciona tudo</dd>
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
    if (trilhaDoItem && !ehAudio(trilhaDoItem)) box.append(secaoTransicao(item, trilhaDoItem));
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
    if (teclaDaFonte(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) trocarEstado(s.desfazer, s.refazer);
    else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) trocarEstado(s.refazer, s.desfazer);
    else if (ctrl && e.key.toLowerCase() === 'c') copiarSelecao();
    else if (ctrl && e.key.toLowerCase() === 'x') {
      if (copiarSelecao() && !s.bloqueada) excluir(false);
    } else if (ctrl && e.key.toLowerCase() === 'v') colarSelecao();
    else if (ctrl && e.key.toLowerCase() === 'a') selecionarVarios(todosItens().map((i) => i.id));
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
    qs('#tl-copiar').onclick = copiarSelecao;
    qs('#tl-colar').onclick = colarSelecao;
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
    // Roda e slider disparam muitas vezes por quadro: redesenha uma vez só, no valor mais recente.
    let zoomPedido = null;
    const pedirZoom = (pps, ancoraX) => {
      const agendado = !!zoomPedido;
      zoomPedido = { pps, ancoraX };
      if (agendado) return;
      requestAnimationFrame(() => {
        const { pps: p, ancoraX: a } = zoomPedido;
        zoomPedido = null;
        if (s.t) aplicarZoom(p, a);
      });
    };
    qs('#tl-zoom').oninput = (e) => pedirZoom(Math.exp(Number(e.target.value)));
    qs('#tl-corpo').addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const r = qs('#tl-corpo').getBoundingClientRect();
        pedirZoom((zoomPedido?.pps ?? s.pps) * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left);
      },
      { passive: false },
    );
    window.addEventListener('keydown', aoTeclar);
    areaDeSoltar(qs('#tl'), adicionarArquivos);
    areaDeSoltar(qs('#materiais'), adicionarAoProjeto);
    qs('#seg-player').querySelectorAll('button').forEach((b) => {
      b.onclick = () => (b.dataset.v === 'previa' ? verPrevia() : verRender());
    });
    // Divisor entre o painel (materiais e propriedades) e o player: arrastar alarga o painel e estreita o player.
    const area = qs('.area-player');
    const guardada = (() => {
      try {
        return Number(localStorage.getItem('painelLargura')) || null;
      } catch {
        return null;
      }
    })();
    const limitar = (w) => Math.max(180, Math.min(area.clientWidth - 260, w));
    if (guardada) area.style.setProperty('--painel-largura', limitar(guardada) + 'px');
    const divisorV = qs('#painel-divisor');
    divisorV.addEventListener('dblclick', () => {
      area.style.removeProperty('--painel-largura');
      try {
        localStorage.removeItem('painelLargura');
      } catch {}
    });
    divisorV.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const x0 = e.clientX;
      const l0 = qs('#painel-lateral').getBoundingClientRect().width;
      let ultima = l0;
      document.body.classList.add('redimensionando');
      const mover = (ev) => {
        ultima = limitar(l0 + ev.clientX - x0);
        area.style.setProperty('--painel-largura', ultima + 'px');
      };
      const soltar = () => {
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
        document.body.classList.remove('redimensionando');
        try {
          localStorage.setItem('painelLargura', String(Math.round(ultima)));
        } catch {}
      };
      window.addEventListener('pointermove', mover);
      window.addEventListener('pointerup', soltar);
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

  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const emOrdemNaTimeline = () => [...todosItens()].sort((a, b) => a.inicio - b.inicio).map((i) => i.arquivo).filter(Boolean);
  // Trabalho de fundo espera a prévia parar de tocar, para ela não engasgar.
  const esperarPrevia = async (id) => {
    while (s.tocando && s.id === id) await pausa(500);
  };

  // O que está na timeline primeiro, depois o resto dos materiais, um por vez.
  async function carregarMidia() {
    const id = s.id;
    const arquivos = [...new Set([...emOrdemNaTimeline(), ...s.materiais.map((m) => m.arquivo)])].filter((a) => !s.midia[a] && !s.midiaPedida.has(a));
    for (const arquivo of arquivos) s.midiaPedida.add(arquivo);
    // Primeiro o que a timeline mostra (miniaturas e ondas), para todos os arquivos; só depois as capas e as folhas de
    // quadros dos cartões, que levam mais tempo. Assim a timeline não espera pelos extras de cada material.
    for (const arquivo of arquivos) {
      await esperarPrevia(id);
      if (s.id !== id) return;
      const m = await api.midiaTimeline({ id, arquivo, extras: false }).catch(() => null);
      if (s.id !== id) return;
      if (m) {
        s.midia[arquivo] = { ...s.midia[arquivo], ...m };
        pintarMidia(arquivo);
        if (m.proxy && !s.proxies?.[arquivo]) {
          s.proxies = { ...s.proxies, [arquivo]: urlArquivo(m.proxy) };
          s.previa?.ref.current?.atualizarProxies(s.proxies);
        }
      }
    }
    gerarProxies(id);
    for (const arquivo of arquivos.filter((a) => s.midia[a]?.tipo === 'video')) {
      await esperarPrevia(id);
      if (s.id !== id) return;
      const m = await api.midiaTimeline({ id, arquivo, extras: true }).catch(() => null);
      if (s.id !== id) return;
      if (!m) continue;
      s.midia[arquivo] = { ...s.midia[arquivo], ...m };
      const mini = qs(`#materiais .material[data-arquivo="${CSS.escape(arquivo)}"] .material-mini`);
      const mat = materialDe(arquivo);
      if (mini && mat) pintarMini(mini, mat);
      // O som do vídeo numa faixa de áudio ganha a forma de onda.
      if (m.onda) for (const el of document.querySelectorAll('.tipo-audio .tl-item')) {
        const it = todosItens().find((i) => i.id === el.dataset.id);
        if (it?.arquivo === arquivo && !el.querySelector('.tl-onda')) {
          desenharMidia(el, it, 44);
          const nova = el.querySelector('.tl-onda');
          if (nova) el.prepend(nova);
        }
      }
    }
  }

  const proximoProxy = () => emOrdemNaTimeline().find((a) => s.midia[a]?.precisaProxy && !s.midia[a].proxyFeito);

  // Cópias leves (HDR, ProRes…): uma por vez, em segundo plano, e só do que está nesta timeline.
  // Fazer de todos os materiais do projeto ocupava a máquina por horas com vídeos que podem nem ser usados.
  // O material novo entra na fila quando vai para a timeline.
  let proxiesRodando = false;
  let proxiesDeNovo = false;
  async function gerarProxies(id) {
    if (proxiesRodando) {
      proxiesDeNovo = true;
      return;
    }
    if (s.id !== id || !proximoProxy()) return;
    proxiesRodando = true;
    try {
      await pausa(1500);
      while (s.id === id) {
        await esperarPrevia(id);
        if (s.id !== id) return;
        const arquivo = proximoProxy();
        if (!arquivo) return;
        s.midia[arquivo].proxyFeito = true;
        const caminho = await api.proxyTimeline({ id, arquivo }).catch(() => null);
        if (s.id !== id) return;
        if (caminho) {
          s.proxies = { ...s.proxies, [arquivo]: urlArquivo(caminho) };
          s.previa?.ref.current?.atualizarProxies(s.proxies);
        }
      }
    } finally {
      proxiesRodando = false;
      if (proxiesDeNovo) {
        proxiesDeNovo = false;
        if (s.id) gerarProxies(s.id);
      }
    }
  }

  async function abrir(p) {
    await fechar();
    s.id = p.id;
    s.projetoId = p.projetoId ?? null;
    s.selecao = new Set();
    s.midia = {};
    s.midiaPedida = new Set();
    s.pastasFechadas = new Set();
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
    qs('#painel-divisor').hidden = false;
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
    fecharFonte();
    await salvarAgora();
    desmontarPrevia();
    s.t = null;
    s.id = null;
    qs('#v-editor').classList.remove('com-timeline');
    qs('#tl').hidden = true;
    qs('#painel-lateral').hidden = true;
    qs('#painel-divisor').hidden = true;
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
      empilharDesfazer(JSON.stringify(s.t));
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

  // O vídeo sob o cursor, ou o primeiro: a capa da janela de exportação. A cópia leve abre sem pesar.
  function capa() {
    if (!s.t) return null;
    const videos = s.t.trilhas.filter((tr) => tr.tipo === 'video').flatMap((tr) => tr.itens).filter((i) => i.tipo === 'video');
    const item = videos.find((i) => s.tempo >= i.inicio && s.tempo < i.inicio + i.duracao) ?? videos[0];
    if (!item) return null;
    const url = s.proxies?.[item.arquivo] ?? (s.pastaAssets && urlArquivo(s.pastaAssets + '/' + item.arquivo));
    const dentro = Math.max(0, s.tempo - item.inicio);
    return url ? { url, tempo: (item.corteInicio ?? 0) + dentro * (item.velocidade ?? 1) } : null;
  }

  function contexto() {
    if (!s.t) return null;
    const item = itemSel();
    const partes = [`cursor em ${s.tempo.toFixed(2)} s de ${duracaoTotal().toFixed(2)} s`];
    if (item) partes.push(`item selecionado: id "${item.id}" (${item.tipo}${item.arquivo ? `, ${item.arquivo}` : ''}${item.texto ? `, "${item.texto}"` : ''}), de ${item.inicio.toFixed(2)} s a ${(item.inicio + item.duracao).toFixed(2)} s`);
    return partes.join('; ');
  }

  ligarControles();

  return { abrir, fechar, bloquear, recarregar, contexto, capa, salvarAgora, verRender, ativa: () => !!s.t, estado: s, irPara, dividir, excluir, adicionarTexto, gerarLegendas };
})();
