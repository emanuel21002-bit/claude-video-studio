// Timeline editável e prévia ao vivo dos projetos Remotion. O dado é o timeline.json do projeto,
// o mesmo que o Claude edita e que o render lê.

const TL = (() => {
  const LARGURA_CAB = 120;
  // Como no Filmcraft e no CapCut: faixas de vídeo (V1 embaixo, as de cima cobrem as de baixo) e de áudio (A1, A2…).
  // Qualquer item visual cabe em qualquer faixa de vídeo. sobreposicao e legenda são tipos antigos, tratados como vídeo.
  // ajuste: camada de ajuste, sem arquivo; os efeitos dela valem para tudo o que está nas faixas de vídeo abaixo.
  const VISUAIS = ['video', 'imagem', 'texto', 'bloco', 'legenda', 'ajuste'];
  const ACEITA = { video: VISUAIS, sobreposicao: VISUAIS, legenda: VISUAIS, audio: ['audio'] };
  const ehAudio = (tr) => tr.tipo === 'audio';
  // Faixa com vídeo ou imagem mostra miniaturas: fica mais alta que as de texto e legenda.
  const alturaPadrao = (tr) => (ehAudio(tr) ? 44 : tr.itens.some((i) => i.tipo === 'video' || i.tipo === 'imagem') ? 54 : tr.itens.length ? 36 : 40);
  // "altura" na faixa é só da tela: o usuário muda arrastando a borda de baixo do cabeçalho.
  const ALTURA_MIN = 22;
  const ALTURA_MAX = 200;
  const alturaDe = (tr) => Math.max(ALTURA_MIN, Math.min(ALTURA_MAX, tr.altura ?? alturaPadrao(tr)));
  const FONTES = ['Montserrat', 'Inter', 'Poppins', 'Roboto', 'Anton', 'Bebas Neue', 'Cal Sans', 'Oswald', 'Playfair Display', 'Red Hat Display', 'Red Hat Text'];
  const ANIMACOES = ['', 'fade', 'slide-cima', 'slide-baixo', 'slide-esq', 'slide-dir', 'zoom', 'pop'];
  const MESCLAGENS = ['', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  const CURVAS = [['linear', 'Linear'], ['bezier', 'Suave'], ['easeOut', 'Sair suave'], ['easeIn', 'Chegar suave'], ['hold', 'Segurar']];
  const TRANSICOES = [['', 'Nenhuma'], ['cross_dissolve', 'Dissolver'], ['dip_to_black', 'Fade pelo preto'], ['dip_to_white', 'Fade pelo branco'], ['flash', 'Flash'], ['push', 'Empurrar'], ['whip', 'Chicote'], ['slide', 'Deslizar'], ['linear_wipe', 'Cortina'], ['iris_round', 'Íris'], ['cross_zoom', 'Zoom']];
  const MARGEM_ENCOSTO = 0.05;
  const EXT_ROTEIRO = /\.(pdf|docx|odt|txt|md|rtf)$/i;
  const FORMATOS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
  const ICONES = { video: '🎬', imagem: '🖼', audio: '🎵' };
  const ANIMAVEIS = new Set(['x', 'y', 'escala', 'rotacao', 'opacidade', 'efeitos.cor.exposicao', 'efeitos.cor.contraste', 'efeitos.cor.saturacao', 'efeitos.cor.temperatura', 'efeitos.cor.matiz', 'efeitos.cor.destaques', 'efeitos.cor.sombras', 'efeitos.cor.brancos', 'efeitos.cor.pretos', 'efeitos.cor.vibracao', 'efeitos.desfoque.raio', 'efeitos.corte.esquerda', 'efeitos.corte.cima', 'efeitos.corte.direita', 'efeitos.corte.baixo', 'efeitos.vinheta.quantidade']);

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
    pastasAbertas: new Set(), // pastas dos materiais começam fechadas
    area: 'timeline', // painel que recebe os atalhos (o último clicado), como no Filmcraft
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

  // Cada faixa é uma linha só, como no Filmcraft e no CapCut: um item que começa em cima de outro sai para a próxima
  // faixa do mesmo tipo que estiver livre nesse trecho (para cima no vídeo, para baixo no áudio); sem nenhuma, uma nova
  // logo depois desta. Devolve true se mudou algo.
  function separarSobrepostos(t) {
    let mudou = false;
    const cruza = (a, b) => a.inicio < b.inicio + b.duracao - 0.001 && a.inicio + a.duracao > b.inicio + 0.001;
    for (let n = 0; n < t.trilhas.length; n++) {
      const tr = t.trilhas[n];
      const audio = tr.tipo === 'audio';
      let fim = -Infinity;
      const sair = [];
      for (const i of [...tr.itens].sort((a, b) => a.inicio - b.inicio)) {
        if (i.inicio < fim - 0.001) sair.push(i);
        else fim = Math.max(fim, i.inicio + i.duracao);
      }
      for (const i of sair) {
        mudou = true;
        tr.itens.splice(tr.itens.indexOf(i), 1);
        if (tr.transicoes) {
          tr.transicoes = tr.transicoes.filter((x) => x.de !== i.id && x.para !== i.id);
          if (!tr.transicoes.length) delete tr.transicoes;
        }
        let destino = t.trilhas.slice(n + 1).find((x) => (x.tipo === 'audio') === audio && !x.itens.some((o) => cruza(o, i)));
        if (!destino) {
          destino = { id: novoId(), tipo: audio ? 'audio' : 'video', itens: [] };
          t.trilhas.splice(n + 1, 0, destino);
        }
        destino.itens.push(i);
      }
    }
    return mudou;
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
    separarSobrepostos(s.t);
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
    // A borda de baixo do cabeçalho muda a altura da faixa; clique duplo volta ao tamanho padrão.
    const borda = document.createElement('div');
    borda.className = 'tl-redim';
    borda.title = 'Arraste para mudar a altura da faixa (clique duplo volta ao padrão)';
    borda.addEventListener('dblclick', () => {
      delete trilha.altura;
      salvarDepois();
      desenhar();
    });
    borda.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const y0 = e.clientY;
      const a0 = alturaDe(trilha);
      let nova = a0;
      document.body.classList.add('redimensionando-v');
      const mover = (ev) => {
        nova = Math.round(Math.max(ALTURA_MIN, Math.min(ALTURA_MAX, a0 + ev.clientY - y0)));
        linha.style.height = nova + 'px';
        linha.querySelectorAll('.tl-item').forEach((el) => (el.style.height = nova - 4 + 'px'));
      };
      const soltar = () => {
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
        document.body.classList.remove('redimensionando-v');
        if (nova === a0) return;
        trilha.altura = nova;
        salvarDepois();
        desenhar();
      };
      window.addEventListener('pointermove', mover);
      window.addEventListener('pointerup', soltar);
    });
    cab.append(borda);
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
    pista.addEventListener('contextmenu', (e) => {
      if (e.target === pista) menuDaFaixa(e, trilha);
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
    if (item.tipo === 'ajuste') return '◐ Camada de ajuste';
    if (item.texto != null) return item.texto;
    return item.arquivo ?? item.tipo;
  }

  function posicionar(el, item) {
    el.style.left = item.inicio * s.pps + 'px';
    el.style.width = Math.max(2, item.duracao * s.pps) + 'px';
  }

  function desenharItem(item, trilha) {
    const el = document.createElement('div');
    el.className = `tl-item item-${item.tipo}` + (s.selecao.has(item.id) ? ' selecionado' : '') + (item.desativado ? ' desativado' : '');
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
    el.addEventListener('contextmenu', (e) => menuDoItem(e, item));
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

  // Mover itens (um, o vídeo com o áudio vinculado ou uma seleção), como o Filmcraft faz: durante o arraste
  // nada muda em s.t nem no DOM das faixas; só uma camada de "fantasmas" mostra onde os itens vão cair, e o
  // mouse é lido no máximo uma vez por quadro. A faixa de destino sai da posição do mouse: o deslocamento em
  // faixas (do mesmo tipo da faixa onde o arraste começou) vale para todos, cada um dentro do seu tipo; acima da
  // faixa de vídeo mais alta, ou abaixo da de áudio mais baixa, os itens desse tipo vão para uma faixa nova.
  // Ao soltar é um passo só: cada item cai na faixa de destino sobrescrevendo o que estiver embaixo
  // (o trecho coberto sai, como no Filmcraft e no Premiere). Esc cancela.
  function arrastarMover(e, principal, ids, { cliqueSoltaGrupo = false } = {}) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const idsSet = new Set(ids);
    const membros = todosItens()
      .filter((i) => idsSet.has(i.id))
      .map((i) => ({ i, tr: trilhaDe(i.id), inicio: i.inicio, el: qs(`.tl-item[data-id="${CSS.escape(i.id)}"]`) }));
    if (!membros.length) return;
    const ref = membros.find((m) => m.i === principal) ?? membros[0];
    const menor = Math.min(...membros.map((m) => m.inicio));
    const pontos = [0, s.tempo];
    for (const i of todosItens()) if (!idsSet.has(i.id)) pontos.push(i.inicio, i.inicio + i.duracao);
    const listaDo = (audio) => s.t.trilhas.filter((tr) => ehAudio(tr) === audio);
    const tipoInicial = ehAudio(ref.tr);

    let mudou = false;
    let ultimo = null;
    let quadro = 0;
    let plano = { delta: 0, faixas: 0, nova: false };
    let camada = null;
    let alvoMarcado = null;

    const linhas = () =>
      [...qs('#tl-trilhas').querySelectorAll('.tl-pista')].map((p) => ({ el: p, tr: s.t.trilhas.find((x) => x.id === p.dataset.trilha), r: p.getBoundingClientRect() }));

    function comecarVisual() {
      const box = qs('#tl-trilhas');
      camada = document.createElement('div');
      camada.className = 'tl-fantasmas';
      const rb = box.getBoundingClientRect();
      for (const m of membros) {
        if (!m.el) continue;
        const r = m.el.getBoundingClientRect();
        const f = m.el.cloneNode(true);
        f.classList.add('tl-fantasma');
        f.style.left = r.left - rb.left + box.scrollLeft + 'px';
        f.style.top = r.top - rb.top + box.scrollTop + 'px';
        f.style.width = r.width + 'px';
        f.style.height = r.height + 'px';
        m.fantasma = f;
        m.el.classList.add('tl-origem');
        camada.append(f);
      }
      box.append(camada);
      document.body.classList.add('movendo-itens');
    }

    function limparVisual() {
      camada?.remove();
      camada = null;
      for (const m of membros) m.el?.classList.remove('tl-origem');
      alvoMarcado?.classList.remove('alvo-soltar');
      alvoMarcado = null;
      document.body.classList.remove('movendo-itens');
      mostrarGuia(null);
    }

    // Tempo: o mesmo ímã de antes, pela ponta (começo ou fim) do item agarrado que estiver mais perto.
    function calcularDelta(ev) {
      let delta = Math.max(-menor, (ev.clientX - x0) / s.pps);
      const a = imantar(ref.inicio + delta, pontos);
      const b = imantar(ref.inicio + delta + principal.duracao, pontos);
      const peloFim = b.guia != null && (a.guia == null || Math.abs(b.valor - (ref.inicio + delta + principal.duracao)) < Math.abs(a.valor - (ref.inicio + delta)));
      delta = (peloFim ? b.valor - principal.duracao : a.valor) - ref.inicio;
      mostrarGuia(peloFim ? b.guia : a.guia);
      return Math.max(-menor, noQuadro(delta));
    }

    // Faixa: quantas faixas do mesmo tipo o mouse subiu ou desceu, ou "nova" fora das faixas.
    function calcularFaixas(ev, rows) {
      const sob = rows.find((x) => ev.clientY >= x.r.top && ev.clientY < x.r.bottom);
      const lista = listaDo(tipoInicial);
      const i0 = lista.indexOf(ref.tr);
      if (sob && sob.tr && ehAudio(sob.tr) === tipoInicial) return { faixas: lista.indexOf(sob.tr) - i0, nova: false };
      const doTipo = rows.filter((x) => x.tr && ehAudio(x.tr) === tipoInicial);
      if (!doTipo.length) return { faixas: 0, nova: false };
      // Vídeo: a V mais alta é a primeira na tela; acima dela, faixa nova. Áudio: abaixo da última.
      if (!tipoInicial && ev.clientY < doTipo[0].r.top) return { faixas: 0, nova: true };
      if (tipoInicial && ev.clientY >= doTipo.at(-1).r.bottom) return { faixas: 0, nova: true };
      return { faixas: plano.faixas, nova: false };
    }

    // Faixa de destino de cada membro: a sua, deslocada dentro do seu tipo (presa às que existem).
    function destinoDe(m) {
      if (plano.nova) return ehAudio(m.tr) === tipoInicial ? 'nova' : m.tr;
      const lista = listaDo(ehAudio(m.tr));
      const n = Math.max(0, Math.min(lista.length - 1, lista.indexOf(m.tr) + plano.faixas));
      return lista[n];
    }

    function desenharQuadro() {
      quadro = 0;
      const ev = ultimo;
      if (!ev || !camada) return;
      const rows = linhas();
      const delta = calcularDelta(ev);
      plano = { delta, ...calcularFaixas(ev, rows) };
      const linhaDe = (tr) => rows.find((x) => x.tr === tr);
      let alvo = null;
      for (const m of membros) {
        if (!m.fantasma) continue;
        const origem = linhaDe(m.tr);
        const dest = destinoDe(m);
        let dy = 0;
        if (dest === 'nova') {
          const doTipo = rows.filter((x) => x.tr && ehAudio(x.tr) === ehAudio(m.tr));
          dy = ehAudio(m.tr) ? doTipo.at(-1).r.bottom - origem.r.top : doTipo[0].r.top - origem.r.height - origem.r.top;
        } else {
          const ld = linhaDe(dest);
          if (ld && origem) dy = ld.r.top - origem.r.top;
          if (m === ref) alvo = ld?.el ?? null;
        }
        m.fantasma.style.transform = `translate(${delta * s.pps}px, ${dy}px)`;
      }
      if (alvo !== alvoMarcado) {
        alvoMarcado?.classList.remove('alvo-soltar');
        alvo?.classList.add('alvo-soltar');
        alvoMarcado = alvo;
      }
      camada.classList.toggle('inserindo', !!(ev.ctrlKey || ev.metaKey));
      const it = qs('#tl-inspetor-tempo');
      if (it && membros.length === 1) it.textContent = `${(principal.inicio + delta).toFixed(2)} s → ${(principal.inicio + delta + principal.duracao).toFixed(2)} s`;
    }

    const aoMover = (ev) => {
      if (!mudou) {
        if (Math.abs(ev.clientX - x0) <= 3 && Math.abs(ev.clientY - y0) <= 3) return;
        mudou = true;
        comecarVisual();
      }
      ultimo = ev;
      if (!quadro) quadro = requestAnimationFrame(desenharQuadro);
    };

    const fim = () => {
      el.removeEventListener('pointermove', aoMover);
      el.removeEventListener('pointerup', aoSoltar);
      el.removeEventListener('pointercancel', cancelarArraste);
      window.removeEventListener('keydown', aoTecla, true);
      if (quadro) cancelAnimationFrame(quadro);
      quadro = 0;
    };
    const cancelarArraste = () => {
      fim();
      limparVisual();
    };
    const aoTecla = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      cancelarArraste();
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    };
    const aoSoltar = (ev) => {
      fim();
      if (!mudou) {
        limparVisual();
        // Clicar num item do grupo, sem arrastar, deixa só ele selecionado.
        if (cliqueSoltaGrupo) selecionar(principal.id);
        return;
      }
      ultimo = ev;
      desenharQuadro();
      limparVisual();
      const { delta } = plano;
      const destinos = membros.map((m) => [m, destinoDe(m)]);
      if (!delta && destinos.every(([m, d]) => d === m.tr)) return;
      // Ctrl (ou Cmd) ao soltar insere: empurra o que está na faixa de destino em vez de sobrescrever.
      alterar(() => aplicarMovimento(destinos, delta, { inserir: ev.ctrlKey || ev.metaKey }));
    };

    el.addEventListener('pointermove', aoMover);
    el.addEventListener('pointerup', aoSoltar);
    el.addEventListener('pointercancel', cancelarArraste);
    window.addEventListener('keydown', aoTecla, true);
  }

  // O passo único do soltar: tira os itens das faixas de origem, cria a faixa nova se for o caso, abre espaço
  // na de destino (sobrescrever) e coloca cada um no lugar. Transições só viajam quando todos os itens em que
  // elas se apoiam vão juntos para a mesma faixa; com um parceiro ficando para trás, a transição sai.
  function aplicarMovimento(destinos, delta, { inserir = false } = {}) {
    const novas = {};
    const faixaDe = (m, d) => {
      if (d !== 'nova') return d;
      const audio = ehAudio(m.tr);
      return (novas[audio] ??= novaFaixa(audio ? 'audio' : 'video', { acimaDeTudo: true }));
    };
    const plano = destinos.map(([m, d]) => ({ m, dest: faixaDe(m, d) }));
    const movendo = new Map(plano.map((p) => [p.m.i.id, p.dest]));
    // Transições: decididas antes de mexer, com as faixas de origem ainda intactas.
    const levar = [];
    for (const tr of new Set(plano.map((p) => p.m.tr))) {
      if (!tr.transicoes) continue;
      tr.transicoes = tr.transicoes.filter((x) => {
        const pontas = [x.de, x.para].filter(Boolean);
        if (!pontas.some((id) => movendo.has(id))) return true;
        const dests = new Set(pontas.map((id) => movendo.get(id)));
        if (pontas.every((id) => movendo.has(id)) && dests.size === 1) levar.push([[...dests][0], x]);
        return false;
      });
      if (!tr.transicoes.length) delete tr.transicoes;
    }
    for (const { m } of plano) m.tr.itens.splice(m.tr.itens.indexOf(m.i), 1);
    for (const { m } of plano) m.i.inicio = arredondar(Math.max(0, m.inicio + delta));
    if (inserir) {
      // Por faixa de destino: abre um vão do tamanho do bloco que chega, a partir do começo dele.
      for (const dest of new Set(plano.map((p) => p.dest))) {
        const doBloco = plano.filter((p) => p.dest === dest).map((p) => p.m.i);
        const a = Math.min(...doBloco.map((i) => i.inicio));
        const vao = Math.max(...doBloco.map((i) => i.inicio + i.duracao)) - a;
        abrirVao(dest, a, vao);
      }
    }
    for (const { m, dest } of plano) {
      if (!inserir) sobrescrever(dest, m.i.inicio, m.i.inicio + m.i.duracao);
      dest.itens.push(m.i);
    }
    for (const [dest, x] of levar) (dest.transicoes ??= []).push(x);
  }

  // Inserir: o item que cruza o ponto a é dividido ali, e tudo o que começa dali em diante anda o tamanho do vão.
  function abrirVao(tr, a, vao) {
    for (const o of [...tr.itens]) if (o.inicio < a - 0.001 && o.inicio + o.duracao > a + 0.001) dividirItem(o, tr, a);
    for (const o of tr.itens) if (o.inicio >= a - 0.001) o.inicio = arredondar(o.inicio + vao);
  }

  // Abre o trecho [a, b) numa faixa: o que estava inteiro dentro sai, o que cruzava uma ponta é aparado e o
  // que cobria o trecho todo vira dois pedaços.
  function sobrescrever(tr, a, b) {
    const tirar = (o) => {
      tr.itens.splice(tr.itens.indexOf(o), 1);
      if (tr.transicoes) {
        tr.transicoes = tr.transicoes.filter((x) => x.de !== o.id && x.para !== o.id);
        if (!tr.transicoes.length) delete tr.transicoes;
      }
    };
    for (const o of [...tr.itens]) {
      const fimO = o.inicio + o.duracao;
      if (fimO <= a + 0.001 || o.inicio >= b - 0.001) continue;
      const antesDe = o.inicio < a - 0.001;
      const depoisDe = fimO > b + 0.001;
      if (antesDe && depoisDe) {
        dividirItem(o, tr, b);
        o.duracao = arredondar(a - o.inicio);
      } else if (antesDe) {
        o.duracao = arredondar(a - o.inicio);
        delete o.saida;
      } else if (depoisDe) {
        moverComeco(o, b - o.inicio);
        delete o.entrada;
      } else tirar(o);
    }
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
    // Mover: o item com o que estiver selecionado junto (o vídeo e o áudio vinculado, ou a seleção toda).
    // Alt pega só ele.
    if (modo === 'mover') {
      const ids = grupo || (!sozinho && s.ferramenta === 'selecao') ? [...s.selecao] : sozinho ? [item.id] : [item.id, ...parceiros(item.id).map((p) => p.id)];
      return arrastarMover(e, item, ids.includes(item.id) ? ids : [item.id, ...ids], { cliqueSoltaGrupo: grupo });
    }
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const original = { inicio: item.inicio, duracao: item.duracao, corteInicio: item.corteInicio };
    const antes = JSON.stringify(s.t);
    const pontos = pontosDeImã(item.id);
    const vel = item.velocidade ?? 1;
    const temFonte = item.tipo === 'video' || item.tipo === 'audio';
    let mudou = false;

    // Aqui só as pontas (aparar); mover é arrastarMover.
    const aoMover = (ev) => {
      const delta = (ev.clientX - x0) / s.pps;
      if (Math.abs(ev.clientX - x0) > 2) mudou = true;
      if (modo === 'esq') {
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

  // V: desativa os clipes selecionados (somem da prévia e do render, mas ficam na timeline, mais escuros).
  // Se algum ainda está ativo, desativa todos; se todos já estão desativados, ativa de volta.
  function alternarDesativados() {
    const alvos = todosItens().filter((i) => s.selecao.has(i.id));
    if (!alvos.length) return;
    const desativar = alvos.some((i) => !i.desativado);
    alterar(() => {
      for (const i of alvos) {
        if (desativar) i.desativado = true;
        else delete i.desativado;
      }
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

  // Materiais e Propriedades são painéis do dock: traz o pedido para a frente do grupo dele.
  function mostrarAba(aba) {
    s.aba = aba;
    Dock.mostrar(aba === 'inspetor' ? 'propriedades' : 'materiais');
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
    s.transcricoes = await api.transcricoesVideo(id).catch(() => ({}));
    if (!s.fontes) await carregarFontes();
    if (s.id !== id) return;
    desenharMateriais();
    desenharInspetor();
    // As LUTs (.cube) também ficam em assets/: a lista vai para o Lumetri do inspetor.
    carregarLuts().then(() => s.id === id && desenharInspetor());
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

  async function substituirItem(item, m) {
    if (!mesmoGrupo(item.tipo, m.tipo)) return avisar('Áudio só troca por áudio, e vídeo ou imagem por vídeo ou imagem.');
    // Vídeo novo no lugar de um clipe: como no CapCut, uma janela mostra qual trecho dele entra e deixa escolher.
    if (m.tipo === 'video' && item.tipo !== 'audio') {
      const escolha = await escolherTrechoSubstituto(item, m);
      if (!escolha) return;
      const vel = item.tipo === 'video' ? item.velocidade ?? 1 : 1;
      alterar(() => {
        trocarArquivoDoItem(item, m);
        item.corteInicio = arredondar(escolha.corte);
        item.duracao = arredondar(Math.max(umQuadro(), Math.min(escolha.duracaoItem, (escolha.durNovo - escolha.corte) / vel)));
        for (const kfs of Object.values(item.keyframes ?? {})) for (const k of kfs) k.t = Math.min(k.t, item.duracao);
      });
      carregarMidia();
      return avisar(escolha.curto ? `Trocado por ${m.arquivo}. O clipe ficou com ${segundos(item.duracao)} (o vídeo novo é mais curto).` : `Trocado por ${m.arquivo}.`);
    }
    alterar(() => trocarArquivoDoItem(item, m));
    carregarMidia();
    avisar(`Trocado por ${m.arquivo}.`);
  }

  const segundos = (x) => `${(Math.round(x * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} s`;
  const relogio = (x) => {
    const t = Math.max(0, x);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  };

  // Janela de substituição: o vídeo novo inteiro numa barra, com a seleção do tamanho do clipe que sai. Arrastar a
  // seleção escolhe o momento; a prévia toca o trecho em loop. Se o vídeo novo é mais curto que o clipe, avisa a
  // duração mínima. Resolve com { corte, durNovo, duracaoItem, curto } ou null se cancelar.
  function escolherTrechoSubstituto(item, m) {
    return new Promise((resolver) => {
      const vel = item.tipo === 'video' ? item.velocidade ?? 1 : 1;
      const precisa = item.duracao * vel;
      const dlg = document.createElement('dialog');
      dlg.className = 'dlg-substituir';
      dlg.innerHTML = `
        <h2>Substituir clipe</h2>
        <p class="sub-nomes"><b class="sub-novo"></b> entra no lugar de <span class="sub-velho"></span></p>
        <div class="sub-tela"><video class="sub-video" muted playsinline preload="auto"></video><span class="sub-carregando">Carregando…</span></div>
        <div class="sub-aviso" hidden></div>
        <div class="sub-barra" title="Arraste a seleção para escolher o momento do vídeo novo">
          <div class="sub-tira"></div>
          <div class="sub-sel"><span class="sub-sel-dur"></span></div>
          <div class="sub-cursor"></div>
        </div>
        <div class="sub-info">
          <button type="button" class="sub-tocar" title="Tocar ou pausar o trecho (Espaço)">❚❚</button>
          <span class="sub-trecho"></span>
          <span class="sub-total"></span>
        </div>
        <div class="exp-rodape">
          <span class="sub-dica">Arraste a seleção para escolher o momento. Enter confirma, Esc cancela.</span>
          <span class="exp-botoes">
            <button type="button" class="sub-cancelar">Cancelar</button>
            <button type="button" class="primario sub-ok">Substituir</button>
          </span>
        </div>`;
      document.body.append(dlg);
      const $ = (c) => dlg.querySelector(c);
      const video = $('.sub-video');
      const barra = $('.sub-barra');
      const sel = $('.sub-sel');
      const cursor = $('.sub-cursor');
      $('.sub-novo').textContent = m.arquivo;
      $('.sub-velho').textContent = item.arquivo ?? 'o clipe';
      let durNovo = m.duracao || 0;
      let inicio = 0;
      let anim = 0;
      let fechado = false;
      const largura = () => Math.min(precisa, durNovo);
      const curto = () => durNovo > 0 && durNovo < precisa - umQuadro() / 2;
      const prender = (x) => Math.max(0, Math.min(Math.max(0, durNovo - largura()), x));

      const desenhar = () => {
        if (!(durNovo > 0)) return;
        sel.style.left = (inicio / durNovo) * 100 + '%';
        sel.style.width = (largura() / durNovo) * 100 + '%';
        $('.sub-sel-dur').textContent = segundos(largura());
        $('.sub-trecho').textContent = `Trecho: ${relogio(inicio)} – ${relogio(inicio + largura())}`;
        $('.sub-total').textContent = `Vídeo novo: ${segundos(durNovo)} · clipe: ${segundos(precisa)}`;
        cursor.style.left = (Math.min(video.currentTime || 0, durNovo) / durNovo) * 100 + '%';
        const aviso = $('.sub-aviso');
        aviso.hidden = !curto();
        sel.classList.toggle('curta', curto());
        $('.sub-ok').textContent = curto() ? 'Substituir mesmo assim' : 'Substituir';
        if (curto()) {
          aviso.innerHTML = `<b>Duração baixa.</b> Este clipe precisa de no mínimo <b>${segundos(precisa)}</b> de vídeo, e o vídeo novo tem ${segundos(durNovo)}. ` +
            `Se substituir, o clipe fica com ${segundos(durNovo / vel)} e sobra um vão de ${segundos((precisa - durNovo) / vel)} na timeline.`;
        }
      };

      // A prévia toca só o trecho escolhido, em loop.
      const laco = () => {
        if (fechado) return;
        if (!video.paused && video.currentTime >= inicio + largura() - 0.02) video.currentTime = inicio;
        desenhar();
        anim = requestAnimationFrame(laco);
      };
      const ir = (t) => {
        inicio = prender(t);
        if (video.readyState >= 1) video.currentTime = inicio;
        desenhar();
      };
      const tocar = (sim = video.paused) => {
        if (sim) video.play().catch(() => {});
        else video.pause();
        $('.sub-tocar').textContent = sim ? '❚❚' : '▶';
      };

      video.addEventListener('loadedmetadata', () => {
        // Sem a duração no material (arquivo recém-importado), vale a do próprio vídeo.
        const semDuracao = !(durNovo > 0);
        if (semDuracao && Number.isFinite(video.duration)) durNovo = video.duration;
        ir(semDuracao ? (item.tipo === 'video' ? item.corteInicio ?? 0 : 0) : inicio);
        $('.sub-carregando').hidden = true;
        tocar(true);
      });
      video.addEventListener('error', () => {
        $('.sub-carregando').textContent = 'A prévia deste vídeo ainda não está pronta. Dá para escolher o trecho pela barra.';
      });
      video.src = urlDaMidia(m.arquivo);

      // Arrastar a seleção (ou clicar na barra para centralizar nela).
      barra.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !(durNovo > 0)) return;
        e.preventDefault();
        const r = barra.getBoundingClientRect();
        const t = (x) => ((x - r.left) / r.width) * durNovo;
        const dentro = e.target === sel || sel.contains(e.target);
        const deslocar = dentro ? t(e.clientX) - inicio : largura() / 2;
        const tocava = !video.paused;
        video.pause();
        ir(t(e.clientX) - deslocar);
        barra.classList.add('arrastando');
        const mover = (ev) => ir(t(ev.clientX) - deslocar);
        const soltar = () => {
          barra.classList.remove('arrastando');
          window.removeEventListener('pointermove', mover);
          window.removeEventListener('pointerup', soltar);
          if (tocava) tocar(true);
        };
        window.addEventListener('pointermove', mover);
        window.addEventListener('pointerup', soltar);
      });

      // Miniaturas do vídeo novo na barra, se já existem.
      const md = s.midia[m.arquivo];
      if (md?.tira && md.quadros) {
        const tira = $('.sub-tira');
        tira.style.backgroundImage = `url("${urlArquivo(md.tira)}")`;
        tira.style.backgroundSize = '100% 100%';
      }

      const fechar = (valor) => {
        if (fechado) return;
        fechado = true;
        cancelAnimationFrame(anim);
        video.pause();
        video.removeAttribute('src');
        video.load();
        dlg.close();
        dlg.remove();
        resolver(valor);
      };
      $('.sub-tocar').onclick = () => tocar();
      $('.sub-cancelar').onclick = () => fechar(null);
      $('.sub-ok').onclick = () => {
        if (!(durNovo > 0)) return;
        fechar({ corte: inicio, durNovo, duracaoItem: item.duracao, curto: curto() });
      };
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        fechar(null);
      });
      dlg.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === ' ') {
          e.preventDefault();
          tocar();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          $('.sub-ok').click();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          ir(inicio + (e.key === 'ArrowRight' ? 1 : -1) * umQuadro() * (e.shiftKey ? 10 : 1));
        }
      });
      dlg.showModal();
      // Começa onde o clipe antigo começava no arquivo dele, se couber (vale mesmo antes de o vídeo carregar).
      if (durNovo > 0) inicio = prender(item.tipo === 'video' ? item.corteInicio ?? 0 : 0);
      desenhar();
      anim = requestAnimationFrame(laco);
    });
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
      const fechada = !s.pastasAbertas.has(filha.caminho);
      const titulo = document.createElement('button');
      titulo.className = 'material-pasta';
      titulo.dataset.pasta = filha.caminho;
      titulo.title = filha.caminho;
      titulo.textContent = `${fechada ? '▸' : '▾'} 📁 ${filha.nome} (${totalNaPasta(filha)})`;
      titulo.onclick = () => {
        if (fechada) s.pastasAbertas.add(filha.caminho);
        else s.pastasAbertas.delete(filha.caminho);
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
        <select class="fonte-zoom" title="Zoom (roda do mouse em cima do vídeo; clique duplo volta a encaixar)">
          <option value="">Encaixar</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option><option value="x" hidden></option>
        </select>
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
    qs('#painel-origem').append(box);
    const video = box.querySelector('.fonte-video');
    const tela = box.querySelector('.fonte-tela');
    const imagem = box.querySelector('.fonte-img');
    const zoomSel = box.querySelector('.fonte-zoom');
    const prender = (x, a, b) => Math.max(a, Math.min(b, x));
    const natural = () => (fonte.m?.tipo === 'imagem' ? [imagem.naturalWidth, imagem.naturalHeight] : [video.videoWidth, video.videoHeight]);
    // Encaixar mostra o quadro inteiro; com zoom, 100% é o tamanho real do vídeo e dá para arrastar.
    fonte.enquadrar = () => {
      const el = fonte.m?.tipo === 'imagem' ? imagem : video;
      const [vw, vh] = natural();
      const W = tela.clientWidth;
      const H = tela.clientHeight;
      if (!vw || !vh || !W || !H) return;
      const esc = fonte.zoom ?? Math.min(W / vw, H / vh);
      const w = vw * esc;
      const h = vh * esc;
      const limX = Math.max(0, (w - W) / 2);
      const limY = Math.max(0, (h - H) / 2);
      fonte.pan = { x: prender(fonte.pan?.x ?? 0, -limX, limX), y: prender(fonte.pan?.y ?? 0, -limY, limY) };
      Object.assign(el.style, { width: w + 'px', height: h + 'px', left: (W - w) / 2 + fonte.pan.x + 'px', top: (H - h) / 2 + fonte.pan.y + 'px' });
      const opcao = [...zoomSel.options].find((o) => o.value !== '' && o.value !== 'x' && Math.abs(Number(o.value) - esc) < 0.001);
      const outra = zoomSel.querySelector('option[value="x"]');
      outra.hidden = fonte.zoom == null || !!opcao;
      outra.textContent = Math.round(esc * 100) + '%';
      zoomSel.value = fonte.zoom == null ? '' : opcao ? opcao.value : 'x';
      tela.classList.toggle('com-zoom', w > W + 1 || h > H + 1);
    };
    new ResizeObserver(() => fonte.enquadrar()).observe(tela);
    video.addEventListener('loadedmetadata', () => fonte.enquadrar());
    imagem.addEventListener('load', () => fonte.enquadrar());
    zoomSel.onchange = () => {
      fonte.zoom = zoomSel.value && zoomSel.value !== 'x' ? Number(zoomSel.value) : null;
      fonte.pan = { x: 0, y: 0 };
      fonte.enquadrar();
    };
    tela.addEventListener(
      'wheel',
      (e) => {
        if (!fonte.m || fonte.m.tipo === 'audio') return;
        const [vw, vh] = natural();
        if (!vw || !vh) return;
        e.preventDefault();
        const W = tela.clientWidth;
        const H = tela.clientHeight;
        const atual = fonte.zoom ?? Math.min(W / vw, H / vh);
        const novo = prender(atual * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.05, 8);
        // O ponto embaixo do mouse fica parado.
        const r = tela.getBoundingClientRect();
        const mx = e.clientX - r.left - W / 2 - (fonte.pan?.x ?? 0);
        const my = e.clientY - r.top - H / 2 - (fonte.pan?.y ?? 0);
        fonte.pan = { x: (fonte.pan?.x ?? 0) - mx * (novo / atual - 1), y: (fonte.pan?.y ?? 0) - my * (novo / atual - 1) };
        fonte.zoom = novo;
        fonte.enquadrar();
      },
      { passive: false },
    );
    tela.addEventListener('dblclick', () => {
      fonte.zoom = null;
      fonte.pan = { x: 0, y: 0 };
      fonte.enquadrar();
    });
    tela.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !tela.classList.contains('com-zoom')) return;
      e.preventDefault();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const p0 = { ...fonte.pan };
      tela.classList.add('arrastando');
      const mover = (ev) => {
        fonte.pan = { x: p0.x + ev.clientX - x0, y: p0.y + ev.clientY - y0 };
        fonte.enquadrar();
      };
      const soltar = () => {
        tela.classList.remove('arrastando');
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
      };
      window.addEventListener('pointermove', mover);
      window.addEventListener('pointerup', soltar);
    });
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
    fonte.zoom = null;
    fonte.pan = { x: 0, y: 0 };
    Dock.mostrar('origem');
    desenharFonte();
    fonte.enquadrar?.();
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

  // ---------- atalhos de teclado (personalizáveis: Configurações ▸ Atalhos de teclado, ou Ctrl+Alt+K) ----------
  // Cada ação tem teclas padrão; o que o usuário muda fica em config.atalhos[id] (só o que difere do padrão).
  // Formato da tecla: modificadores na ordem Ctrl, Alt, Shift e a tecla (letra maiúscula, dígito, Space, ArrowLeft…).

  const ACOES_TECLADO = [
    ['desfazer', 'Editar', 'Desfazer', ['Ctrl+Z'], () => trocarEstado(s.desfazer, s.refazer)],
    ['refazer', 'Editar', 'Refazer', ['Ctrl+Y', 'Ctrl+Shift+Z'], () => trocarEstado(s.refazer, s.desfazer)],
    ['recortar', 'Editar', 'Recortar', ['Ctrl+X'], () => copiarSelecao() && !s.bloqueada && excluir(false)],
    ['copiar', 'Editar', 'Copiar', ['Ctrl+C'], () => copiarSelecao()],
    ['colar', 'Editar', 'Colar no cursor', ['Ctrl+V'], () => colarSelecao()],
    ['selecionarTudo', 'Editar', 'Selecionar tudo', ['Ctrl+A'], () => selecionarVarios(todosItens().map((i) => i.id))],
    ['excluir', 'Editar', 'Excluir', ['Delete', 'Backspace'], () => excluir(false)],
    ['excluirFechar', 'Editar', 'Excluir e fechar o vão', ['Shift+Delete', 'Shift+Backspace'], () => excluir(true)],
    ['dividir', 'Timeline', 'Dividir no cursor', ['S'], () => dividir()],
    ['camadaAjuste', 'Timeline', 'Nova camada de ajuste no cursor', [], () => novaCamadaAjuste()],
    ['texto', 'Timeline', 'Adicionar texto', [], () => adicionarTexto()],
    ['ima', 'Timeline', 'Ligar ou desligar o ímã', [], () => qs('#tl-ima').click()],
    ['ajustarNaTela', 'Timeline', 'Ajustar a timeline na tela', [], () => ajustarNaTela()],
    ['tocar', 'Reprodução', 'Tocar / pausar', ['Space'], () => tocarOuPausar()],
    ['quadroAntes', 'Reprodução', 'Um quadro para trás', ['ArrowLeft'], () => irPara(s.tempo - 1 / fps())],
    ['quadroDepois', 'Reprodução', 'Um quadro para a frente', ['ArrowRight'], () => irPara(s.tempo + 1 / fps())],
    ['segundoAntes', 'Reprodução', 'Um segundo para trás', ['Shift+ArrowLeft'], () => irPara(s.tempo - 1)],
    ['segundoDepois', 'Reprodução', 'Um segundo para a frente', ['Shift+ArrowRight'], () => irPara(s.tempo + 1)],
    ['inicio', 'Reprodução', 'Ir para o início', ['Home'], () => irPara(0)],
    ['fim', 'Reprodução', 'Ir para o fim', ['End'], () => irPara(duracaoTotal())],
    ['desativar', 'Timeline', 'Desativar / ativar os clipes selecionados', ['V'], () => alternarDesativados()],
    ['ferramenta.selecao', 'Ferramentas', 'Selecionar', ['A'], () => escolherFerramenta('selecao')],
    ['ferramenta.ripple', 'Ferramentas', 'Ripple', ['B'], () => escolherFerramenta('ripple')],
    ['ferramenta.roll', 'Ferramentas', 'Roll', ['N'], () => escolherFerramenta('roll')],
    ['ferramenta.slip', 'Ferramentas', 'Slip', ['Y'], () => escolherFerramenta('slip')],
    ['ferramenta.slide', 'Ferramentas', 'Slide', ['U'], () => escolherFerramenta('slide')],
    ['ferramenta.taxa', 'Ferramentas', 'Velocidade pela duração', ['R'], () => escolherFerramenta('taxa')],
    ['ferramenta.navalha', 'Ferramentas', 'Navalha', ['C'], () => escolherFerramenta('navalha')],
    ['atalhos', 'App', 'Atalhos de teclado', ['Ctrl+Alt+K'], () => abrirAtalhos()],
  ];
  // Valem com o mouse sobre a janela de Origem (têm prioridade sobre os da timeline ali). Esc fecha, sempre.
  const ACOES_FONTE = [
    ['fonte.entrada', 'Origem', 'Marcar entrada', ['I'], () => acaoFonte('entrada')],
    ['fonte.saida', 'Origem', 'Marcar saída', ['O'], () => acaoFonte('saida')],
    ['fonte.tocar', 'Origem', 'Tocar / pausar a origem', ['K', 'Space'], () => acaoFonte('tocar')],
    ['fonte.voltar', 'Origem', 'Um quadro para trás na origem', ['ArrowLeft'], () => acaoFonte('voltar')],
    ['fonte.avancar', 'Origem', 'Um quadro para a frente na origem', ['ArrowRight'], () => acaoFonte('avancar')],
    ['fonte.inserir', 'Origem', 'Inserir o trecho na timeline', [','], () => acaoFonte('inserir')],
  ];
  const TODAS_ACOES = [...ACOES_TECLADO, ...ACOES_FONTE];
  const contextoDe = (id) => (id.startsWith('fonte.') ? ACOES_FONTE : ACOES_TECLADO);

  function comboDe(e) {
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
    let nome;
    if (/^Key[A-Z]$/.test(e.code)) nome = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) nome = e.code.slice(5);
    else if (e.code === 'Space' || e.key === ' ') nome = 'Space';
    else if (e.key.length === 1) nome = e.key.toUpperCase();
    else nome = e.key;
    return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', nome].filter(Boolean).join('+');
  }

  const NOMES_TECLAS = { Space: 'Espaço', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Del', Backspace: '⌫', Escape: 'Esc', Enter: 'Enter' };
  const exibirTecla = (c) => (c ? c.split('+').map((p) => NOMES_TECLAS[p] ?? p).join('+') : '');
  const padraoDe = (id) => TODAS_ACOES.find((a) => a[0] === id)?.[3] ?? [];
  const teclasDe = (id) => estado.config?.atalhos?.[id] ?? padraoDe(id);
  const teclaDe = (id) => exibirTecla(teclasDe(id)[0]);
  const acaoDoCombo = (combo, lista) => lista.find(([id]) => teclasDe(id).includes(combo));

  // Atalhos da janela de origem com o mouse em cima dela (I e O marcam, K toca, setas andam um quadro, Esc fecha).
  function teclaDaFonte(e) {
    if (!fonte.m || !fonte.sobre) return false;
    if (e.key === 'Escape') fecharFonte();
    else {
      const acao = acaoDoCombo(comboDe(e), ACOES_FONTE);
      if (!acao) return false;
      acao[4]();
    }
    e.preventDefault();
    return true;
  }

  // Dicas dos botões com a tecla atual.
  const DICAS = [
    ['#tl-ferramentas [data-f="selecao"]', 'ferramenta.selecao', 'Selecionar, mover e aparar'],
    ['#tl-ferramentas [data-f="ripple"]', 'ferramenta.ripple', 'Ripple: apara e empurra o resto da trilha'],
    ['#tl-ferramentas [data-f="roll"]', 'ferramenta.roll', 'Roll: move o corte entre dois clipes'],
    ['#tl-ferramentas [data-f="slip"]', 'ferramenta.slip', 'Slip: troca o trecho do arquivo sem mover o clipe'],
    ['#tl-ferramentas [data-f="slide"]', 'ferramenta.slide', 'Slide: desliza o clipe entre os vizinhos'],
    ['#tl-ferramentas [data-f="taxa"]', 'ferramenta.taxa', 'Muda a velocidade esticando a ponta do clipe'],
    ['#tl-ferramentas [data-f="navalha"]', 'ferramenta.navalha', 'Navalha: clique para cortar'],
    ['#tl-dividir', 'dividir', 'Dividir no cursor'],
    ['#tl-excluir', 'excluir', 'Excluir'],
    ['#tl-copiar', 'copiar', 'Copiar os itens selecionados'],
    ['#tl-colar', 'colar', 'Colar no cursor'],
    ['#tl-desfazer', 'desfazer', 'Desfazer'],
    ['#tl-refazer', 'refazer', 'Refazer'],
    ['#tl-tocar', 'tocar', 'Tocar / pausar'],
  ];
  function atualizarDicas() {
    for (const [sel, id, base] of DICAS) {
      const el = qs(sel);
      if (!el) continue;
      const t = teclasDe(id).map(exibirTecla).join(' ou ');
      el.title = t ? `${base} (${t})` : base;
    }
  }

  function listaDeAtalhos() {
    const dl = document.createElement('dl');
    dl.className = 'tl-atalhos';
    const linha = (dt, dd) => dl.append(Object.assign(document.createElement('dt'), { textContent: dt }), Object.assign(document.createElement('dd'), { textContent: dd }));
    for (const [id, , nome] of ACOES_TECLADO) {
      const t = teclasDe(id);
      if (t.length) linha(t.map(exibirTecla).join(' / '), nome);
    }
    // Do mouse: não mudam.
    linha('Ctrl+clique', 'vários itens (ou arraste um retângulo)');
    linha('Ctrl ao soltar', 'inserir em vez de sobrescrever');
    linha('Alt+arrastar', 'só o item, sem o vinculado');
    linha('Ctrl+roda', 'zoom');
    const b = document.createElement('button');
    b.textContent = 'Personalizar atalhos…';
    b.onclick = abrirAtalhos;
    const box = document.createElement('div');
    box.append(dl, b);
    return box;
  }

  async function gravarAtalhos(novos) {
    // Guarda só o que difere do padrão.
    const limpo = {};
    for (const [id, teclas] of Object.entries(novos)) if (JSON.stringify(teclas) !== JSON.stringify(padraoDe(id))) limpo[id] = teclas;
    estado.config = await api.salvarConfig({ atalhos: limpo });
    atualizarDicas();
    desenharInspetor();
  }

  function abrirAtalhos() {
    let dlg = qs('#dlg-atalhos');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-atalhos';
      dlg.className = 'dlg-atalhos';
      document.body.append(dlg);
      dlg.addEventListener('close', () => pararGravacao());
    }
    let gravando = null; // id da ação esperando a tecla
    let busca = '';
    let aviso = '';
    const atuais = () => Object.fromEntries(TODAS_ACOES.map(([id]) => [id, [...teclasDe(id)]]));
    function pararGravacao() {
      gravando = null;
      s.gravandoAtalho = false;
      window.removeEventListener('keydown', aoGravar, true);
    }
    async function aoGravar(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        pararGravacao();
        return desenhar();
      }
      const combo = comboDe(e);
      if (!combo) return;
      const id = gravando;
      pararGravacao();
      const novos = atuais();
      const dono = contextoDe(id).find(([outro]) => outro !== id && novos[outro].includes(combo));
      if (novos[id].includes(combo)) aviso = '';
      else {
        if (dono) {
          novos[dono[0]] = novos[dono[0]].filter((c) => c !== combo);
          aviso = `${exibirTecla(combo)} saiu de "${dono[2]}" e agora é de "${TODAS_ACOES.find((a) => a[0] === id)[2]}".`;
        } else aviso = '';
        novos[id].push(combo);
        await gravarAtalhos(novos);
      }
      desenhar();
    }
    function desenhar() {
      dlg.innerHTML = '';
      const h = document.createElement('h2');
      h.textContent = 'Atalhos de teclado';
      const dica = document.createElement('p');
      dica.className = 'dlg-atalhos-dica';
      dica.textContent = 'Clique em + e pressione a tecla (com Ctrl, Alt ou Shift, se quiser). Esc cancela. Uma tecla já usada passa para a ação nova. Os de Origem valem com o mouse sobre a janela de Origem.';
      const campo = document.createElement('input');
      campo.type = 'search';
      campo.placeholder = 'Procurar ação ou tecla';
      campo.value = busca;
      campo.oninput = () => {
        busca = campo.value;
        const pos = campo.selectionStart;
        desenhar();
        const novo = dlg.querySelector('input[type=search]');
        novo.focus();
        novo.setSelectionRange(pos, pos);
      };
      dlg.append(h, dica, campo);
      if (aviso) dlg.append(Object.assign(document.createElement('p'), { className: 'dlg-atalhos-aviso', textContent: aviso }));
      const lista = document.createElement('div');
      lista.className = 'dlg-atalhos-lista';
      const q = busca.trim().toLowerCase();
      let grupo = null;
      for (const [id, g, nome] of TODAS_ACOES) {
        const teclas = teclasDe(id);
        if (q && !nome.toLowerCase().includes(q) && !teclas.some((t) => exibirTecla(t).toLowerCase().includes(q) || t.toLowerCase().includes(q))) continue;
        if (g !== grupo) {
          grupo = g;
          lista.append(Object.assign(document.createElement('h4'), { textContent: g }));
        }
        const linha = document.createElement('div');
        linha.className = 'dlg-atalho';
        const rotulo = Object.assign(document.createElement('span'), { className: 'dlg-atalho-nome', textContent: nome });
        const teclasEl = document.createElement('span');
        teclasEl.className = 'dlg-atalho-teclas';
        for (const t of teclas) {
          const chip = document.createElement('span');
          chip.className = 'dlg-tecla';
          chip.textContent = exibirTecla(t);
          const x = document.createElement('button');
          x.type = 'button';
          x.textContent = '×';
          x.title = 'Tirar esta tecla';
          x.onclick = async () => {
            const novos = atuais();
            novos[id] = novos[id].filter((c) => c !== t);
            aviso = '';
            await gravarAtalhos(novos);
            desenhar();
          };
          chip.append(x);
          teclasEl.append(chip);
        }
        if (gravando === id) teclasEl.append(Object.assign(document.createElement('span'), { className: 'dlg-tecla gravando', textContent: 'Pressione a tecla…' }));
        const mais = document.createElement('button');
        mais.type = 'button';
        mais.textContent = '+';
        mais.title = 'Adicionar uma tecla';
        mais.onclick = () => {
          pararGravacao();
          gravando = id;
          s.gravandoAtalho = true;
          window.addEventListener('keydown', aoGravar, true);
          desenhar();
        };
        const padrao = document.createElement('button');
        padrao.type = 'button';
        padrao.textContent = '↺';
        padrao.title = `Voltar ao padrão (${padraoDe(id).map(exibirTecla).join(' / ') || 'nenhuma'})`;
        padrao.disabled = JSON.stringify(teclas) === JSON.stringify(padraoDe(id));
        padrao.onclick = async () => {
          const novos = atuais();
          novos[id] = [...padraoDe(id)];
          aviso = '';
          await gravarAtalhos(novos);
          desenhar();
        };
        linha.append(rotulo, teclasEl, mais, padrao);
        lista.append(linha);
      }
      const rodape = document.createElement('div');
      rodape.className = 'linha-botoes';
      const todos = document.createElement('button');
      todos.type = 'button';
      todos.textContent = 'Restaurar todos os padrões';
      todos.onclick = async () => {
        if (!confirm('Voltar todos os atalhos ao padrão?')) return;
        aviso = '';
        await gravarAtalhos({});
        desenhar();
      };
      const fechar = document.createElement('button');
      fechar.type = 'button';
      fechar.className = 'primario';
      fechar.textContent = 'Fechar';
      fechar.onclick = () => dlg.close();
      rodape.append(todos, fechar);
      dlg.append(lista, rodape);
    }
    desenhar();
    if (!dlg.open) dlg.showModal();
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

  // Transcrição do áudio dos vídeos do projeto (Whisper local), para saber quais têm narração.
  const ROTULO_FALA = { narracao: 'Narração', 'fala-curta': 'Fala curta', 'sem-fala': 'Sem fala' };
  const rotuloFala = (arquivo) => ROTULO_FALA[s.transcricoes?.[arquivo]?.veredito] ?? '';

  async function transcreverVideos(arquivos) {
    if (s.transcrevendo?.size || !arquivos.length) return;
    const id = s.id;
    s.transcrevendo = new Map(arquivos.map((a) => [a, 'Na fila…']));
    desenharMateriais();
    try {
      s.transcricoes = await api.transcreverVideos({ id, arquivos });
    } catch (e) {
      avisar(String(e.message ?? e).split(String.fromCharCode(10))[0].replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
    s.transcrevendo = new Map();
    if (s.id === id) desenharMateriais();
  }

  function blocoTranscricao() {
    const box = document.createElement('div');
    box.className = 'materiais-roteiro';
    box.innerHTML = '<h5>Narração nos vídeos</h5><small>Transcreve o áudio dos vídeos no seu computador (Whisper) e mostra quais têm narração. O Claude também lê o resultado.</small>';
    const videos = s.materiais.filter((m) => m.tipo === 'video' && m.temAudio);
    if (!videos.length) {
      const vazio = document.createElement('small');
      vazio.textContent = 'Nenhum vídeo com áudio neste projeto.';
      box.append(vazio);
      return box;
    }
    s.transcricoes ??= {};
    const rodando = !!s.transcrevendo?.size;
    const pendentes = videos.filter((v) => !s.transcricoes[v.arquivo] || s.transcricoes[v.arquivo].desatualizada);
    const botao = document.createElement('button');
    botao.textContent = rodando ? 'Cancelar transcrição' : pendentes.length ? `Transcrever áudio dos vídeos (${pendentes.length})` : 'Transcrever de novo (todos)';
    botao.onclick = () => {
      if (rodando) return api.cancelarTranscricaoVideo();
      if (s.bloqueada) return avisar('Espere o Claude terminar.');
      transcreverVideos((pendentes.length ? pendentes : videos).map((v) => v.arquivo));
    };
    box.append(botao);
    const lista = document.createElement('div');
    lista.className = 'transc-lista';
    for (const v of videos) {
      const r = s.transcricoes[v.arquivo];
      const andamento = s.transcrevendo?.get(v.arquivo);
      if (!r && andamento === undefined) continue;
      const linha = document.createElement('div');
      linha.className = 'transc-linha';
      linha.dataset.arquivo = v.arquivo;
      const topo = document.createElement('div');
      topo.className = 'transc-topo';
      const nome = document.createElement('span');
      nome.className = 'transc-nome';
      nome.textContent = v.arquivo;
      nome.title = v.arquivo;
      const selo = document.createElement('span');
      selo.className = 'transc-selo ' + (andamento !== undefined ? 'andando' : r.veredito);
      selo.textContent = andamento !== undefined ? '…' : ROTULO_FALA[r.veredito];
      topo.append(nome, selo);
      const info = document.createElement('div');
      info.className = 'transc-info';
      info.textContent = andamento !== undefined ? andamento : `${Math.round(r.cobertura * 100)}% do vídeo com fala · ${r.palavras} palavras${r.desatualizada ? ' · o arquivo mudou, transcreva de novo' : ''}`;
      linha.append(topo, info);
      if (r?.texto && andamento === undefined) {
        const texto = document.createElement('div');
        texto.className = 'transc-texto';
        texto.hidden = true;
        texto.textContent = r.texto + (r.texto.length >= 600 ? '…' : '');
        linha.append(texto);
        linha.title = 'Clique para ver o começo do que é falado';
        linha.onclick = () => (texto.hidden = !texto.hidden);
      }
      lista.append(linha);
    }
    box.append(lista);
    return box;
  }

  api.aoTranscreverVideo((e) => {
    if (e.id !== s.id) return;
    if (e.status === 'transcrevendo') {
      s.transcrevendo?.set(e.arquivo, e.texto);
      for (const l of document.querySelectorAll('.transc-linha')) if (l.dataset.arquivo === e.arquivo) l.querySelector('.transc-info').textContent = e.texto;
      return;
    }
    s.transcrevendo?.delete(e.arquivo);
    if (e.status === 'pronto') (s.transcricoes ??= {})[e.arquivo] = e.resumo;
    if (e.status === 'erro') avisar(`Não consegui transcrever ${e.arquivo}: ${e.erro}`);
    desenharMateriais();
  });

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
    const packs = document.createElement('button');
    packs.textContent = 'Packs de edição…';
    packs.title = 'Escolha o que o Claude pode usar e traga arquivos dos packs, sem copiar';
    packs.onclick = () => {
      if (s.bloqueada) return avisar('Espere o Claude terminar.');
      abrirPacksDoProjeto(s.id, async () => {
        await carregarMateriais();
        carregarMidia();
      });
    };
    box.append(importar, pasta, packs, blocoRoteiro(), blocoTranscricao());
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
      info.textContent = m.tipo === 'imagem' ? 'Imagem' : `${(m.duracao ?? 0).toFixed(1)} s${rotuloFala(m.arquivo) ? ' · ' + rotuloFala(m.arquivo) : ''}`;
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

  // Transcrição de tudo o que toca na timeline (clipes com som e áudios), com os tempos dela.
  let transcrevendoTimeline = false;

  function desenharTranscricaoTimeline(r) {
    const lista = qs('#tt-lista');
    lista.replaceChildren();
    const aviso = qs('#tt-aviso');
    aviso.textContent = r.desatualizada ? 'A timeline mudou depois desta transcrição: transcreva de novo (os arquivos já transcritos não são refeitos).' : '';
    if (!r.segmentos.length) {
      const vazio = document.createElement('div');
      vazio.className = 'tt-vazio';
      vazio.textContent = 'Nenhuma fala encontrada no áudio da timeline.';
      lista.append(vazio);
    }
    for (const seg of r.segmentos) {
      const linha = document.createElement('div');
      linha.className = 'tt-linha';
      linha.title = `${seg.arquivo} — clique para ir a este ponto`;
      const tempo = document.createElement('span');
      tempo.className = 'tt-tempo';
      tempo.textContent = formatarTempo(seg.inicio);
      const texto = document.createElement('span');
      texto.textContent = seg.texto;
      linha.append(tempo, texto);
      linha.onclick = () => irPara(seg.inicio);
      lista.append(linha);
    }
    qs('#tt-legendas').disabled = !r.palavras.length;
    qs('#tt-copiar').disabled = !r.segmentos.length;
    qs('#tt-resumo').textContent = `${r.segmentos.length} trechos · ${r.palavras.length} palavras · ${r.arquivos.length} arquivo${r.arquivos.length === 1 ? '' : 's'} com som`;
    s.transcricaoTimeline = r;
    qs('#tt-corpo').dataset.estado = 'pronto';
  }

  async function abrirTranscricaoTimeline(refazer) {
    const dlg = qs('#dlg-transcricao');
    if (!dlg.open) dlg.showModal();
    const id = s.id;
    const salva = refazer ? null : await api.lerTranscricaoTimeline(id);
    if (salva && !salva.desatualizada) return desenharTranscricaoTimeline(salva);
    if (transcrevendoTimeline) return;
    transcrevendoTimeline = true;
    qs('#tt-estado').textContent = 'Preparando…';
    qs('#tt-corpo').dataset.estado = 'rodando';
    try {
      desenharTranscricaoTimeline(await api.transcreverTimeline({ id }));
      qs('#tt-corpo').dataset.estado = 'pronto';
    } catch (e) {
      const msg = String(e.message ?? e).split(String.fromCharCode(10))[0].replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (salva) desenharTranscricaoTimeline(salva);
      qs('#tt-corpo').dataset.estado = salva ? 'pronto' : 'erro';
      qs('#tt-erro').textContent = msg;
    }
    transcrevendoTimeline = false;
  }

  api.aoTranscreverTimeline((e) => {
    if (e.id === s.id) qs('#tt-estado').textContent = e.texto;
  });

  function ligarTranscricaoTimeline() {
    qs('#tl-transcrever').onclick = async () => {
      if (s.bloqueada) return;
      await salvarAgora();
      qs('#tt-lista').replaceChildren();
      qs('#tt-resumo').textContent = '';
      qs('#tt-aviso').textContent = '';
      qs('#tt-erro').textContent = '';
      abrirTranscricaoTimeline(false);
    };
    qs('#tt-refazer').onclick = () => abrirTranscricaoTimeline(true);
    qs('#tt-cancelar').onclick = () => api.cancelarTranscricaoVideo();
    qs('#tt-fechar').onclick = () => qs('#dlg-transcricao').close();
    qs('#tt-copiar').onclick = async () => {
      await navigator.clipboard.writeText(s.transcricaoTimeline.segmentos.map((g) => `[${formatarTempo(g.inicio)}] ${g.texto}`).join(String.fromCharCode(10)));
      avisar('Transcrição copiada.');
    };
    qs('#tt-legendas').onclick = async () => {
      qs('#dlg-transcricao').close();
      if (s.bloqueada) return;
      await salvarAgora();
      guardarEstado();
      try {
        const resumo = await api.legendasTimeline({ id: s.id, opcoes: { daTimeline: true } });
        s.t = await api.lerTimeline(s.id);
        s.sel = null;
        atualizarPrevia();
        desenhar();
        avisar(resumo);
      } catch (e) {
        s.desfazer.pop();
        avisar(e.message.split(String.fromCharCode(10)).at(-1).replace(/^Error: /, ''));
      }
    };
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
    ['estilo.fonte', 'Fonte', 'fonte'], ['estilo.tamanho', 'Tamanho', 'num'], ['estilo.peso', 'Peso', ['400', '600', '800']],
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
    ajuste: [],
  };

  // Liga-se o efeito pela marca; os campos só aparecem com ele ligado.
  const EFEITOS = [
    ['cor', 'Lumetri Color', [
      ['temperatura', 'Temperatura', 1, 0], ['matiz', 'Matiz', 1, 0], ['exposicao', 'Exposição', 0.1, 0], ['contraste', 'Contraste', 1, 0],
      ['destaques', 'Destaques', 1, 0], ['sombras', 'Sombras', 1, 0], ['brancos', 'Brancos', 1, 0], ['pretos', 'Pretos', 1, 0],
      ['saturacao', 'Saturação', 1, 100], ['vibracao', 'Vibração', 1, 0],
    ]],
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
      if (!efeitoCabe(item, id)) continue;
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
      if (marca.checked && id === 'cor') box.append(camposDaLut(item));
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

  // ---------- fontes ----------
  // Do app (Google Fonts), as que o usuário adicionou e todas as instaladas no computador.
  const FONTE_ADICIONAR = '__adicionar__';
  const FONTE_ATUALIZAR = '__atualizar__';

  async function carregarFontes(atualizar = false) {
    s.fontes = await api.listarFontes(atualizar).catch(() => ({ sistema: [], minhas: [] }));
  }

  function preencherFontes(select, atual) {
    select.replaceChildren();
    const grupo = (rotulo, nomes, estilizar) => {
      if (!nomes.length) return;
      const g = document.createElement('optgroup');
      g.label = rotulo;
      for (const nome of nomes) {
        const op = new Option(nome, nome);
        if (estilizar) op.style.fontFamily = `"${nome}"`;
        g.append(op);
      }
      select.append(g);
    };
    const f = s.fontes ?? { sistema: [], minhas: [] };
    const minhas = f.minhas.map((m) => m.familia);
    const conhecidas = new Set([...FONTES, ...minhas, ...f.sistema]);
    if (atual && !conhecidas.has(atual)) select.append(new Option(`${atual} (não encontrada)`, atual));
    grupo('Do app', FONTES, false);
    grupo('Minhas fontes', minhas, false);
    grupo('Instaladas no computador', f.sistema.filter((n) => !FONTES.includes(n) && !minhas.includes(n)), true);
    const acoes = document.createElement('optgroup');
    acoes.label = 'Mais';
    acoes.append(new Option('＋ Adicionar fonte do computador…', FONTE_ADICIONAR), new Option('↻ Atualizar a lista de fontes', FONTE_ATUALIZAR));
    select.append(acoes);
    select.value = atual ?? 'Montserrat';
  }

  // Aplica a fonte escolhida. Fonte adicionada pelo usuário vai para os assets do projeto e entra em "fontes" da timeline.
  async function escolherFonte(item, caminho, select) {
    const anterior = lerCampo(item, caminho);
    let valor = select.value;
    if (valor === FONTE_ATUALIZAR) {
      await carregarFontes(true);
      preencherFontes(select, anterior);
      return;
    }
    if (valor === FONTE_ADICIONAR) {
      const r = await api.adicionarFontes();
      await carregarFontes();
      if (!r?.novas.length) {
        if (r?.ignoradas.length) avisar(`Não consegui ler: ${r.ignoradas.join(', ')}`);
        preencherFontes(select, anterior);
        return;
      }
      valor = r.novas[0];
      preencherFontes(select, valor);
      avisar(r.novas.length > 1 ? `${r.novas.length} fontes adicionadas; usando ${valor}.` : `Fonte ${valor} adicionada.`);
    }
    if (s.fontes?.minhas.some((m) => m.familia === valor)) {
      const arquivo = await api.prepararFonte({ id: s.id, familia: valor });
      if (arquivo) s.t.fontes = { ...s.t.fontes, [valor]: arquivo };
    }
    aoEditarCampo(item, caminho, valor);
  }

  function criarCampo(item, [caminho, titulo, tipo, passo, padrao]) {
    const rotulo = document.createElement('label');
    rotulo.textContent = titulo;
    const atual = lerCampo(item, caminho);
    let entrada;
    const emitir = () => {
      if (tipo === 'fonte') return escolherFonte(item, caminho, entrada);
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
      // Volume é digitado em % (0 a 100) e gravado de 0 a 1.
      if (tipo === 'faixa') {
        const n = Number(String(bruto).replace(',', '.'));
        if (bruto === '' || !Number.isFinite(n)) return;
        aoEditarCampo(item, caminho, Math.round(Math.max(0, Math.min(100, n))) / 100);
        return;
      }
      const numerico = tipo === 'num' || caminho === 'estilo.peso';
      aoEditarCampo(item, caminho, numerico && bruto !== '' ? Number(bruto) : bruto === false ? '' : bruto);
    };
    if (tipo === 'fonte') {
      entrada = document.createElement('select');
      preencherFontes(entrada, atual);
    } else if (Array.isArray(tipo)) {
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
        entrada.type = 'number';
        entrada.min = 0;
        entrada.max = 100;
        entrada.step = 1;
        entrada.value = Math.round((atual ?? passo ?? 1) * 100);
        rotulo.firstChild.textContent = `${titulo} (%)`;
        // Ao sair do campo, mostra o valor que ficou gravado (fora de 0 a 100 volta ao limite).
        entrada.addEventListener('blur', () => (entrada.value = Math.round((lerCampo(item, caminho) ?? passo ?? 1) * 100)));
      } else if (tipo === 'cor') {
        entrada.type = 'color';
        entrada.value = atual ?? '#ffffff';
      } else if (tipo === 'marca') {
        entrada.type = 'checkbox';
        entrada.checked = !!atual;
      }
    }
    if (tipo !== 'fonte') entrada.addEventListener('input', emitir);
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
      box.innerHTML = '<h4>Atalhos</h4>';
      box.append(listaDeAtalhos());
      return;
    }
    const titulo = document.createElement('h4');
    titulo.textContent = { video: 'Vídeo', imagem: 'Imagem', audio: 'Áudio', texto: 'Texto', legenda: 'Legenda', bloco: `Efeito: ${item.componente}`, ajuste: 'Camada de ajuste' }[item.tipo];
    if (item.tipo === 'ajuste') {
      const dica = document.createElement('div');
      dica.className = 'tl-inspetor-tempo';
      dica.textContent = 'Os efeitos valem para tudo o que está nas faixas de vídeo abaixo dela.';
      titulo.after(dica);
    }
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
    if (trilhaDoItem && !ehAudio(trilhaDoItem) && item.tipo !== 'ajuste') box.append(secaoTransicao(item, trilhaDoItem));
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

  // ---------- efeitos: catálogo, aba Efeitos, camada de ajuste e menu do botão direito (como no Filmcraft) ----------

  // Pastas como as do painel Efeitos do Filmcraft, só com o que a prévia e o render do app desenham.
  // Os ids são os de item.efeitos (ver EFEITOS); cada um vira o efeito equivalente do Filmcraft na ida.
  const CATALOGO_EFEITOS = [
    ['Correção de cor', [['cor', 'Lumetri Color'], ['pb', 'Preto e branco'], ['inverter', 'Inverter']]],
    ['Desfoque e nitidez', [['desfoque', 'Desfoque gaussiano']]],
    ['Transformar', [['corte', 'Cortar'], ['espelhoH', 'Espelhar na horizontal'], ['espelhoV', 'Espelhar na vertical']]],
    ['Estilizar', [['vinheta', 'Vinheta']]],
  ];
  // Predefinições Lumetri: pontos de partida da correção básica e criativa.
  const PRESETS_LUMETRI = [
    ['Cinema quente', { temperatura: 22, matiz: 4, contraste: 15, destaques: -15, sombras: -8, saturacao: 108 }],
    ['Teal & orange', { temperatura: 12, matiz: -8, contraste: 20, saturacao: 112, vibracao: 22, sombras: -10 }],
    ['Frio azulado', { temperatura: -28, contraste: 10, saturacao: 95, destaques: -5 }],
    ['Hora dourada', { temperatura: 38, exposicao: 0.15, destaques: -12, vibracao: 15 }],
    ['Filme desbotado', { contraste: -25, pretos: 30, saturacao: 82, destaques: -10 }],
    ['Alto contraste', { contraste: 40, brancos: 15, pretos: -15, vibracao: 10 }],
    ['P&B dramático', { saturacao: 0, contraste: 35, brancos: 10, pretos: -10 }],
    ['Noite', { temperatura: -40, exposicao: -0.8, saturacao: 70, destaques: -20 }],
    ['Vivo (Reels)', { contraste: 12, vibracao: 35, saturacao: 110, sombras: 10 }],
  ];
  const NAO_CABE_NO_AJUSTE = new Set(['corte', 'espelhoH', 'espelhoV']);
  const efeitoCabe = (item, id) => item.tipo !== 'audio' && item.tipo !== 'legenda' && !(item.tipo === 'ajuste' && NAO_CABE_NO_AJUSTE.has(id));
  const nomeDoEfeito = (id) => EFEITOS.find(([x]) => x === id)?.[1] ?? id;
  const padroesDe = (id) => {
    const campos = EFEITOS.find(([x]) => x === id)?.[2];
    return campos ? Object.fromEntries(campos.map(([c, , , p]) => [c, p])) : true;
  };

  const itensAlvo = (ids) => todosItens().filter((i) => ids.includes(i.id));

  // Liga o efeito nos itens (mantém os valores de quem já o tinha).
  function aplicarEfeito(ids, id) {
    const alvos = itensAlvo(ids).filter((i) => efeitoCabe(i, id));
    if (!alvos.length) return avisar(`${nomeDoEfeito(id)} não cabe nesse item.`);
    alterar(() => {
      for (const i of alvos) {
        i.efeitos ??= {};
        if (!i.efeitos[id]) i.efeitos[id] = padroesDe(id);
      }
    });
    avisar(`${nomeDoEfeito(id)} aplicado a ${alvos.length > 1 ? `${alvos.length} itens` : rotuloItem(alvos[0])}.`);
  }

  function aplicarPreset(ids, nome) {
    const valores = PRESETS_LUMETRI.find(([n]) => n === nome)?.[1];
    const alvos = itensAlvo(ids).filter((i) => efeitoCabe(i, 'cor'));
    if (!valores || !alvos.length) return;
    alterar(() => {
      for (const i of alvos) {
        i.efeitos ??= {};
        const lut = i.efeitos.cor?.lut ? { lut: i.efeitos.cor.lut, lutIntensidade: i.efeitos.cor.lutIntensidade } : {};
        i.efeitos.cor = { ...padroesDe('cor'), ...valores, ...lut };
        for (const p of Object.keys(i.keyframes ?? {})) if (p.startsWith('efeitos.cor.')) delete i.keyframes[p];
        limparKeyframes(i);
      }
    });
    avisar(`Predefinição "${nome}" aplicada.`);
  }

  function removerEfeitos(ids) {
    const alvos = itensAlvo(ids).filter((i) => i.efeitos);
    if (!alvos.length) return;
    alterar(() => {
      for (const i of alvos) {
        delete i.efeitos;
        for (const p of Object.keys(i.keyframes ?? {})) if (p.startsWith('efeitos.')) delete i.keyframes[p];
        limparKeyframes(i);
      }
    });
  }

  // Transição de entrada: a mesma regra do inspetor (encosta no anterior, se houver; alinha onde houver sobra).
  function aplicarTransicaoEntrada(ids, tipo, duracao = 0.5) {
    const alvos = itensAlvo(ids).filter((i) => !ehAudio(trilhaDe(i.id)) && i.tipo !== 'ajuste');
    if (!alvos.length) return;
    let seco = false;
    alterar(() => {
      for (const item of alvos) {
        const trilha = trilhaDe(item.id);
        const atual = (trilha.transicoes ?? []).find((x) => x.para === item.id);
        trilha.transicoes = (trilha.transicoes ?? []).filter((x) => x.para !== item.id);
        if (tipo) {
          const { antes } = vizinhos(item, trilha);
          const d = Math.max(umQuadro(), duracao);
          const lugar = alinhamentoPossivel(antes, item, d);
          if (!lugar) seco = true;
          trilha.transicoes.push({ id: atual?.id ?? novoId(), tipo, duracao: arredondar(d), alinhamento: lugar ?? 'centro', ...(antes ? { de: antes.id } : {}), para: item.id });
        }
        if (!trilha.transicoes.length) delete trilha.transicoes;
      }
    });
    if (seco) avisar('Falta sobra de arquivo em algum clipe: a transição fica seca em parte. Apare as pontas para dar folga.');
  }

  // Camada de ajuste: na faixa pedida se ela estiver livre nesse trecho; senão na faixa de vídeo mais alta, se livre;
  // senão numa faixa nova acima de tudo.
  function novaCamadaAjuste(inicio = s.tempo, duracao = 5, faixa = null) {
    if (s.bloqueada) return;
    const a = noQuadro(Math.max(0, inicio));
    const d = Math.max(umQuadro(), arredondar(duracao));
    const livre = (tr) => tr && !ehAudio(tr) && !tr.itens.some((o) => o.inicio < a + d - 0.001 && o.inicio + o.duracao > a + 0.001);
    const item = { id: novoId(), tipo: 'ajuste', inicio: a, duracao: d, efeitos: { cor: padroesDe('cor') } };
    alterar(() => {
      const topo = s.t.trilhas.filter((tr) => !ehAudio(tr)).at(-1);
      const tr = livre(faixa) ? faixa : livre(topo) ? topo : novaFaixa('video', { acimaDeTudo: true });
      tr.itens.push(item);
    });
    selecionar(item.id);
    mostrarAba('inspetor');
  }

  // Velocidade pelo menu: o trecho do arquivo fica o mesmo, a duração na timeline muda (com o vinculado junto).
  function mudarVelocidade(ids, v) {
    const alvos = itensAlvo(ids).filter((i) => i.tipo === 'video' || i.tipo === 'audio');
    if (!alvos.length) return;
    alterar(() => {
      for (const i of alvos) {
        const trecho = i.duracao * (i.velocidade ?? 1);
        const dur = arredondar(trecho / v);
        const fator = dur / i.duracao;
        for (const kfs of Object.values(i.keyframes ?? {})) for (const k of kfs) k.t = arredondar(k.t * fator);
        i.duracao = dur;
        if (v === 1) delete i.velocidade;
        else i.velocidade = v;
      }
    });
  }

  function vincular(ids) {
    const alvos = itensAlvo(ids);
    if (alvos.length < 2) return;
    const v = 'k' + novoId();
    alterar(() => alvos.forEach((i) => (i.vinculo = v)));
  }

  function desvincular(ids) {
    const alvos = itensAlvo(ids).filter((i) => i.vinculo);
    if (!alvos.length) return;
    const vinculos = new Set(alvos.map((i) => i.vinculo));
    alterar(() => todosItens().forEach((i) => vinculos.has(i.vinculo) && delete i.vinculo));
  }

  // ---------- LUTs (.cube em assets/) ----------

  async function carregarLuts() {
    const id = s.id;
    try {
      const luts = await api.listarLuts(id);
      if (s.id === id) s.luts = luts;
    } catch {
      s.luts = [];
    }
  }

  function camposDaLut(item) {
    const caixa = document.createElement('div');
    caixa.className = 'ins-lut';
    const rotulo = document.createElement('label');
    rotulo.textContent = 'LUT';
    const sel = document.createElement('select');
    const atual = item.efeitos?.cor?.lut ?? '';
    for (const [v, t] of [['', 'Nenhuma'], ...(s.luts ?? []).map((n) => [n, n.replace(/\.cube$/i, '')])]) sel.append(new Option(t, v));
    if (atual && !(s.luts ?? []).includes(atual)) sel.append(new Option(`${atual} (não encontrada)`, atual));
    sel.value = atual;
    sel.onchange = () =>
      alterar(() => {
        if (sel.value) item.efeitos.cor.lut = sel.value;
        else {
          delete item.efeitos.cor.lut;
          delete item.efeitos.cor.lutIntensidade;
        }
      });
    rotulo.append(sel);
    const carregar = document.createElement('button');
    carregar.textContent = 'Carregar LUT…';
    carregar.title = 'Copia um arquivo .cube para os materiais do projeto';
    carregar.disabled = s.bloqueada;
    carregar.onclick = async () => {
      try {
        const nomes = await api.importarLuts(s.id);
        if (!nomes.length) return;
        await carregarLuts();
        alterar(() => {
          item.efeitos.cor.lut = nomes[0];
        });
        avisar(nomes.length > 1 ? `${nomes.length} LUTs carregadas; "${nomes[0]}" aplicada.` : `LUT "${nomes[0]}" aplicada.`);
      } catch (e) {
        avisar('LUT: ' + e.message.split('\n').at(-1).replace(/^Error: /, ''));
      }
    };
    caixa.append(rotulo, carregar);
    if (atual) caixa.append(criarCampo(item, ['efeitos.cor.lutIntensidade', 'Intensidade da LUT (%)', 'num', 1, 100]));
    return caixa;
  }

  // ---------- aba Efeitos ----------

  function entradaDeEfeito(nome, pedido, aoDuploClique, dica) {
    const el = document.createElement('div');
    el.className = 'fx-item';
    el.textContent = nome;
    el.title = dica ?? 'Arraste para um clipe ou clique duas vezes para aplicar aos selecionados';
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      s.arrastandoEfeito = pedido;
      e.dataTransfer.setData('text/plain', nome);
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('dragend', () => {
      s.arrastandoEfeito = null;
      limparAlvosDeSoltar();
    });
    el.addEventListener('dblclick', aoDuploClique);
    return el;
  }

  function desenharEfeitos() {
    const box = qs('#efeitos');
    if (!box) return;
    const busca = (s.buscaEfeitos ?? '').trim().toLowerCase();
    const casa = (n) => !busca || n.toLowerCase().includes(busca);
    box.innerHTML = '';
    const topo = document.createElement('div');
    topo.className = 'fx-topo';
    const campo = document.createElement('input');
    campo.type = 'search';
    campo.placeholder = 'Procurar efeitos';
    campo.value = s.buscaEfeitos ?? '';
    campo.oninput = () => {
      s.buscaEfeitos = campo.value;
      const pos = campo.selectionStart;
      desenharEfeitos();
      const novo = qs('#efeitos input[type=search]');
      novo?.focus();
      novo?.setSelectionRange(pos, pos);
    };
    topo.append(campo);
    box.append(topo);
    const selecionados = () => [...s.selecao];
    const semSelecao = () => avisar('Selecione um ou mais clipes na timeline, ou arraste o efeito até o clipe.');
    const pasta = (titulo, filhos, aberta = true) => {
      if (!filhos.length) return null;
      const d = document.createElement('details');
      d.className = 'fx-pasta';
      d.open = aberta || !!busca;
      const sum = document.createElement('summary');
      sum.textContent = titulo;
      d.append(sum, ...filhos);
      return d;
    };
    const ajuste = entradaDeEfeito('◐ Camada de ajuste', { tipo: 'ajuste' }, () => novaCamadaAjuste(), 'Arraste para uma faixa de vídeo, ou clique duas vezes para criar no cursor');
    if (casa('camada de ajuste')) box.append(pasta('Novo item', [ajuste]));
    const presets = PRESETS_LUMETRI.filter(([n]) => casa(n)).map(([n]) =>
      entradaDeEfeito(n, { tipo: 'preset', id: n }, () => (s.selecao.size ? aplicarPreset(selecionados(), n) : semSelecao())),
    );
    const p1 = pasta('Predefinições Lumetri', presets, false);
    if (p1) box.append(p1);
    const subpastas = CATALOGO_EFEITOS.map(([sub, lista]) =>
      pasta(sub, lista.filter(([, n]) => casa(n)).map(([id, n]) => entradaDeEfeito(n, { tipo: 'efeito', id }, () => (s.selecao.size ? aplicarEfeito(selecionados(), id) : semSelecao())))),
    ).filter(Boolean);
    const p2 = pasta('Efeitos de vídeo', subpastas);
    if (p2) box.append(p2);
    const transicoes = TRANSICOES.filter(([id, n]) => id && casa(n)).map(([id, n]) =>
      entradaDeEfeito(n, { tipo: 'transicao', id }, () => (s.selecao.size ? aplicarTransicaoEntrada(selecionados(), id) : semSelecao()), 'Arraste para o começo de um clipe, ou clique duas vezes para pôr na entrada dos selecionados'),
    );
    const p3 = pasta('Transições de vídeo', transicoes, false);
    if (p3) box.append(p3);
    if (!box.querySelector('.fx-item')) {
      const vazio = document.createElement('div');
      vazio.className = 'tl-inspetor-tempo';
      vazio.textContent = 'Nada com esse nome.';
      box.append(vazio);
    }
  }

  // Soltar um efeito num clipe (se o clipe faz parte da seleção, vale para a seleção toda), uma transição no começo
  // dele, e a camada de ajuste numa faixa de vídeo, no ponto do mouse.
  function ligarSoltarEfeitos() {
    const trilhas = qs('#tl-trilhas');
    const alvoDe = (e) => {
      const p = s.arrastandoEfeito;
      if (p.tipo === 'ajuste') {
        const pista = e.target.closest('.tl-pista');
        const tr = pista && s.t.trilhas.find((x) => x.id === pista.dataset.trilha);
        return tr && !ehAudio(tr) ? { el: pista, tr } : null;
      }
      const clipe = e.target.closest('.tl-item');
      const it = clipe && todosItens().find((i) => i.id === clipe.dataset.id);
      if (!it) return null;
      if (p.tipo === 'transicao' ? ehAudio(trilhaDe(it.id)) || it.tipo === 'ajuste' : !efeitoCabe(it, p.tipo === 'preset' ? 'cor' : p.id)) return null;
      return { el: clipe, it };
    };
    trilhas.addEventListener('dragover', (e) => {
      if (!s.arrastandoEfeito || s.bloqueada) return;
      limparAlvosDeSoltar();
      const alvo = alvoDe(e);
      if (!alvo) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      alvo.el.classList.add(alvo.it ? 'alvo-troca' : 'alvo-soltar');
      if (s.arrastandoEfeito.tipo === 'ajuste') mostrarGuia(imantar(tempoDoEvento(e), pontosDeImã(null)).valor);
    });
    trilhas.addEventListener('drop', (e) => {
      const p = s.arrastandoEfeito;
      if (!p || s.bloqueada) return;
      const alvo = alvoDe(e);
      e.preventDefault();
      limparAlvosDeSoltar();
      s.arrastandoEfeito = null;
      if (!alvo) return;
      if (p.tipo === 'ajuste') return novaCamadaAjuste(imantar(tempoDoEvento(e), pontosDeImã(null)).valor, 5, alvo.tr);
      const ids = s.selecao.has(alvo.it.id) ? [...s.selecao] : [alvo.it.id];
      if (p.tipo === 'efeito') aplicarEfeito(ids, p.id);
      else if (p.tipo === 'preset') aplicarPreset(ids, p.id);
      else if (p.tipo === 'transicao') aplicarTransicaoEntrada(ids, p.id);
      if (!s.selecao.has(alvo.it.id)) selecionar(alvo.it.id);
    });
  }

  // ---------- menu do botão direito ----------

  function fecharMenu() {
    document.querySelector('.tl-menu')?.remove();
    window.removeEventListener('pointerdown', foraDoMenu, true);
    window.removeEventListener('keydown', escDoMenu, true);
    window.removeEventListener('blur', fecharMenu);
  }
  function foraDoMenu(e) {
    if (!e.target.closest?.('.tl-menu')) fecharMenu();
  }
  function escDoMenu(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    fecharMenu();
  }

  // entradas: { rotulo, acao, atalho, desativado, sub: [entradas] } | 'sep' | falsy (ignorada)
  function montarMenu(entradas) {
    const ul = document.createElement('div');
    ul.className = 'tl-menu-lista';
    let anterior = 'sep';
    for (const e of entradas.filter(Boolean)) {
      if (e === 'sep') {
        if (anterior !== 'sep') ul.append(Object.assign(document.createElement('div'), { className: 'tl-menu-sep' }));
        anterior = 'sep';
        continue;
      }
      anterior = e;
      const li = document.createElement('div');
      li.className = 'tl-menu-item' + (e.desativado ? ' desativado' : '') + (e.sub ? ' com-sub' : '');
      const r = document.createElement('span');
      r.textContent = e.rotulo;
      const a = document.createElement('span');
      a.className = 'tl-menu-atalho';
      a.textContent = e.sub ? '▸' : e.atalho ?? '';
      li.append(r, a);
      if (e.sub && !e.desativado) {
        const sub = montarMenu(e.sub);
        sub.classList.add('tl-menu-sub');
        li.append(sub);
        li.addEventListener('pointerenter', () => {
          // Abre para o lado que cabe na tela.
          sub.classList.remove('para-esquerda');
          const r2 = li.getBoundingClientRect();
          if (r2.right + 220 > window.innerWidth) sub.classList.add('para-esquerda');
        });
      } else if (!e.desativado && e.acao) {
        li.addEventListener('click', () => {
          fecharMenu();
          e.acao();
        });
      }
      ul.append(li);
    }
    if (ul.lastChild?.classList?.contains('tl-menu-sep')) ul.lastChild.remove();
    return ul;
  }

  function abrirMenu(x, y, entradas) {
    fecharMenu();
    const menu = document.createElement('div');
    menu.className = 'tl-menu';
    menu.append(montarMenu(entradas));
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    setTimeout(() => {
      window.addEventListener('pointerdown', foraDoMenu, true);
      window.addEventListener('keydown', escDoMenu, true);
      window.addEventListener('blur', fecharMenu);
    });
  }

  function menuDoItem(e, item) {
    e.preventDefault();
    e.stopPropagation();
    if (!s.selecao.has(item.id)) selecionar(item.id);
    const ids = [...s.selecao];
    const alvos = itensAlvo(ids);
    const travada = s.bloqueada;
    const visuais = alvos.filter((i) => !ehAudio(trilhaDe(i.id)));
    const comFonte = alvos.filter((i) => i.tipo === 'video' || i.tipo === 'audio');
    const midias = alvos.filter((i) => i.tipo === 'video' || i.tipo === 'imagem');
    const noCursor = alvos.some((i) => i.inicio < s.tempo - 0.001 && i.inicio + i.duracao > s.tempo + 0.001);
    const vinculados = alvos.some((i) => i.vinculo);
    const cabe = (id) => visuais.some((i) => efeitoCabe(i, id));
    const menuEfeitos = CATALOGO_EFEITOS.map(([pasta, lista]) => ({
      rotulo: pasta,
      sub: lista.map(([id, n]) => ({ rotulo: n, acao: () => aplicarEfeito(ids, id), desativado: !cabe(id) })),
    }));
    const vel = comFonte.length === 1 ? comFonte[0].velocidade ?? 1 : null;
    abrirMenu(e.clientX, e.clientY, [
      { rotulo: 'Recortar', atalho: teclaDe('recortar'), acao: () => copiarSelecao() && excluir(false), desativado: travada },
      { rotulo: 'Copiar', atalho: teclaDe('copiar'), acao: copiarSelecao },
      { rotulo: 'Colar no cursor', atalho: teclaDe('colar'), acao: colarSelecao, desativado: travada || !areaTransferencia },
      { rotulo: 'Excluir', atalho: teclaDe('excluir'), acao: () => excluir(false), desativado: travada },
      { rotulo: 'Excluir e fechar o vão', atalho: teclaDe('excluirFechar'), acao: () => excluir(true), desativado: travada },
      'sep',
      { rotulo: 'Dividir no cursor', atalho: teclaDe('dividir'), acao: dividir, desativado: travada || !noCursor },
      alvos.length > 1 && !vinculados && { rotulo: 'Vincular', acao: () => vincular(ids), desativado: travada },
      vinculados && { rotulo: 'Desvincular', acao: () => desvincular(ids), desativado: travada },
      'sep',
      visuais.length && { rotulo: 'Adicionar efeito', sub: menuEfeitos, desativado: travada },
      visuais.length && { rotulo: 'Predefinição Lumetri', sub: PRESETS_LUMETRI.map(([n]) => ({ rotulo: n, acao: () => aplicarPreset(ids, n) })), desativado: travada || !cabe('cor') },
      visuais.some((i) => i.tipo !== 'ajuste') && {
        rotulo: 'Transição de entrada',
        sub: TRANSICOES.map(([id, n]) => ({ rotulo: n, acao: () => aplicarTransicaoEntrada(ids, id) })),
        desativado: travada,
      },
      alvos.some((i) => i.efeitos) && { rotulo: 'Remover efeitos', acao: () => removerEfeitos(ids), desativado: travada },
      'sep',
      midias.length && { rotulo: 'Ajustar ao quadro', acao: () => alterar(() => midias.forEach((i) => (i.ajuste = 'contain'))), desativado: travada },
      midias.length && { rotulo: 'Preencher o quadro', acao: () => alterar(() => midias.forEach((i) => (i.ajuste = 'cover'))), desativado: travada },
      comFonte.length && {
        rotulo: 'Velocidade',
        sub: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4].map((v) => ({ rotulo: `${String(v).replace('.', ',')}x${vel === v ? '  ✓' : ''}`, acao: () => mudarVelocidade(ids, v) })),
        desativado: travada,
      },
      'sep',
      visuais.length && {
        rotulo: 'Camada de ajuste por cima',
        acao: () => {
          const ini = Math.min(...alvos.map((i) => i.inicio));
          novaCamadaAjuste(ini, Math.max(...alvos.map((i) => i.inicio + i.duracao)) - ini);
        },
        desativado: travada,
      },
    ]);
  }

  function menuDaFaixa(e, trilha) {
    e.preventDefault();
    const t = noQuadro(imantar(tempoDoEvento(e), pontosDeImã(null)).valor);
    const travada = s.bloqueada;
    const audio = ehAudio(trilha);
    abrirMenu(e.clientX, e.clientY, [
      { rotulo: 'Colar aqui', acao: () => { irPara(t); colarSelecao(); }, desativado: travada || !areaTransferencia },
      !audio && { rotulo: 'Nova camada de ajuste aqui', acao: () => novaCamadaAjuste(t, 5, trilha), desativado: travada },
      'sep',
      { rotulo: 'Nova faixa de vídeo', acao: () => alterar(() => novaFaixa('video', { acimaDeTudo: true })), desativado: travada },
      { rotulo: 'Nova faixa de áudio', acao: () => alterar(() => novaFaixa('audio')), desativado: travada },
      !trilha.itens.length && s.t.trilhas.filter((x) => ehAudio(x) === audio).length > 1 && {
        rotulo: 'Remover esta faixa',
        acao: () => alterar(() => s.t.trilhas.splice(s.t.trilhas.indexOf(trilha), 1)),
        desativado: travada,
      },
    ]);
  }

  // ---------- teclado e mouse ----------

  // Como no Filmcraft: o painel clicado por último fica marcado e recebe os atalhos. A timeline recebe todos; o
  // player, só os de reprodução; nos outros painéis (materiais, propriedades, efeitos, Claude) só valem desfazer,
  // refazer e a lista de atalhos, para Delete, Ctrl+C, setas e letras não mexerem na timeline sem querer.
  const AREAS = [['#tl', 'timeline'], ['#painel-previa', 'player'], ['#painel-materiais', 'materiais'], ['#painel-propriedades', 'propriedades'], ['#painel-efeitos', 'efeitos'], ['#painel-origem', 'origem'], ['#painel-claude', 'claude']];
  const GLOBAIS = new Set(['desfazer', 'refazer', 'atalhos']);
  const valeNaArea = (acao) => GLOBAIS.has(acao[0]) || s.area === 'timeline' || (s.area === 'player' && acao[1] === 'Reprodução');

  function marcarArea(area) {
    s.area = area;
    for (const [sel, nome] of AREAS) qs(sel)?.classList.toggle('area-ativa', nome === area);
  }

  function aoClicarArea(e) {
    if (!ativa() || estado.vista !== 'editor') return;
    const achada = AREAS.find(([sel]) => e.target.closest?.(sel));
    if (achada) marcarArea(achada[1]);
  }

  function aoTeclar(e) {
    if (!ativa() || estado.vista !== 'editor') return;
    if (e.target.closest?.('input, textarea, select, dialog')) return;
    if (s.gravandoAtalho) return;
    if (teclaDaFonte(e)) return;
    const acao = acaoDoCombo(comboDe(e), ACOES_TECLADO);
    if (!acao || !valeNaArea(acao)) return;
    e.preventDefault();
    acao[4]();
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
    ligarTranscricaoTimeline();
    ligarSoltarMateriais();
    ligarSoltarEfeitos();
    desenharEfeitos();
    atualizarDicas();
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
    window.addEventListener('pointerdown', aoClicarArea, true);
    marcarArea('timeline');
    areaDeSoltar(qs('#tl'), adicionarArquivos);
    areaDeSoltar(qs('#materiais'), adicionarAoProjeto);
    qs('#seg-player').querySelectorAll('button').forEach((b) => {
      b.onclick = () => (b.dataset.v === 'previa' ? verPrevia() : verRender());
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
    s.pastasAbertas = new Set();
    s.sel = null;
    s.desfazer = [];
    s.refazer = [];
    s.tempo = 0;
    s.tocando = false;
    s.t = await api.lerTimeline(p.id);
    if (s.id !== p.id) return;
    qs('#tl').hidden = false;
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
    qs('#tl').hidden = true;
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

  return { abrirAtalhos, atualizarDicas, abrir, fechar, bloquear, recarregar, contexto, capa, salvarAgora, verRender, ativa: () => !!s.t, estado: s, irPara, dividir, excluir, adicionarTexto, gerarLegendas };
})();
