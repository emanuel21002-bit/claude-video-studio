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

  const s = {
    id: null,
    t: null,
    previa: null,
    midia: {},
    sel: null,
    pps: 40,
    ima: true,
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

  function aposAlterar() {
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
    qs('#tl').classList.toggle('bloqueada', s.bloqueada);
    qs('#tl-ima').classList.toggle('ativo', s.ima);
    qs('#tl-total').textContent = formatarTempo(duracaoTotal());
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

  function desenharCursor() {
    if (!s.t) return;
    qs('#tl-cursor').style.left = LARGURA_CAB + s.tempo * s.pps + 'px';
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

  function iniciarArraste(e, item, trilha, modo) {
    if (e.button !== 0) return;
    e.stopPropagation();
    selecionar(item.id);
    if (s.bloqueada) return;
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
      if (destino !== trilha) {
        trilha.itens.splice(trilha.itens.indexOf(item), 1);
        destino.itens.push(item);
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
    ['rotacao', 'Rotação', 'num'], ['opacidade', 'Opacidade', 'faixa', 1],
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
    return rotulo;
  }

  function desenharInspetor() {
    const box = qs('#inspetor');
    // Não reconstrói enquanto o usuário digita num campo do próprio inspetor.
    if (box.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON' && box.dataset.item === String(s.sel)) return;
    box.innerHTML = '';
    box.dataset.item = String(s.sel);
    const item = itemSel();
    if (!item) {
      box.innerHTML = `<h4>Atalhos</h4><dl class="tl-atalhos">
        <dt>Espaço</dt><dd>tocar / pausar</dd><dt>S</dt><dd>dividir no cursor</dd>
        <dt>Del</dt><dd>excluir</dd><dt>Shift+Del</dt><dd>excluir e fechar o vão</dd>
        <dt>← →</dt><dd>um quadro</dd><dt>Ctrl+Z / Y</dt><dd>desfazer / refazer</dd>
        <dt>Ctrl+roda</dt><dd>zoom</dd></dl>`;
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
    else if (e.key === 'Delete' || e.key === 'Backspace') excluir(e.shiftKey);
    else if (e.key === 'ArrowLeft') irPara(s.tempo - (e.shiftKey ? 1 : 1 / fps()));
    else if (e.key === 'ArrowRight') irPara(s.tempo + (e.shiftKey ? 1 : 1 / fps()));
    else if (e.key === 'Home') irPara(0);
    else if (e.key === 'End') irPara(duracaoTotal());
    else return;
    e.preventDefault();
  }

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
    const arquivos = [...new Set(todosItens().map((i) => i.arquivo).filter(Boolean))].filter((a) => !s.midia[a]);
    for (const arquivo of arquivos) {
      const m = await api.midiaTimeline({ id, arquivo }).catch(() => null);
      if (s.id !== id) return;
      if (m) {
        s.midia[arquivo] = m;
        desenhar();
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
    qs('#inspetor').hidden = false;
    qs('#seg-player').hidden = false;
    avisar('');
    qs('#tl-tocar').textContent = '▶';
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
    qs('#inspetor').hidden = true;
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
