const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = window.studio;

const estado = {
  catalogo: null,
  config: null,
  ambiente: null,
  materiais: [], // caminhos
  narracoes: [], // { nome, arquivos, duracao }; cada uma vira um vídeo
  semNarracao: false,
  estiloId: 'reels-estetica',
  engine: 'remotion',
  formato: '9:16',
  projetoId: null,
  trabalhando: new Set(),
  naFila: new Set(),
};

const urlArquivo = (p) => 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
const nomeArquivo = (p) => p.split(/[\\/]/).pop();

function mostrarVista(nome) {
  estado.vista = nome;
  $$('.vista').forEach((v) => v.classList.toggle('ativa', v.id === 'v-' + nome));
}

// ---------- segmentados ----------

function segmentado(el, valor, aoMudar) {
  el.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.v === valor);
    b.onclick = (e) => {
      e.preventDefault();
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('ativo', x === b));
      aoMudar(b.dataset.v);
    };
  });
}

// ---------- ambiente / setup ----------

async function verificarAmbiente() {
  estado.ambiente = await api.ambiente();
  const a = estado.ambiente;
  const pill = $('#pill-claude');
  pill.textContent = a.claude.conectado ? `Claude: ${a.claude.metodo}` : 'Claude: entrar';
  pill.className = 'pill ' + (a.claude.conectado ? 'ok' : 'erro');
  return a.workspacePronto && a.claude.conectado && a.node && a.ffmpeg;
}

function renderChecklist() {
  const a = estado.ambiente;
  const itens = [
    { ok: a.claude.conectado, t: 'Conta do Claude', d: a.claude.conectado ? a.claude.metodo : 'Entre com sua conta Claude (Pro/Max) ou coloque uma chave de API nas configurações.', acao: a.claude.conectado ? null : ['Entrar no Claude', entrarClaude] },
    { ok: a.node, t: 'Node.js', d: 'Usado para rodar o Remotion e o HyperFrames.' },
    { ok: a.ffmpeg, t: 'FFmpeg', d: a.nvenc ? 'Com NVENC: render por GPU disponível.' : 'Sem NVENC: só render por CPU.' },
    { ok: a.whisper, t: 'Whisper (transcrição)', d: a.whisper ? 'Pronto para transcrever narrações.' : 'Opcional. Sem ele o Claude monta sem legendas sincronizadas.', opcional: true },
    { ok: a.workspacePronto, t: 'Remotion + HyperFrames', d: a.workspacePronto ? a.workspace : `Instala as engines em ${a.workspace}`, acao: a.workspacePronto ? null : ['Instalar', instalarWorkspace] },
  ];
  const ul = $('#checklist');
  ul.innerHTML = '';
  for (const i of itens) {
    const li = document.createElement('li');
    li.className = i.ok ? 'ok' : 'falta';
    li.innerHTML = `<span class="marca-check">${i.ok ? '✓' : i.opcional ? '–' : '✕'}</span><div class="item-txt">${i.t}<small></small></div>`;
    li.querySelector('small').textContent = i.d;
    if (i.acao) {
      const b = document.createElement('button');
      b.className = 'primario';
      b.textContent = i.acao[0];
      b.onclick = () => i.acao[1](b);
      li.append(b);
    }
    ul.append(li);
  }
}

async function entrarClaude() {
  await api.loginClaude();
  logSetup(
    'Abri o navegador e uma janela preta de login.\n' +
      '1. Entre na sua conta Claude no navegador e autorize.\n' +
      '2. Copie o código que a página mostrar.\n' +
      '3. Cole o código na janela preta e aperte Enter.\n' +
      'Esperando o login…',
  );
  const t = setInterval(async () => {
    const s = await api.statusClaude();
    if (s.conectado) {
      clearInterval(t);
      logSetup('Conectado ao Claude.');
      iniciar();
    }
  }, 3000);
}

async function instalarWorkspace(botao) {
  botao.disabled = true;
  botao.textContent = 'Instalando…';
  try {
    await api.prepararWorkspace();
  } catch (e) {
    logSetup('Falhou: ' + e.message);
  }
  iniciar();
}

function logSetup(l) {
  const el = $('#setup-log');
  el.textContent += l + '\n';
  el.scrollTop = el.scrollHeight;
}

// ---------- projetos ----------

async function carregarProjetos() {
  const lista = await api.projetos();
  const ul = $('#lista-projetos');
  ul.innerHTML = '';
  if (!lista.length) ul.innerHTML = '<li class="p-meta">Nenhum vídeo ainda.</li>';
  for (const p of lista) {
    const li = document.createElement('li');
    li.className = p.id === estado.projetoId ? 'ativo' : '';
    li.innerHTML = `<div class="p-nome"></div><div class="p-meta"></div>`;
    li.querySelector('.p-nome').textContent = p.nome;
    const situacao = estado.naFila.has(p.id) ? ' · na fila' : estado.trabalhando.has(p.id) ? ' · montando' : '';
    li.querySelector('.p-meta').textContent = `${p.engine === 'remotion' ? 'Remotion' : 'HyperFrames'} · ${p.formato} · ${new Date(p.criadoEm).toLocaleDateString('pt-BR')}${situacao}`;
    li.onclick = () => abrirProjeto(p.id);
    ul.append(li);
  }
}

// ---------- wizard ----------

function irPasso(n) {
  // Só motion pula a narração: voltar do estilo leva aos materiais e desfaz a escolha.
  if (estado.soMotion && n < 3) {
    definirSoMotion(false);
    n = 1;
  }
  $$('.passo').forEach((p) => p.classList.toggle('ativo', p.dataset.passo == n));
  $$('.passos li').forEach((li) => {
    li.classList.toggle('ativo', li.dataset.passo == n);
    li.classList.toggle('feito', Number(li.dataset.passo) < n);
  });
}

function definirSoMotion(sim) {
  estado.soMotion = sim;
  atualizarBotaoCriar();
  $('#campo-duracao').hidden = !sim;
  $('#rotulo-detalhes').textContent = sim ? 'O que o vídeo mostra' : 'Detalhes do estilo (opcional)';
  if (estado.catalogo) escolherEstilo(sim ? 'minimalista' : estado.estiloId);
}

function novoVideo() {
  if (!estado.pronto) {
    renderChecklist();
    mostrarVista('setup');
    return;
  }
  TL.fechar();
  estado.projetoId = null;
  estado.materiais = [];
  estado.narracoes = [];
  estado.semNarracao = false;
  estado.soMotion = false;
  $('#campo-duracao').hidden = true;
  $('#rotulo-detalhes').textContent = 'Detalhes do estilo (opcional)';
  $('#sem-narracao').checked = false;
  $('#nome-video').value = '';
  $('#texto-estilo').value = '';
  $('#salvar-estilo').checked = false;
  renderMateriais();
  renderNarracao();
  escolherEstilo('reels-estetica');
  irPasso(1);
  mostrarVista('wizard');
  carregarProjetos();
}

async function adicionarMateriais(caminhos) {
  for (const c of caminhos) {
    const tipo = await api.tipoArquivo(c);
    if (tipo !== 'outro' && !estado.materiais.includes(c)) estado.materiais.push(c);
  }
  renderMateriais();
}

function renderMateriais() {
  const g = $('#grade-materiais');
  g.innerHTML = '';
  estado.materiais.forEach(async (c, i) => {
    const d = document.createElement('div');
    d.className = 'mat';
    d.innerHTML = `<div class="thumb"></div><div class="mat-nome"></div><button class="remover" title="Remover">×</button>`;
    d.querySelector('.mat-nome').textContent = nomeArquivo(c);
    const tipo = await api.tipoArquivo(c);
    const thumb = d.querySelector('.thumb');
    if (tipo === 'imagem') thumb.innerHTML = `<img src="${urlArquivo(c)}" />`;
    else if (tipo === 'video') thumb.innerHTML = `<video src="${urlArquivo(c)}#t=0.5" muted preload="metadata"></video>`;
    else thumb.textContent = '♪';
    d.querySelector('.remover').onclick = () => {
      estado.materiais.splice(estado.materiais.indexOf(c), 1);
      renderMateriais();
    };
    g.append(d);
  });
  $('#btn-ir-2').disabled = estado.materiais.length === 0;
}

const fmtDuracao = (seg) => `${Math.floor(seg / 60)}:${String(Math.round(seg % 60)).padStart(2, '0')}`;

function renderNarracao() {
  const el = $('#narracao-escolhida');
  el.innerHTML = '';
  estado.narracoes.forEach((n, i) => {
    const d = document.createElement('div');
    d.className = 'card narracao-item';
    d.innerHTML = `<div class="narracao-txt"><strong></strong><small></small></div><audio controls preload="none"></audio><button title="Remover">×</button>`;
    d.querySelector('strong').textContent = `Vídeo ${i + 1}: ${n.nome}`;
    const partes = n.arquivos.length > 1 ? `${n.arquivos.length} áudios · ` : '';
    d.querySelector('small').textContent = partes + fmtDuracao(n.duracao);
    d.querySelector('small').title = n.arquivos.map(nomeArquivo).join('\n');
    // O player toca os áudios da pasta em sequência, como vão ficar no vídeo.
    const audio = d.querySelector('audio');
    let parte = 0;
    audio.src = urlArquivo(n.arquivos[0]);
    audio.onended = () => {
      parte = (parte + 1) % n.arquivos.length;
      audio.src = urlArquivo(n.arquivos[parte]);
      if (parte) audio.play();
    };
    d.querySelector('button').onclick = () => {
      estado.narracoes.splice(i, 1);
      renderNarracao();
    };
    el.append(d);
  });
  $('#drop-narracao').hidden = estado.semNarracao;
  $('#narracao-escolhida').hidden = estado.semNarracao;
  $('#btn-ir-3').disabled = !estado.narracoes.length && !estado.semNarracao;
  atualizarBotaoCriar();
}

async function adicionarNarracoes(caminhos) {
  if (!caminhos.length) return;
  for (const n of await api.resolverNarracoes(caminhos)) {
    const repetida = estado.narracoes.some((x) => x.arquivos.join() === n.arquivos.join());
    if (!repetida) estado.narracoes.push(n);
  }
  renderNarracao();
}

function atualizarBotaoCriar() {
  const n = estado.soMotion || estado.semNarracao ? 1 : estado.narracoes.length;
  $('#btn-criar').textContent = n > 1 ? `Criar ${n} vídeos com o Claude` : 'Criar vídeo com o Claude';
}

function escolherEstilo(id) {
  estado.estiloId = id;
  const e = estado.catalogo.estilos.find((x) => x.id === id);
  estado.engine = e.engine;
  estado.formato = e.formato;
  $$('.estilo').forEach((b) => b.classList.toggle('ativo', b.dataset.id === id));
  segmentado($('#seg-engine'), estado.engine, (v) => (estado.engine = v));
  segmentado($('#seg-formato'), estado.formato, (v) => (estado.formato = v));
  $('#texto-estilo').placeholder = estado.soMotion
    ? 'Ex.: abertura do canal com o logo em texto, fundo escuro, partículas e o título "Oficina do Carlos" surgindo letra por letra'
    : id === 'personalizado'
      ? 'Descreva o estilo: ritmo, legendas, cores, transições, referências…'
      : 'Ex.: legendas amarelas, cortes rápidos, terminar com o logo e o WhatsApp do cliente';
}

function renderEstilos() {
  const g = $('#grade-estilos');
  g.innerHTML = '';
  for (const e of estado.catalogo.estilos) {
    const b = document.createElement('button');
    b.className = 'estilo';
    b.dataset.id = e.id;
    b.innerHTML = `<strong></strong><span></span><br><em></em>`;
    b.querySelector('strong').textContent = e.nome;
    b.querySelector('span').textContent = e.descricao;
    b.querySelector('em').textContent = `${e.engine === 'remotion' ? 'Remotion' : 'HyperFrames'} · ${e.formato}${e.doUsuario ? ' · criado pelo Claude' : ''}`;
    b.onclick = () => escolherEstilo(e.id);
    if (e.doUsuario) {
      const x = document.createElement('span');
      x.className = 'excluir-estilo';
      x.title = 'Excluir estilo';
      x.textContent = '×';
      x.onclick = async (ev) => {
        ev.stopPropagation();
        if (!confirm(`Excluir o estilo "${e.nome}"?`)) return;
        await api.excluirEstilo(e.id);
        await recarregarEstilos();
      };
      b.append(x);
    }
    g.append(b);
  }
  $('#seg-formato').innerHTML = estado.catalogo.formatos.map((f) => `<button data-v="${f}">${f}</button>`).join('');
}

async function recarregarEstilos() {
  estado.catalogo = await api.catalogo();
  const atual = estado.estiloId;
  renderEstilos();
  escolherEstilo(estado.catalogo.estilos.some((e) => e.id === atual) ? atual : 'reels-estetica');
}

async function criar() {
  if ((estado.soMotion || estado.estiloId === 'personalizado') && !$('#texto-estilo').value.trim()) {
    $('#texto-estilo').focus();
    $('#texto-estilo').placeholder = estado.soMotion
      ? 'Sem materiais, o Claude precisa saber o que criar. Descreva o vídeo aqui.'
      : 'Descreva o estilo que você quer antes de criar.';
    return;
  }
  const botao = $('#btn-criar');
  botao.disabled = true;
  botao.textContent = 'Preparando…';
  mostrarVista('editor');
  await TL.fechar();
  $('#mensagens').innerHTML = '';
  $('#ed-nome').textContent = $('#nome-video').value || 'Novo vídeo';
  $('#ed-info').textContent = 'Importando materiais…';
  $('#player').removeAttribute('src');
  $('#player-vazio').hidden = false;
  definirTrabalhando(true);
  addMsg('info', estado.soMotion ? 'Preparando o projeto…' : 'Importando materiais e transcrevendo a narração…');
  const tirarLog = api.aoLog((l) => addMsg('info', l));
  try {
    const criados = await api.criarProjeto({
      nome: $('#nome-video').value.trim(),
      materiais: estado.soMotion ? [] : estado.materiais,
      narracoes: estado.soMotion || estado.semNarracao ? [] : estado.narracoes.map((n) => ({ nome: n.nome, arquivos: n.arquivos })),
      duracaoMotion: estado.soMotion ? Math.max(1, Math.min(600, Number($('#duracao-motion').value) || 15)) : null,
      estiloId: estado.estiloId,
      estiloTexto: $('#texto-estilo').value.trim(),
      salvarEstilo: $('#salvar-estilo').checked,
      engine: estado.engine,
      formato: estado.formato,
    });
    criados.forEach((p) => estado.trabalhando.add(p.id));
    await abrirProjeto(criados[0].id);
  } catch (e) {
    addMsg('erro', 'Não consegui criar o projeto: ' + e.message);
  } finally {
    tirarLog();
    botao.disabled = false;
    atualizarBotaoCriar();
  }
}

// ---------- editor ----------

function addMsg(de, texto) {
  const box = $('#mensagens');
  const d = document.createElement('div');
  d.className = 'msg ' + de;
  d.textContent = texto;
  box.append(d);
  box.scrollTop = box.scrollHeight;
}

function mostrarVideo(arquivo) {
  const v = $('#player');
  v.src = urlArquivo(arquivo) + '?t=' + Date.now();
  $('#player-vazio').hidden = true;
  if (TL.ativa()) TL.verRender();
}

function definirTrabalhando(sim) {
  TL.bloquear(sim);
  $('#chat-status').classList.toggle('trabalhando', sim);
  $('#btn-cancelar').hidden = !sim;
  $('#btn-render').disabled = sim;
}

function progresso(frac, texto) {
  $('#prog-barra').style.width = `${Math.round((frac ?? 0) * 100)}%`;
  $('#prog-txt').textContent = texto;
}

async function abrirProjeto(id) {
  estado.projetoId = id;
  const p = await api.projeto(id);
  mostrarVista('editor');
  await TL.fechar();
  $('#ed-nome').textContent = p.nome;
  $('#ed-info').textContent = `${p.estiloNome} · ${p.engine === 'remotion' ? 'Remotion' : 'HyperFrames'} · ${p.largura}x${p.altura}`;
  $('#mensagens').innerHTML = '';
  for (const m of p.chat) addMsg(m.de, m.texto);
  if (p.renders[0]) mostrarVideo(p.renders[0].preview ?? p.renders[0].arquivo);
  else {
    $('#player').removeAttribute('src');
    $('#player-vazio').hidden = false;
  }
  renderListaRenders(p);
  if (p.timeline) await TL.abrir(p);
  definirTrabalhando(estado.trabalhando.has(id));
  progresso(0, estado.naFila.has(id) ? 'Na fila: aguardando os vídeos anteriores' : estado.trabalhando.has(id) ? 'Claude trabalhando…' : 'Pronto');
  carregarProjetos();
}

function renderListaRenders(p) {
  const ul = $('#lista-renders');
  ul.innerHTML = '';
  for (const r of p.renders) {
    const li = document.createElement('li');
    li.innerHTML = `<span></span><span></span>`;
    li.children[0].textContent = nomeArquivo(r.arquivo);
    li.children[1].textContent = `${r.modo.toUpperCase()} · ${r.segundos}s`;
    li.onclick = () => mostrarVideo(r.preview ?? r.arquivo);
    li.oncontextmenu = () => api.mostrarNaPasta(r.arquivo);
    ul.append(li);
  }
  if (!p.renders.length) ul.innerHTML = '<li>Nenhum ainda.</li>';
}

api.aoAgente(async (e) => {
  if (e.tipo === 'fila') {
    estado.trabalhando.add(e.id);
    estado.naFila.add(e.id);
  }
  if (e.tipo === 'inicio') {
    estado.trabalhando.add(e.id);
    estado.naFila.delete(e.id);
  }
  if (e.tipo === 'parado') {
    estado.trabalhando.delete(e.id);
    estado.naFila.delete(e.id);
  }
  if (['fila', 'inicio', 'parado'].includes(e.tipo)) carregarProjetos();
  if (e.id !== estado.projetoId) return;

  switch (e.tipo) {
    case 'fila':
      definirTrabalhando(true);
      progresso(0, 'Na fila: aguardando os vídeos anteriores');
      break;
    case 'inicio':
      definirTrabalhando(true);
      progresso(0, 'Claude trabalhando…');
      break;
    case 'preparo':
      progresso(0, e.texto);
      break;
    case 'texto':
      addMsg('claude', e.texto);
      break;
    case 'acao':
      addMsg('acao', e.texto);
      break;
    case 'erro':
      addMsg('erro', e.texto);
      break;
    case 'estilo':
      addMsg('info', `Estilo "${e.nome}" salvo — já aparece na lista de estilos.`);
      recarregarEstilos();
      break;
    case 'fim':
      if (e.custo) {
        const assinatura = estado.ambiente?.claude.metodo === 'Conta Claude';
        addMsg(
          'info',
          assinatura
            ? `Uso deste pedido: equivale a US$ ${e.custo.toFixed(2)} em API (no seu plano não há cobrança extra; conta no limite de uso).`
            : `Custo deste pedido: US$ ${e.custo.toFixed(2)}`,
        );
      }
      break;
    case 'parado':
      definirTrabalhando(false);
      if (!$('#prog-txt').textContent.startsWith('Render')) progresso(0, 'Pronto');
      await TL.recarregar();
      break;
    case 'render':
      if (e.etapa) progresso(e.progresso, `${e.etapa} — ${Math.round((e.progresso ?? 0) * 100)}%`);
      if (e.concluido) {
        progresso(1, 'Render concluído');
        await TL.recarregar();
        mostrarVideo(e.concluido);
        renderListaRenders(await api.projeto(e.id));
      }
      if (e.falhou) progresso(0, 'Render falhou: ' + e.falhou);
      break;
  }
});

async function renderManual() {
  const id = estado.projetoId;
  await TL.salvarAgora();
  definirTrabalhando(true);
  progresso(0, 'Iniciando render…');
  try {
    await api.renderizar({ id, modo: estado.config.renderModo, formato: estado.config.renderFormato });
  } catch (e) {
    addMsg('erro', 'Render falhou. Peça ao Claude para corrigir: "o render falhou, corrija".');
  }
  definirTrabalhando(estado.trabalhando.has(id));
}

async function enviarChat(ev) {
  ev?.preventDefault();
  const t = $('#entrada-chat').value.trim();
  if (!t || !estado.projetoId || estado.trabalhando.has(estado.projetoId)) return;
  $('#entrada-chat').value = '';
  addMsg('usuario', t);
  await TL.salvarAgora();
  api.enviarChat({ id: estado.projetoId, texto: t, contexto: TL.contexto() });
}

// ---------- transcodificador ----------

const tc = { itens: [], formato: 'mp4', modo: 'gpu', pasta: null, rodando: false };

function abrirTranscode() {
  TL.fechar();
  estado.projetoId = null;
  carregarProjetos();
  // Sem NVENC o ffmpeg cai para CPU sozinho; aqui só refletimos isso quando já sabemos.
  if (!tc.modoEscolhido) tc.modo = estado.ambiente && !estado.ambiente.nvenc ? 'cpu' : 'gpu';
  segmentado($('#seg-tc-formato'), tc.formato, (v) => (tc.formato = v));
  segmentado($('#seg-tc-modo'), tc.modo, (v) => {
    tc.modo = v;
    tc.modoEscolhido = true;
  });
  renderTranscode();
  mostrarVista('transcode');
}

async function adicionarTranscode(caminhos) {
  const novos = caminhos.filter((c) => !tc.itens.some((i) => i.arquivo === c));
  if (!novos.length) return;
  const infos = await api.infoVideos(novos);
  for (const info of infos) if (info.codec) tc.itens.push({ ...info, status: 'aguardando', progresso: 0 });
  renderTranscode();
}

function renderTranscode() {
  const ul = $('#lista-transcode');
  ul.innerHTML = '';
  tc.itens.forEach((it, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="tc-nome"></div><span class="selo"></span><span class="tc-status"></span><div class="barra"></div>`;
    li.querySelector('.tc-nome').innerHTML = `<span></span><small></small>`;
    li.querySelector('.tc-nome span').textContent = nomeArquivo(it.arquivo);
    const det = [it.largura && `${it.largura}x${it.altura}`, it.duracao && `${it.duracao.toFixed(1)}s`, it.hdr && 'HDR'].filter(Boolean).join(' · ');
    li.querySelector('small').textContent = det;
    const selo = li.querySelector('.selo');
    selo.textContent = { hevc: 'H.265', h264: 'H.264', prores: 'ProRes' }[it.codec] ?? it.codec.toUpperCase();
    selo.classList.toggle('hevc', it.codec === 'hevc');
    const st = li.querySelector('.tc-status');
    st.className = 'tc-status ' + it.status;
    st.textContent = {
      aguardando: 'Na fila',
      convertendo: `${Math.round(it.progresso * 100)}%`,
      pronto: `Pronto (${it.modo?.toUpperCase()}, ${it.segundos}s) — abrir`,
      erro: 'Erro: ' + (it.erro ?? ''),
    }[it.status];
    st.title = it.erro ?? '';
    if (it.status === 'pronto') st.onclick = () => api.mostrarNaPasta(it.saida);
    li.querySelector('.barra').style.width = `${Math.round(it.progresso * 100)}%`;
    ul.append(li);
  });
  const pendentes = tc.itens.some((i) => i.status === 'aguardando' || i.status === 'erro');
  $('#btn-tc-iniciar').disabled = tc.rodando || !pendentes;
  $('#btn-tc-cancelar').hidden = !tc.rodando;
  $('#btn-tc-limpar').disabled = tc.rodando;
  $('#tc-pasta').textContent = tc.pasta ?? 'Mesma pasta do original';
  $('#btn-tc-pasta-limpar').hidden = !tc.pasta;
}

api.aoTranscode((e) => {
  const fila = tc.itens.filter((i) => i.naFila);
  const it = fila[e.indice];
  if (!it) return;
  Object.assign(it, e);
  renderTranscode();
});

async function iniciarTranscode() {
  tc.itens.forEach((i) => (i.naFila = i.status === 'aguardando' || i.status === 'erro'));
  const fila = tc.itens.filter((i) => i.naFila);
  fila.forEach((i) => Object.assign(i, { status: 'aguardando', progresso: 0, erro: null }));
  tc.rodando = true;
  renderTranscode();
  const resultados = await api.transcodificar({ arquivos: fila.map((i) => i.arquivo), formato: tc.formato, modo: tc.modo, pastaSaida: tc.pasta });
  fila.forEach((i, n) => Object.assign(i, resultados[n], { naFila: false }));
  tc.rodando = false;
  renderTranscode();
}

function ligarTranscode() {
  $('#btn-transcode').onclick = abrirTranscode;
  $('#btn-sel-transcode').onclick = async () => adicionarTranscode(await api.escolher({ tipo: 'videos', multiplos: true }));
  $('#btn-tc-iniciar').onclick = iniciarTranscode;
  $('#btn-tc-cancelar').onclick = () => api.cancelarTranscode();
  $('#btn-tc-limpar').onclick = () => {
    tc.itens = [];
    renderTranscode();
  };
  $('#btn-tc-pasta').onclick = async () => {
    const p = await api.pastaSaida();
    if (p) tc.pasta = p;
    renderTranscode();
  };
  $('#btn-tc-pasta-limpar').onclick = () => {
    tc.pasta = null;
    renderTranscode();
  };
  areaDeSoltar($('#drop-transcode'), adicionarTranscode);
}

// ---------- configurações ----------

const CAMPOS = {
  'cfg-modelo': 'modeloClaude',
  'cfg-apikey': 'apiKey',
  'cfg-workspace': 'workspaceDir',
  'cfg-whisper': 'whisperDir',
  'cfg-whisper-modelo': 'whisperModelo',
  'cfg-ffmpeg': 'ffmpegPath',
  'cfg-skills': 'skillsOrigem',
};

function abrirConfig() {
  for (const [el, k] of Object.entries(CAMPOS)) $('#' + el).value = estado.config[k] ?? '';
  $('#dlg-config').showModal();
}

$('#dlg-config').addEventListener('close', async () => {
  if ($('#dlg-config').returnValue !== 'salvar') return;
  const novo = {};
  for (const [el, k] of Object.entries(CAMPOS)) novo[k] = $('#' + el).value.trim();
  estado.config = await api.salvarConfig(novo);
  iniciar();
});

// ---------- arrastar e soltar ----------

function areaDeSoltar(el, aoSoltar) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('sobre');
  });
  el.addEventListener('dragleave', () => el.classList.remove('sobre'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('sobre');
    aoSoltar([...e.dataTransfer.files].map((f) => api.caminhoDoArquivo(f)).filter(Boolean));
  });
}
// Impede que soltar um arquivo fora da área abra o arquivo na janela.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- início ----------

async function iniciar() {
  estado.config = await api.lerConfig();
  estado.catalogo ??= await api.catalogo();
  const pronto = await verificarAmbiente();
  estado.pronto = pronto;
  await carregarProjetos();
  // O conversor não depende do Claude: se o usuário já foi para ele, fica lá.
  if (estado.vista === 'transcode') return;
  if (!pronto) {
    renderChecklist();
    mostrarVista('setup');
    return;
  }
  if (!estado.ambiente.nvenc && estado.config.renderModo === 'gpu') {
    estado.config = await api.salvarConfig({ renderModo: 'cpu' });
  }
  if (estado.projetoId) abrirProjeto(estado.projetoId);
  else novoVideo();
  oferecerFilaInterrompida();
}

// O app fechou com vídeos esperando na fila: montar exige o Claude, então só continua se o usuário quiser.
async function oferecerFilaInterrompida() {
  const ids = await api.filaPendentes();
  if (!ids.length) return;
  const texto = ids.length > 1 ? `${ids.length} vídeos ficaram na fila` : 'Um vídeo ficou na fila';
  if (confirm(`${texto} quando o app fechou. Continuar a montagem agora?`)) api.retomarFila(ids);
  else api.descartarFila(ids);
}

function ligar() {
  renderEstilosUmaVez();
  ligarTranscode();
  $('#btn-novo').onclick = novoVideo;
  $('#btn-config').onclick = abrirConfig;
  $('#pill-claude').onclick = () => (estado.ambiente?.claude.conectado ? abrirConfig() : entrarClaude());
  $('#btn-sel-materiais').onclick = async () => adicionarMateriais(await api.escolher({ tipo: 'materiais', multiplos: true }));
  $('#btn-sel-pasta').onclick = async () => adicionarMateriais(await api.escolherPasta());
  $('#btn-sel-narracao').onclick = async () => adicionarNarracoes(await api.escolher({ tipo: 'narracao', multiplos: true }));
  $('#btn-sel-pastas-narracao').onclick = async () => adicionarNarracoes(await api.escolherPastas());
  $('#sem-narracao').onchange = (e) => {
    estado.semNarracao = e.target.checked;
    renderNarracao();
  };
  $$('[data-ir]').forEach((b) => (b.onclick = () => irPasso(Number(b.dataset.ir))));
  $('#btn-criar').onclick = criar;
  $('#btn-so-motion').onclick = () => {
    definirSoMotion(true);
    irPasso(3);
  };
  $('#btn-render').onclick = renderManual;
  $('#btn-cancelar').onclick = () => api.cancelar(estado.projetoId);
  $('#btn-abrir-pasta').onclick = () => api.abrirPasta(estado.projetoId);
  $('#form-chat').onsubmit = enviarChat;
  $$('.atalhos button').forEach(
    (b) =>
      (b.onclick = () => {
        $('#entrada-chat').value = b.dataset.msg;
        enviarChat();
      }),
  );
  $('#entrada-chat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) enviarChat(e);
  });
  areaDeSoltar($('#drop-materiais'), adicionarMateriais);
  areaDeSoltar($('#drop-narracao'), adicionarNarracoes);
}

async function renderEstilosUmaVez() {
  estado.catalogo = await api.catalogo();
  estado.config = await api.lerConfig();
  renderEstilos();
  segmentado($('#seg-modo'), estado.config.renderModo, async (v) => (estado.config = await api.salvarConfig({ renderModo: v })));
  segmentado($('#seg-saida'), estado.config.renderFormato, async (v) => (estado.config = await api.salvarConfig({ renderFormato: v })));
  iniciar();
}

// Espera timeline.js, que depende das funções deste arquivo.
window.addEventListener('DOMContentLoaded', ligar);
