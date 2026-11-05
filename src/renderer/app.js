const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = window.studio;

const estado = {
  catalogo: null,
  config: null,
  ambiente: null,
  materiais: [], // caminhos
  pastas: {}, // caminho -> pasta de onde o material veio
  narracoes: [], // { nome, arquivos, duracao }; cada uma vira um vídeo
  semNarracao: false,
  estiloId: 'reels-estetica',
  engine: 'remotion',
  formato: '9:16',
  projetoId: null,
  trabalhando: new Set(),
  naFila: new Set(),
  referencias: [],
  roteiros: [],
  audiosInstrucao: [],
};

const urlArquivo = (p) => 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
const nomeArquivo = (p) => p.split(/[\\/]/).pop();

function mostrarVista(nome) {
  // Saindo da criação de projeto: guarda o que já foi preenchido.
  if (estado.vista === 'wizard' && nome !== 'wizard') salvarRascunhoAgora();
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
  rotularBotoesGpu();
  const a = estado.ambiente;
  const pill = $('#pill-claude');
  pill.textContent = a.claude.conectado ? `Claude: ${a.claude.metodo}` : 'Claude: entrar';
  pill.className = 'pill ' + (a.claude.conectado ? 'ok' : 'erro');
  return a.workspacePronto && a.claude.conectado && a.node && a.ffmpeg;
}

const nomeEncoderGpu = () => ({ nvenc: 'NVENC', amf: 'AMF' })[estado.ambiente?.encoderGpu];

function rotularBotoesGpu() {
  $('#seg-motor').hidden = !estado.ambiente?.filmcraft;
  const nome = nomeEncoderGpu();
  document.querySelectorAll('#seg-modo [data-v="gpu"], #seg-tc-modo [data-v="gpu"]').forEach((b) => {
    b.textContent = nome ? `GPU (${nome})` : 'GPU';
  });
}

function renderChecklist() {
  const a = estado.ambiente;
  const itens = [
    { ok: a.claude.conectado, t: 'Conta do Claude', d: a.claude.conectado ? a.claude.metodo : 'Entre com sua conta Claude (Pro/Max) ou coloque uma chave de API nas configurações.', acao: a.claude.conectado ? null : ['Entrar no Claude', entrarClaude] },
    { ok: a.node, t: 'Node.js', d: 'Usado para rodar o Remotion e o HyperFrames.' },
    { ok: a.ffmpeg, t: 'FFmpeg', d: a.encoderGpu ? `Com ${nomeEncoderGpu()}: render por GPU disponível.` : 'Sem encoder de GPU (NVENC ou AMF): só render por CPU.' },
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

// Cada projeto tem um conjunto de materiais e uma ou mais timelines.
function pastasDe(lista) {
  const pastas = new Map();
  for (const p of lista) {
    const id = p.grupo?.id ?? p.id;
    if (!pastas.has(id)) pastas.set(id, { id, nome: p.grupo?.nome ?? p.nome, timelines: [] });
    pastas.get(id).timelines.push(p);
  }
  for (const f of pastas.values()) f.timelines.sort((a, b) => a.ordem - b.ordem);
  return [...pastas.values()]; // a lista já vem da mais nova para a mais antiga
}

const rotuloTimeline = (_f, p) => p.rotulo;

const situacaoDe = (p) => (estado.naFila.has(p.id) ? 'na fila' : estado.trabalhando.has(p.id) ? 'montando' : '');

async function carregarProjetos() {
  const lista = await api.projetos();
  estado.listaProjetos = lista;
  estado.pastasAbertas ??= new Set();
  const ul = $('#lista-projetos');
  ul.innerHTML = '';
  if (!lista.length) ul.innerHTML = '<li class="p-meta">Nenhum vídeo ainda.</li>';
  for (const f of pastasDe(lista)) {
    const ativa = f.timelines.some((p) => p.id === estado.projetoId);
    const aberta = estado.pastasAbertas.has(f.id);
    const primeiro = f.timelines[0];
    const situacoes = f.timelines.map(situacaoDe).filter(Boolean);
    const n = f.timelines.length;
    const li = document.createElement('li');
    li.className = 'pasta';
    li.innerHTML = `<div class="pasta-cab"><span class="seta"></span><div class="pasta-txt"><div class="p-nome"></div><div class="p-meta"></div></div></div>`;
    const cab = li.querySelector('.pasta-cab');
    cab.classList.toggle('ativo', ativa && !aberta);
    li.querySelector('.seta').textContent = n > 1 ? (aberta ? '▾' : '▸') : '▪';
    li.querySelector('.p-nome').textContent = f.nome;
    li.querySelector('.p-meta').textContent =
      [`${n} timeline${n > 1 ? 's' : ''}`, primeiro.engine === 'remotion' ? 'Remotion' : 'HyperFrames', primeiro.formato, new Date(primeiro.criadoEm).toLocaleDateString('pt-BR'), situacoes.length ? `${situacoes.length > 1 ? situacoes.length + ' ' : ''}${situacoes[0]}` : '']
        .filter(Boolean)
        .join(' · ');
    cab.onclick = () => {
      if (n === 1) return abrirProjeto(primeiro.id);
      if (aberta) estado.pastasAbertas.delete(f.id);
      else estado.pastasAbertas.add(f.id);
      // Ao abrir uma pasta sem nenhuma timeline aberta, abre a primeira.
      if (estado.pastasAbertas.has(f.id) && !ativa) abrirProjeto(primeiro.id);
      else carregarProjetos();
    };
    if (n > 1 && aberta) {
      const itens = document.createElement('div');
      itens.className = 'pasta-itens';
      for (const p of f.timelines) {
        const it = document.createElement('div');
        it.className = 'timeline-item' + (p.id === estado.projetoId ? ' ativo' : '');
        const sit = situacaoDe(p);
        it.textContent = rotuloTimeline(f, p) + (sit ? ` · ${sit}` : '');
        it.title = p.nome;
        it.onclick = () => abrirProjeto(p.id);
        itens.append(it);
      }
      li.append(itens);
    }
    ul.append(li);
  }
  renderAbasTimeline(lista);
}

// Abas com as timelines do projeto aberto, no topo do editor.
function renderAbasTimeline(lista) {
  const abas = $('#ed-abas');
  const atual = lista.find((p) => p.id === estado.projetoId);
  const irmas = atual ? lista.filter((p) => p.projetoId === atual.projetoId) : [];
  estado.irmasIds = irmas.map((p) => p.id);
  $('#btn-render-todos').hidden = irmas.length < 2;
  abas.hidden = !atual;
  abas.innerHTML = '';
  if (abas.hidden) return;
  const pasta = pastasDe(irmas)[0];
  for (const p of pasta.timelines) {
    const b = document.createElement('button');
    b.className = 'aba-timeline' + (p.id === atual.id ? ' ativo' : '');
    b.textContent = rotuloTimeline(pasta, p);
    b.title = `${p.rotulo} (clique duplo para renomear)`;
    b.onclick = () => p.id !== atual.id && abrirProjeto(p.id);
    b.ondblclick = () => renomearAba(b, p);
    abas.append(b);
  }
  const acao = (rotulo, titulo, fn) => {
    const b = document.createElement('button');
    b.className = 'aba-acao';
    b.textContent = rotulo;
    b.title = titulo;
    b.onclick = fn;
    abas.append(b);
  };
  acao('+ Nova', 'Nova timeline em branco, com os mesmos materiais do projeto', () => criarTimelineNoProjeto(api.novaTimeline));
  acao('Duplicar', 'Nova timeline com uma cópia desta montagem. Os materiais não são copiados.', () => criarTimelineNoProjeto(api.duplicarTimeline));
  if (irmas.length > 1) acao('Excluir', 'Exclui esta timeline e os renders dela. Os materiais continuam no projeto.', excluirTimelineAtual);
}

async function criarTimelineNoProjeto(acao) {
  const id = estado.projetoId;
  if (estado.trabalhando.has(id)) return addMsg('erro', 'Espere o Claude terminar antes de criar outra timeline a partir desta.');
  await TL.salvarAgora();
  try {
    const nova = await acao(id);
    await abrirProjeto(nova.id);
  } catch (e) {
    addMsg('erro', 'Não consegui criar a timeline: ' + e.message.split('\n')[0]);
  }
}

function renomearAba(botao, p) {
  const campo = document.createElement('input');
  campo.className = 'aba-renomear';
  campo.value = p.rotulo;
  let feito = false;
  const concluir = async (salvar) => {
    if (feito) return;
    feito = true;
    const novo = campo.value.trim();
    if (salvar && novo && novo !== p.rotulo) {
      try {
        await api.renomearTimeline({ id: p.id, rotulo: novo });
      } catch (e) {
        addMsg('erro', 'Não consegui renomear: ' + e.message.split('\n')[0]);
      }
    }
    if (p.id === estado.projetoId) $('#ed-nome').textContent = (await api.projeto(p.id)).nome;
    carregarProjetos();
  };
  campo.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') concluir(true);
    if (ev.key === 'Escape') concluir(false);
  };
  campo.onblur = () => concluir(true);
  botao.replaceWith(campo);
  campo.select();
}

// Renomeia o projeto inteiro (todas as timelines dele) direto no título.
function renomearProjetoAtual() {
  const id = estado.projetoId;
  const titulo = $('#ed-nome');
  if (!id || titulo.querySelector('input')) return;
  const nomeAtual = estado.listaProjetos?.find((x) => x.id === id)?.grupo?.nome ?? titulo.textContent;
  const campo = document.createElement('input');
  campo.className = 'ed-nome-campo';
  campo.value = nomeAtual;
  campo.maxLength = 80;
  let feito = false;
  const concluir = async (salvar) => {
    if (feito) return;
    feito = true;
    const novo = campo.value.trim();
    if (salvar && novo && novo !== nomeAtual) {
      try {
        await api.renomearProjeto({ id, nome: novo });
      } catch (e) {
        addMsg('erro', 'Não consegui renomear: ' + e.message.split('\n')[0]);
      }
    }
    if (estado.projetoId === id) titulo.textContent = (await api.projeto(id)).nome;
    carregarProjetos();
  };
  campo.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') concluir(true);
    if (ev.key === 'Escape') concluir(false);
  };
  campo.onblur = () => concluir(true);
  titulo.replaceChildren(campo);
  campo.select();
}

async function excluirTimelineAtual() {
  const id = estado.projetoId;
  const irmas = estado.irmasIds ?? [];
  const p = await api.projeto(id);
  if (!confirm(`Excluir a timeline "${p.rotulo}" e os renders dela?\n\nOs materiais continuam no projeto.`)) return;
  // Fecha antes: o salvamento automático não pode recriar a timeline excluída.
  await TL.fechar();
  try {
    await api.excluirTimeline(id);
    await abrirProjeto(irmas[irmas.indexOf(id) - 1] ?? irmas.find((x) => x !== id));
  } catch (e) {
    addMsg('erro', 'Não consegui excluir: ' + e.message.split('\n')[0]);
    await abrirProjeto(id);
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

// ---------- pré-projetos (rascunhos da criação) ----------

const CHAVE_RASCUNHOS = 'preProjetos';

function lerRascunhos() {
  try {
    const l = JSON.parse(localStorage.getItem(CHAVE_RASCUNHOS) ?? '[]');
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

function gravarRascunhos(lista) {
  try {
    localStorage.setItem(CHAVE_RASCUNHOS, JSON.stringify(lista));
  } catch {}
}

// Tudo o que o assistente guarda: o estado da tela mais os campos digitados.
function coletarRascunho() {
  return {
    nome: $('#nome-video').value,
    textoEstilo: $('#texto-estilo').value,
    salvarEstilo: $('#salvar-estilo').checked,
    duracao: $('#duracao-motion').value,
    materiais: estado.materiais,
    pastas: estado.pastas,
    narracoes: estado.narracoes,
    referencias: estado.referencias,
    audiosInstrucao: estado.audiosInstrucao,
    roteiros: estado.roteiros,
    semNarracao: estado.semNarracao,
    soMotion: estado.soMotion,
    estiloId: estado.estiloId,
    engine: estado.engine,
    formato: estado.formato,
    passo: Number($('.passo.ativo')?.dataset.passo) || 1,
  };
}

const temConteudo = (d) =>
  !!(d.nome.trim() || d.textoEstilo.trim() || d.materiais.length || d.narracoes.length || d.referencias.length || d.audiosInstrucao.length || d.roteiros.length || d.soMotion);

let ultimoRascunho = '';

function salvarRascunhoAgora() {
  if (!estado.pronto || estado.vista !== 'wizard') return;
  const dados = coletarRascunho();
  const json = JSON.stringify(dados);
  if (json === ultimoRascunho) return;
  ultimoRascunho = json;
  const lista = lerRascunhos();
  const i = lista.findIndex((r) => r.id === estado.rascunhoId);
  if (!temConteudo(dados)) {
    if (i >= 0) {
      lista.splice(i, 1);
      estado.rascunhoId = null;
    }
  } else {
    estado.rascunhoId ??= 'r' + Date.now().toString(36);
    const r = { id: estado.rascunhoId, atualizadoEm: Date.now(), dados };
    if (i >= 0) lista[i] = r;
    else lista.unshift(r);
  }
  gravarRascunhos(lista);
  renderRascunhos();
}

function descartarRascunho(id) {
  if (!id) return;
  gravarRascunhos(lerRascunhos().filter((r) => r.id !== id));
  if (estado.rascunhoId === id) estado.rascunhoId = null;
  ultimoRascunho = '';
  renderRascunhos();
}

function quandoFoi(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return new Date(ms).toLocaleDateString('pt-BR');
}

function renderRascunhos() {
  const lista = lerRascunhos();
  $('#bloco-rascunhos').hidden = !lista.length;
  const ul = $('#lista-rascunhos');
  ul.replaceChildren(
    ...lista.map((r) => {
      const d = r.dados;
      const li = document.createElement('li');
      li.className = 'rascunho' + (r.id === estado.rascunhoId && estado.vista === 'wizard' ? ' ativo' : '');
      li.innerHTML = '<div class="rascunho-txt"><div class="p-nome"></div><div class="p-meta"></div></div><button type="button" class="rascunho-x" title="Descartar este pré-projeto">×</button>';
      li.querySelector('.p-nome').textContent = d.nome.trim() || 'Projeto sem nome';
      const partes = [
        d.soMotion ? 'só motion' : `${d.materiais.length} material${d.materiais.length === 1 ? '' : 'is'}`,
        d.narracoes.length && `${d.narracoes.length} narração${d.narracoes.length === 1 ? '' : 'ões'}`,
        `passo ${d.passo}/3`,
        quandoFoi(r.atualizadoEm),
      ];
      li.querySelector('.p-meta').textContent = partes.filter(Boolean).join(' · ');
      li.onclick = () => abrirRascunho(r.id);
      li.querySelector('.rascunho-x').onclick = (ev) => {
        ev.stopPropagation();
        if (!confirm('Descartar este pré-projeto? Os arquivos originais não são apagados.')) return;
        const eraAtual = r.id === estado.rascunhoId;
        descartarRascunho(r.id);
        if (eraAtual && estado.vista === 'wizard') novoVideo();
      };
      return li;
    }),
  );
}

function abrirRascunho(id) {
  const r = lerRascunhos().find((x) => x.id === id);
  if (!r || !estado.pronto) return;
  salvarRascunhoAgora();
  TL.fechar();
  estado.projetoId = null;
  const d = r.dados;
  estado.rascunhoId = r.id;
  estado.materiais = d.materiais ?? [];
  estado.pastas = d.pastas ?? {};
  estado.narracoes = d.narracoes ?? [];
  estado.referencias = d.referencias ?? [];
  estado.audiosInstrucao = d.audiosInstrucao ?? [];
  estado.roteiros = d.roteiros ?? [];
  estado.semNarracao = !!d.semNarracao;
  $('#sem-narracao').checked = estado.semNarracao;
  $('#nome-video').value = d.nome ?? '';
  $('#texto-estilo').value = d.textoEstilo ?? '';
  $('#salvar-estilo').checked = !!d.salvarEstilo;
  $('#duracao-motion').value = d.duracao || 15;
  definirSoMotion(!!d.soMotion);
  escolherEstilo(d.estiloId);
  estado.engine = d.engine ?? estado.engine;
  estado.formato = d.formato ?? estado.formato;
  segmentado($('#seg-engine'), estado.engine, (v) => (estado.engine = v));
  segmentado($('#seg-formato'), estado.formato, (v) => (estado.formato = v));
  renderRoteirosNovos();
  renderReferencias();
  renderAudioInstrucao();
  renderMateriais();
  renderNarracao();
  irPasso(d.passo || 1);
  ultimoRascunho = JSON.stringify(coletarRascunho());
  mostrarVista('wizard');
  carregarProjetos();
  renderRascunhos();
}

// A cada segundo, enquanto o assistente está aberto, o que foi preenchido é guardado: trocar de aba ou abrir
// outro projeto não perde nada, e o pré-projeto continua na lista da lateral mesmo depois de fechar o app.
setInterval(salvarRascunhoAgora, 1000);
window.addEventListener('beforeunload', salvarRascunhoAgora);

function novoVideo() {
  if (!estado.pronto) {
    renderChecklist();
    mostrarVista('setup');
    return;
  }
  // O que estava sendo preenchido fica guardado como pré-projeto; esta tela começa em branco.
  salvarRascunhoAgora();
  estado.rascunhoId = null;
  ultimoRascunho = '';
  TL.fechar();
  estado.projetoId = null;
  estado.materiais = [];
  estado.pastas = {};
  estado.narracoes = [];
  estado.referencias = [];
  estado.audiosInstrucao = [];
  estado.roteiros = [];
  renderRoteirosNovos();
  renderReferencias();
  renderAudioInstrucao();
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
  renderRascunhos();
}

const EXT_ROTEIRO = /\.(pdf|docx|odt|txt|md|rtf)$/i;

function adicionarRoteirosNovos(caminhos) {
  for (const c of caminhos) if (!estado.roteiros.includes(c)) estado.roteiros.push(c);
  renderRoteirosNovos();
}

function renderRoteirosNovos() {
  const el = $('#lista-roteiro-material');
  el.innerHTML = '';
  estado.roteiros.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'chip-referencia';
    d.innerHTML = '<span></span><button type="button" title="Remover">×</button>';
    d.querySelector('span').textContent = nomeArquivo(c);
    d.title = c;
    d.querySelector('button').onclick = () => {
      estado.roteiros.splice(i, 1);
      renderRoteirosNovos();
    };
    el.append(d);
  });
}

async function adicionarMateriais(todos) {
  if (!todos.length) return;
  // Documento solto junto com os vídeos é roteiro.
  const documentos = todos.filter((c) => EXT_ROTEIRO.test(c));
  if (documentos.length) adicionarRoteirosNovos(documentos);
  const caminhos = todos.filter((c) => !EXT_ROTEIRO.test(c));
  if (!caminhos.length) return;
  const achados = await api.listarMateriais(caminhos);
  for (const { caminho, pasta } of achados) {
    if (!estado.materiais.includes(caminho)) estado.materiais.push(caminho);
    if (pasta) estado.pastas[caminho] = pasta;
  }
  const texto = $('#drop-materiais .drop-txt');
  texto.textContent = achados.length ? 'Solte arquivos ou pastas aqui' : 'Não há vídeo, imagem nem áudio nesse local.';
  texto.classList.toggle('drop-erro', !achados.length);
  renderMateriais();
}

function renderMateriais() {
  const g = $('#grade-materiais');
  g.innerHTML = '';
  // As seções nascem antes dos cartões, que chegam fora de ordem por causa do await.
  const secoes = new Map();
  for (const c of estado.materiais) {
    const pasta = estado.pastas[c] ?? '';
    if (secoes.has(pasta)) continue;
    if (pasta) {
      const titulo = document.createElement('div');
      titulo.className = 'mat-pasta';
      titulo.innerHTML = '<span></span><button class="remover" title="Remover esta pasta">×</button>';
      titulo.querySelector('span').textContent = `📁 ${pasta}`;
      titulo.querySelector('button').onclick = () => {
        estado.materiais = estado.materiais.filter((x) => {
          const de = estado.pastas[x] ?? '';
          return de !== pasta && !de.startsWith(pasta + '/');
        });
        renderMateriais();
      };
      g.append(titulo);
    }
    const grade = document.createElement('div');
    grade.className = 'mat-grade-pasta';
    g.append(grade);
    secoes.set(pasta, grade);
  }
  // Só os nomes, sem miniatura: carregar o preview de vários vídeos pesados (HDR, HEVC) travava a tela.
  estado.materiais.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'mat';
    d.innerHTML = `<span class="mat-icone"></span><div class="mat-nome"></div><button class="remover" title="Remover">×</button>`;
    d.querySelector('.mat-nome').textContent = nomeArquivo(c);
    d.querySelector('.mat-nome').title = c;
    d.querySelector('.mat-icone').textContent = /.(png|jpe?g|webp|gif|svg)$/i.test(c) ? '🖼' : /.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(c) ? '♪' : '🎬';
    d.querySelector('.remover').onclick = () => {
      estado.materiais.splice(estado.materiais.indexOf(c), 1);
      renderMateriais();
    };
    secoes.get(estado.pastas[c] ?? '').append(d);
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

const EXT_REFERENCIA = /\.(mp4|mov|mkv|m4v|hevc|webm|avi|png|jpe?g|webp)$/i;

function adicionarReferencias(caminhos) {
  for (const c of caminhos.filter((x) => EXT_REFERENCIA.test(x))) if (!estado.referencias.includes(c)) estado.referencias.push(c);
  renderReferencias();
}

function renderReferencias() {
  const el = $('#lista-referencia');
  el.innerHTML = '';
  estado.referencias.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'chip-referencia';
    d.innerHTML = '<span></span><button type="button" title="Remover">×</button>';
    d.querySelector('span').textContent = nomeArquivo(c);
    d.title = c;
    d.querySelector('button').onclick = () => {
      estado.referencias.splice(i, 1);
      renderReferencias();
    };
    el.append(d);
  });
}

const EXT_AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;

function adicionarAudiosInstrucao(caminhos) {
  for (const c of caminhos.filter((x) => EXT_AUDIO.test(x))) if (!estado.audiosInstrucao.includes(c)) estado.audiosInstrucao.push(c);
  renderAudioInstrucao();
}

function renderAudioInstrucao() {
  const el = $('#lista-audio-instrucao');
  el.innerHTML = '';
  estado.audiosInstrucao.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'chip-referencia';
    d.innerHTML = '<span></span><button type="button" title="Remover">×</button>';
    d.querySelector('span').textContent = nomeArquivo(c);
    d.title = c;
    d.querySelector('button').onclick = () => {
      estado.audiosInstrucao.splice(i, 1);
      renderAudioInstrucao();
    };
    el.append(d);
  });
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
    b.prepend(PreviasEstilo.criar(e, b));
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
      pastas: estado.pastas,
      referencias: estado.referencias,
      audiosInstrucao: estado.audiosInstrucao,
      roteiros: estado.roteiros,
      narracoes: estado.soMotion || estado.semNarracao ? [] : estado.narracoes.map((n) => ({ nome: n.nome, arquivos: n.arquivos })),
      duracaoMotion: estado.soMotion ? Math.max(1, Math.min(600, Number($('#duracao-motion').value) || 15)) : null,
      estiloId: estado.estiloId,
      estiloTexto: $('#texto-estilo').value.trim(),
      salvarEstilo: $('#salvar-estilo').checked,
      engine: estado.engine,
      formato: estado.formato,
    });
    criados.forEach((p) => estado.trabalhando.add(p.id));
    descartarRascunho(estado.rascunhoId);
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
  (estado.pastasAbertas ??= new Set()).add(p.grupo?.id ?? p.id);
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
  preencherResolucoes(p);
  renderListaRenders(p);
  if (p.timeline) await TL.abrir(p);
  definirTrabalhando(estado.trabalhando.has(id));
  progresso(0, estado.naFila.has(id) ? 'Na fila: aguardando os vídeos anteriores' : estado.trabalhando.has(id) ? 'Claude trabalhando…' : 'Pronto');
  carregarProjetos();
}

// Resolução pelo lado menor; os rótulos mostram o tamanho real conforme o formato do projeto.
function preencherResolucoes(p) {
  const sel = $('#render-resolucao');
  const w = p?.largura || 1080;
  const h = p?.altura || 1920;
  const lado = Math.min(w, h);
  const tam = (l) => `${Math.round((w * l) / lado)}×${Math.round((h * l) / lado)}`;
  const opcoes = [[0, `Original (${w}×${h})`], ...[720, 1080, 1440, 2160].filter((l) => l !== lado).map((l) => [l, `${l}p (${tam(l)})${l === 2160 ? ' · 4K' : ''}`])];
  const atual = Number(estado.config?.renderResolucao) || 0;
  sel.replaceChildren(...opcoes.map(([v, t]) => new Option(t, String(v))));
  sel.value = opcoes.some(([v]) => v === atual) ? String(atual) : '0';
}

// Renders que estão rodando (ou esperando na fila) agora, de qualquer projeto.
estado.rendersAtivos = new Map(); // id -> { nome, etapa, progresso }

function renderRendersAtivos() {
  const ul = $('#renders-ativos');
  const itens = [...estado.rendersAtivos.entries()];
  $('#renders-resumo').textContent = itens.length ? `Renders (${itens.length} em andamento)` : 'Renders anteriores';
  ul.replaceChildren(
    ...itens.map(([id, r]) => {
      const li = document.createElement('li');
      li.className = 'render-ativo' + (id === estado.projetoId ? ' atual' : '');
      li.innerHTML = '<span class="ra-nome"></span><span class="ra-etapa"></span><div class="ra-barra"><div></div></div>';
      li.querySelector('.ra-nome').textContent = r.nome;
      li.querySelector('.ra-etapa').textContent = r.etapa + (r.fila ? '' : ` — ${Math.round((r.progresso ?? 0) * 100)}%`);
      li.querySelector('.ra-barra div').style.width = `${Math.round((r.progresso ?? 0) * 100)}%`;
      li.title = 'Abrir este vídeo';
      li.onclick = () => id !== estado.projetoId && abrirProjeto(id);
      return li;
    }),
  );
}

const nomeDoProjeto = (id) => estado.listaProjetos?.find((p) => p.id === id)?.nome ?? id;

function marcarRender(id, dados) {
  if (dados == null) estado.rendersAtivos.delete(id);
  else {
    const abrir = !estado.rendersAtivos.size;
    estado.rendersAtivos.set(id, { ...estado.rendersAtivos.get(id), nome: nomeDoProjeto(id), ...dados });
    if (abrir) document.querySelector('details.renders').open = true;
  }
  renderRendersAtivos();
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
  if (e.tipo === 'render') {
    if (e.concluido || e.falhou) marcarRender(e.id, null);
    else if (e.etapa) marcarRender(e.id, { etapa: e.etapa, progresso: e.progresso ?? 0, fila: false });
  }
  // Exportação de todos os vídeos da pasta: o progresso geral aparece na barra, seja qual for o vídeo aberto.
  if (e.tipo === 'lote') {
    if (estado.lote && e.etapa) {
      const geral = (e.indice - 1 + (e.progresso ?? 0)) / e.total;
      progresso(geral, `Exportando ${e.indice} de ${e.total}: ${e.nome} — ${e.etapa}`);
    }
    return;
  }
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
      if (e.etapa && !estado.lote) progresso(e.progresso, `${e.etapa} — ${Math.round((e.progresso ?? 0) * 100)}%`);
      if (e.concluido) {
        if (!estado.lote) progresso(1, 'Render concluído');
        await TL.recarregar();
        mostrarVideo(e.concluido);
        renderListaRenders(await api.projeto(e.id));
      }
      if (e.falhou && !estado.lote) progresso(0, 'Render falhou: ' + e.falhou);
      break;
  }
});

// ---------- janela de exportação ----------

const DICAS_CODEC = {
  hevc: 'Arquivo cerca de 40% menor na mesma qualidade. Depois de pronto, é mais pesado para reabrir e editar.',
  h264: 'Toca em qualquer aparelho e programa. Arquivo maior que o HEVC.',
  prores: 'Para continuar editando em outro programa. Arquivo muito grande, sem escolha de taxa de bits.',
};

let aoFecharExportar = null;

function escolhasExportar() {
  return {
    codec: $('#exp-codec').value,
    formato: $('#exp-formato').value,
    qualidade: $('#render-qualidade').value,
    resolucao: Number($('#render-resolucao').value),
    fps: Number($('#exp-fps').value),
    semAudio: $('#render-sem-audio').checked,
  };
}

async function atualizarExportar() {
  const prores = $('#exp-codec').value === 'prores';
  // ProRes só existe em MOV e não tem taxa de bits para escolher.
  if (prores) $('#exp-formato').value = 'mov';
  $('#exp-formato').disabled = prores;
  $('#render-qualidade').disabled = prores;
  $('#exp-dica-codec').textContent = DICAS_CODEC[$('#exp-codec').value];
  const e = await api.estimarRender({ id: estado.projetoId, ...escolhasExportar() }).catch(() => null);
  if (!e?.duracao) return ($('#exp-resumo').textContent = '');
  const mb = e.megabytes >= 1000 ? `${(e.megabytes / 1000).toFixed(1)} GB` : `${Math.round(e.megabytes)} MB`;
  $('#exp-resumo').textContent = `Duração: ${Math.round(e.duracao)} s | Tamanho: cerca de ${mb}${$('#exp-linha-nome').hidden ? ' por vídeo' : ''}`;
}

// Resolve com as escolhas, ou null se cancelou. Na primeira vez vêm as especificações que o usuário usa no CapCut.
async function abrirExportar({ lote }) {
  const c = estado.config;
  const primeira = !c.renderCodec;
  const p = await api.projeto(estado.projetoId);
  preencherResolucoes(p);
  $('#exp-titulo').textContent = lote ? 'Exportar todos os vídeos da pasta' : `Exportar - ${p.nome}`;
  $('#exp-linha-nome').hidden = lote;
  $('#exp-nome').value = p.nome ?? '';
  $('#exp-pasta').value = c.renderPasta ?? '';
  $('#exp-pasta').placeholder = lote ? 'Escolha a pasta' : 'Pasta renders do projeto';
  $('#exp-codec').value = primeira ? 'hevc' : c.renderCodec;
  $('#exp-formato').value = primeira ? 'mov' : c.renderFormato;
  $('#render-qualidade').value = primeira || c.renderQualidade === 'media' ? 'recomendado' : c.renderQualidade;
  $('#render-sem-audio').checked = !!c.renderSemAudio;
  $('#exp-fps').replaceChildren(new Option(`Original (${p.fps} fps)`, '0'), ...[24, 25, 30, 50, 60].filter((f) => f !== p.fps).map((f) => new Option(`${f} fps`, String(f))));
  $('#exp-fps').value = [...$('#exp-fps').options].some((o) => Number(o.value) === c.renderFps) ? String(c.renderFps) : '0';
  $('#exp-linha-motor').hidden = !estado.ambiente?.filmcraft;

  const capa = TL.capa?.();
  const video = $('#exp-capa');
  video.parentElement.style.aspectRatio = `${p.largura} / ${p.altura}`;
  if (capa) video.src = `${capa.url}#t=${capa.tempo}`;
  atualizarExportar();
  const dlg = $('#dlg-exportar');
  dlg.showModal();
  return new Promise((ok) => {
    aoFecharExportar = (r) => {
      aoFecharExportar = null;
      video.removeAttribute('src');
      video.load();
      dlg.close();
      ok(r);
    };
  });
}

async function confirmarExportar() {
  const lote = $('#exp-linha-nome').hidden;
  let pasta = $('#exp-pasta').value;
  if (lote && !pasta) {
    pasta = await api.pastaSaida();
    if (!pasta) return;
    $('#exp-pasta').value = pasta;
  }
  const e = escolhasExportar();
  // A próxima exportação começa com as mesmas escolhas.
  estado.config = await api.salvarConfig({
    renderCodec: e.codec, renderFormato: e.formato, renderQualidade: e.qualidade, renderResolucao: e.resolucao, renderFps: e.fps, renderSemAudio: e.semAudio, renderPasta: pasta,
  });
  aoFecharExportar?.({ ...e, nome: $('#exp-nome').value, pastaSaida: pasta || null, modo: estado.config.renderModo, motor: estado.config.renderMotor });
}

async function renderTodos() {
  const botao = $('#btn-render-todos');
  if (estado.lote) {
    api.cancelarRenderTodos(estado.lote);
    return;
  }
  const escolhas = await abrirExportar({ lote: true });
  if (!escolhas) return;
  // Cada vídeo sai com o próprio nome.
  const { nome: _nome, ...opcoes } = escolhas;
  const { pastaSaida } = escolhas;
  // Vídeos que o Claude ainda está montando ficam de fora: o render pegaria a timeline pela metade.
  const ids = (estado.irmasIds ?? []).filter((id) => !estado.trabalhando.has(id));
  const ocupados = (estado.irmasIds ?? []).length - ids.length;
  if (!ids.length) return addMsg('erro', 'Nenhum vídeo desta pasta está pronto para exportar: o Claude ainda está montando.');
  await TL.salvarAgora();
  estado.lote = 'lote-' + Date.now();
  botao.textContent = 'Cancelar exportação';
  $('#btn-render').disabled = true;
  progresso(0, `Exportando 1 de ${ids.length}…`);
  ids.forEach((id) => marcarRender(id, { etapa: 'Na fila', progresso: 0, fila: true }));
  try {
    const r = await api.renderizarTodos({ ids, chave: estado.lote, ...opcoes });
    const falhas = r.resultados.filter((x) => !x.ok);
    const feitos = r.resultados.length - falhas.length;
    progresso(r.cancelado ? 0 : 1, r.cancelado ? `Exportação cancelada: ${feitos} de ${r.total} prontos` : `Exportação concluída: ${feitos} de ${r.total} vídeos`);
    for (const f of falhas) addMsg('erro', `Não exportou "${f.nome}": ${f.erro}`);
    if (ocupados) addMsg('info', `${ocupados} vídeo${ocupados > 1 ? 's' : ''} da pasta ficou de fora porque o Claude ainda está montando.`);
    if (feitos && !r.cancelado) addMsg('info', `${feitos} vídeo${feitos > 1 ? 's' : ''} exportado${feitos > 1 ? 's' : ''}, um por vez, em ${pastaSaida}.`);
  } catch (e) {
    addMsg('erro', 'A exportação em sequência falhou: ' + e.message.split('\n')[0]);
  } finally {
    estado.lote = null;
    ids.forEach((id) => marcarRender(id, null));
    botao.textContent = 'Exportar todos';
    definirTrabalhando(estado.trabalhando.has(estado.projetoId));
    carregarProjetos();
    if (estado.projetoId) renderListaRenders(await api.projeto(estado.projetoId));
  }
}

async function renderManual() {
  const id = estado.projetoId;
  const escolhas = await abrirExportar({ lote: false });
  if (!escolhas) return;
  await TL.salvarAgora();
  definirTrabalhando(true);
  progresso(0, 'Iniciando render…');
  marcarRender(id, { etapa: 'Iniciando', progresso: 0, fila: false });
  try {
    await api.renderizar({ id, ...escolhas });
  } catch (e) {
    addMsg('erro', 'Render falhou. Peça ao Claude para corrigir: "o render falhou, corrija".');
  }
  marcarRender(id, null);
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

const tc = { itens: [], formato: 'mp4', codificador: null, qualidade: null, velocidade: 1, audio: 'aac', resolucao: '', ajuste: 'barras', pasta: null, rodando: false };

const codificadorAtual = () => tc.catalogo?.video.find((c) => c.id === tc.codificador);

// Formato, codificador, qualidade e áudio dependem uns dos outros (ex.: AV1 não cabe em MOV, Vorbis só em MKV).
function ajustarOpcoesTranscode() {
  const cat = tc.catalogo;
  if (!cat) return;
  if (!codificadorAtual()) {
    // Padrão como antes: H.264 na placa de vídeo quando ela dá conta; senão x264.
    tc.codificador = (cat.video.find((c) => c.codec === 'h264' && c.tipo === 'gpu') ?? cat.video.find((c) => c.id === 'libx264') ?? cat.video[0])?.id;
    tc.qualidade = null;
  }
  const enc = codificadorAtual();
  if (!enc) return;
  if (!enc.formatos.includes(tc.formato)) tc.formato = enc.formatos[0];
  tc.qualidade ??= enc.q.padrao;
  const audios = cat.audio.filter((a) => a.formatos.includes(tc.formato));
  if (!audios.some((a) => a.id === tc.audio)) tc.audio = audios[0]?.id ?? 'aac';

  const sel = $('#tc-codificador');
  sel.replaceChildren();
  for (const [tipo, rotulo] of [['cpu', 'CPU (software)'], ['gpu', 'Placa de vídeo']]) {
    const grupo = document.createElement('optgroup');
    grupo.label = rotulo;
    for (const c of cat.video.filter((x) => x.tipo === tipo)) grupo.append(new Option(c.nome, c.id));
    if (grupo.children.length) sel.append(grupo);
  }
  sel.value = tc.codificador;
  $('#tc-velocidade').replaceChildren(...cat.velocidades.map((n, i) => new Option(n, i)));
  $('#tc-velocidade').value = tc.velocidade;
  $('#tc-audio').replaceChildren(...audios.map((a) => new Option(a.nome, a.id)));
  $('#tc-audio').value = tc.audio;
  const q = $('#tc-qualidade');
  q.min = enc.q.min;
  q.max = enc.q.max;
  q.value = tc.qualidade;
  $('#tc-q-rotulo').textContent = `Qualidade (${enc.q.maiorMelhor ? 'maior' : 'menor'} = melhor)`;
  // Formatos que o codificador não aceita ficam desligados.
  segmentado($('#seg-tc-formato'), tc.formato, (v) => {
    tc.formato = v;
    ajustarOpcoesTranscode();
  });
  $('#seg-tc-formato').querySelectorAll('button').forEach((b) => (b.disabled = !enc.formatos.includes(b.dataset.v)));
}

async function abrirTranscode() {
  TL.fechar();
  estado.projetoId = null;
  carregarProjetos();
  renderTranscode();
  mostrarVista('transcode');
  if (!tc.catalogo) {
    $('#tc-codificador').replaceChildren(new Option('Procurando codificadores…', ''));
    tc.catalogo = await api.codificadores();
  }
  ajustarOpcoesTranscode();
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
      pronto: `Pronto (${it.codificador ?? it.modo?.toUpperCase()}, ${it.segundos}s) — abrir`,
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
  const resultados = await api.transcodificar({
    arquivos: fila.map((i) => i.arquivo),
    formato: tc.formato,
    codificador: tc.codificador,
    qualidade: tc.qualidade,
    velocidade: tc.velocidade,
    audio: tc.audio,
    resolucao: tc.resolucao || null,
    ajuste: tc.ajuste,
    pastaSaida: tc.pasta,
  });
  fila.forEach((i, n) => Object.assign(i, resultados[n], { naFila: false }));
  tc.rodando = false;
  renderTranscode();
}

function ligarTranscode() {
  $('#btn-transcode').onclick = abrirTranscode;
  $('#btn-sel-transcode').onclick = async () => adicionarTranscode(await api.escolher({ tipo: 'videos', multiplos: true }));
  $('#tc-codificador').onchange = (e) => {
    tc.codificador = e.target.value;
    tc.qualidade = null; // cada codificador tem a sua escala
    ajustarOpcoesTranscode();
  };
  $('#tc-qualidade').onchange = (e) => {
    const q = codificadorAtual()?.q;
    const n = Math.round(Number(e.target.value));
    tc.qualidade = q ? Math.min(q.max, Math.max(q.min, Number.isFinite(n) ? n : q.padrao)) : n;
    e.target.value = tc.qualidade;
  };
  $('#tc-velocidade').onchange = (e) => (tc.velocidade = Number(e.target.value));
  $('#tc-audio').onchange = (e) => (tc.audio = e.target.value);
  $('#tc-resolucao').onchange = (e) => (tc.resolucao = e.target.value);
  $('#tc-ajuste').onchange = (e) => (tc.ajuste = e.target.value);
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

// ---------- decupagem de narrações ----------

const dc = { itens: [], pausa: 0.15, sobreposicao: 0.2, limiar: -35, velocidade: 1.2, formato: 'wav', aprimorar: true, normalizar: true, ganho: 4, pasta: null, rodando: false };
const EXT_AUDIOS = /\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i;

const tempo = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function abrirDecupar() {
  TL.fechar();
  estado.projetoId = null;
  carregarProjetos();
  renderDecupar();
  mostrarVista('decupar');
}

async function adicionarDecupar(caminhos) {
  // Arquivos soltos entram um a um; cada pasta vira um item só, com os áudios dela como partes da mesma narração.
  const infos = await api.infoAudios(caminhos);
  let achou = false;
  for (const info of infos) {
    achou = true;
    if (info.duracao > 0 && !dc.itens.some((i) => i.arquivo === info.arquivo)) dc.itens.push({ ...info, status: 'aguardando', progresso: 0 });
  }
  $('#dc-aviso').textContent = !achou && caminhos.length ? 'Não achei áudios nessa seleção.' : '';
  renderDecupar();
}

// Diferenças entre o áudio e o roteiro: só as palavras com problema e um pouco de contexto ao redor.
function elementoDiferencas(ops) {
  const raiz = document.createElement('div');
  raiz.className = 'dif-texto';
  const ruim = ops.map((o) => o.t !== 'ok' && o.t !== 'quase');
  const mostrar = ops.map((_, i) => ruim.slice(Math.max(0, i - 5), i + 6).some(Boolean));
  let pulou = false;
  ops.forEach((o, i) => {
    if (!mostrar[i]) {
      if (!pulou) raiz.append('… ');
      pulou = true;
      return;
    }
    pulou = false;
    const palavra = (classe, txt, titulo) => {
      const s = document.createElement(classe === 'dif-falta' || classe === 'dif-troca-r' ? 'del' : classe === 'dif-extra' || classe === 'dif-troca-o' ? 'ins' : 'span');
      s.className = classe;
      s.textContent = txt;
      if (titulo) s.title = titulo;
      raiz.append(s, ' ');
    };
    if (o.t === 'ok') palavra('dif-ok', o.o);
    else if (o.t === 'quase') palavra('dif-quase', o.o, 'Roteiro: ' + o.r);
    else if (o.t === 'troca') {
      palavra('dif-troca-r', o.r, 'Está no roteiro');
      palavra('dif-troca-o', o.o, 'Foi dito');
    } else if (o.t === 'extra') palavra('dif-extra', o.o, 'Dito, mas não está no roteiro');
    else palavra('dif-falta', o.r, 'Está no roteiro, mas não foi dito');
  });
  return raiz;
}

function blocoConferencia(it) {
  const c = it.conf;
  const div = document.createElement('div');
  div.className = 'conf';
  if (it.confProgresso != null && !c) {
    div.textContent = `Transcrevendo e conferindo… ${Math.round(it.confProgresso * 100)}%`;
    return div;
  }
  if (!c) return null;
  if (c.erro) {
    div.textContent = 'Não consegui conferir: ' + c.erro;
    div.classList.add('conf-ruim');
    return div;
  }
  if (c.vazio) {
    div.textContent = 'Não ouvi fala neste áudio.';
    div.classList.add('conf-ruim');
    return div;
  }
  const resumo = document.createElement('div');
  resumo.className = 'conf-resumo ' + (c.acerto >= 95 ? 'conf-ok' : c.acerto >= 80 ? 'conf-meio' : 'conf-ruim');
  resumo.textContent = `Igual ao roteiro: ${c.acerto}% · ${c.trocas} trocada${c.trocas === 1 ? '' : 's'} · ${c.faltas} faltando · ${c.sobras} a mais`;
  div.append(resumo);
  if (c.trocas + c.faltas + c.sobras > 0) {
    const det = document.createElement('details');
    det.innerHTML = '<summary>Ver diferenças</summary>';
    const legenda = document.createElement('small');
    legenda.className = 'sub';
    legenda.textContent = 'Riscado = está no roteiro e não foi dito. Sublinhado = foi dito e não está no roteiro.';
    det.append(legenda, elementoDiferencas(c.ops));
    div.append(det);
  }
  return div;
}

function renderDecupar() {
  const ul = $('#lista-decupar');
  ul.innerHTML = '';
  dc.itens.forEach((it) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="tc-nome"><span></span><small></small></div><span class="selo"></span><span class="tc-status"></span><div class="barra"></div>`;
    li.querySelector('.tc-nome span').textContent = it.pasta ? it.nome : nomeArquivo(it.arquivo);
    const partes = it.pasta ? `${it.arquivos.length} áudio${it.arquivos.length === 1 ? '' : 's'} juntados · ` : '';
    li.querySelector('small').textContent = partes + (it.status === 'pronto' ? `${it.cortes} cortes · ${tempo(it.antes)} → ${tempo(it.depois)}` : tempo(it.duracao));
    li.querySelector('.selo').textContent = it.pasta ? 'PASTA' : nomeArquivo(it.arquivo).split('.').pop().toUpperCase();
    if (it.pasta) li.querySelector('.tc-nome').title = it.arquivos.map(nomeArquivo).join('\n');
    const st = li.querySelector('.tc-status');
    st.className = 'tc-status ' + (it.status === 'decupando' ? '' : it.status);
    st.textContent = { aguardando: 'Na fila', decupando: `${Math.round(it.progresso * 100)}%`, pronto: `Pronto (${it.segundos}s) — abrir`, erro: 'Erro: ' + (it.erro ?? '') }[it.status];
    st.title = it.erro ?? '';
    if (it.status === 'pronto') st.onclick = () => api.mostrarNaPasta(it.saida);
    li.querySelector('.barra').style.width = `${Math.round(it.progresso * 100)}%`;
    const conf = blocoConferencia(it);
    if (conf) li.append(conf);
    ul.append(li);
  });
  const resumo = $('#dc-resumo-roteiro');
  resumo.hidden = !dc.semAudio;
  if (dc.semAudio) {
    const s = dc.semAudio;
    resumo.className = 'resumo-roteiro ' + (s.blocos.length ? 'conf-meio' : 'conf-ok');
    resumo.replaceChildren();
    const t = document.createElement('div');
    t.textContent = s.blocos.length
      ? `O roteiro tem ${s.total} palavras e os áudios cobrem ${s.cobertas}. Trechos sem áudio:`
      : `Os áudios cobrem o roteiro inteiro (${s.cobertas} de ${s.total} palavras).`;
    resumo.append(t);
    for (const b of s.blocos) {
      const p = document.createElement('blockquote');
      p.textContent = b;
      resumo.append(p);
    }
  }
  const pendentes = dc.itens.some((i) => i.status === 'aguardando' || i.status === 'erro');
  const temRoteiro = $('#dc-roteiro').value.trim().length > 0;
  $('#btn-dc-conferir').disabled = dc.rodando || dc.conferindo || !dc.itens.length || !temRoteiro;
  $('#btn-dc-conferir').textContent = dc.conferindo ? 'Conferindo…' : 'Conferir com o roteiro';
  $('#btn-dc-iniciar').disabled = dc.rodando || dc.conferindo || !pendentes;
  $('#btn-dc-cancelar').hidden = !dc.rodando;
  $('#btn-dc-limpar').disabled = dc.rodando;
  $('#dc-pasta').textContent = dc.pasta ?? 'Mesma pasta do original';
  $('#btn-dc-pasta-limpar').hidden = !dc.pasta;
}

api.aoDecupar((e) => {
  const it = dc.itens.filter((i) => i.naFila)[e.indice];
  if (!it) return;
  Object.assign(it, e);
  renderDecupar();
});

api.aoConferir((e) => {
  const it = dc.itens[e.indice];
  if (!it) return;
  it.confProgresso = e.progresso;
  renderDecupar();
});

async function conferirDecupar() {
  const roteiro = $('#dc-roteiro').value.trim();
  if (!roteiro || !dc.itens.length) return;
  dc.conferindo = true;
  dc.semAudio = null;
  dc.itens.forEach((i) => Object.assign(i, { conf: null, confProgresso: 0 }));
  renderDecupar();
  try {
    const r = await api.conferirAudios({ arquivos: dc.itens.map((i) => i.arquivos), roteiro });
    dc.itens.forEach((i, n) => Object.assign(i, { conf: r.resultados[n], confProgresso: null }));
    if (!r.cancelado) dc.semAudio = r.semAudio;
  } catch (e) {
    dc.itens.forEach((i) => Object.assign(i, { conf: { erro: e.message.split('\n').pop() }, confProgresso: null }));
  }
  dc.conferindo = false;
  renderDecupar();
}

async function carregarRoteiro(r) {
  const info = $('#dc-roteiro-info');
  if (!r) return;
  if (r.erro) {
    info.textContent = 'Não consegui ler ' + nomeArquivo(r.arquivo) + ': ' + r.erro;
    return;
  }
  $('#dc-roteiro').value = r.texto;
  info.textContent = `${nomeArquivo(r.arquivo)} carregado (${r.texto.split(/\s+/).length} palavras). Dá para editar o texto.`;
  renderDecupar();
}

async function iniciarDecupar() {
  dc.itens.forEach((i) => (i.naFila = i.status === 'aguardando' || i.status === 'erro'));
  const fila = dc.itens.filter((i) => i.naFila);
  fila.forEach((i) => Object.assign(i, { status: 'aguardando', progresso: 0, erro: null }));
  dc.rodando = true;
  renderDecupar();
  const resultados = await api.decuparAudios({
    itens: fila.map((i) => ({ arquivo: i.arquivo, arquivos: i.arquivos, pasta: !!i.pasta })),
    opcoes: {
      pausa: dc.pausa,
      sobreposicao: dc.sobreposicao,
      limiar: dc.limiar,
      velocidade: dc.velocidade,
      formato: dc.formato,
      aprimorar: dc.aprimorar,
      normalizar: dc.normalizar,
      ganho: dc.ganho,
      pastaSaida: dc.pasta,
    },
  });
  fila.forEach((i, n) => Object.assign(i, resultados[n], { naFila: false }));
  dc.rodando = false;
  renderDecupar();
}

function ligarDecupar() {
  $('#btn-decupar').onclick = abrirDecupar;
  $('#btn-sel-decupar').onclick = async () => adicionarDecupar(await api.escolher({ tipo: 'narracao', multiplos: true }));
  $('#btn-sel-decupar-pastas').onclick = async () => adicionarDecupar(await api.escolherPastas());
  const numero = (id, chave, min, max) => {
    const el = $(id);
    el.value = dc[chave];
    el.onchange = () => {
      const v = Number(el.value);
      dc[chave] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dc[chave];
      el.value = dc[chave];
    };
  };
  numero('#dc-pausa', 'pausa', 0, 1);
  numero('#dc-sobreposicao', 'sobreposicao', 0.05, 0.6);
  numero('#dc-limiar', 'limiar', -60, -15);
  numero('#dc-ganho', 'ganho', 0, 12);
  $('#dc-velocidade').value = String(dc.velocidade);
  $('#dc-velocidade').onchange = (e) => (dc.velocidade = Number(e.target.value));
  $('#dc-aprimorar').checked = dc.aprimorar;
  $('#dc-aprimorar').onchange = (e) => (dc.aprimorar = e.target.checked);
  $('#dc-normalizar').checked = dc.normalizar;
  $('#dc-normalizar').onchange = (e) => (dc.normalizar = e.target.checked);
  segmentado($('#seg-dc-formato'), dc.formato, (v) => (dc.formato = v));
  $('#btn-dc-iniciar').onclick = iniciarDecupar;
  $('#btn-dc-conferir').onclick = conferirDecupar;
  $('#dc-roteiro').oninput = renderDecupar;
  $('#btn-dc-roteiro-arquivo').onclick = async () => carregarRoteiro(await api.escolherRoteiro());
  $('#btn-dc-roteiro-limpar').onclick = () => {
    $('#dc-roteiro').value = '';
    $('#dc-roteiro-info').textContent = '';
    dc.semAudio = null;
    dc.itens.forEach((i) => Object.assign(i, { conf: null, confProgresso: null }));
    renderDecupar();
  };
  areaDeSoltar($('#drop-roteiro'), async (caminhos) => caminhos[0] && carregarRoteiro(await api.lerRoteiro(caminhos[0])));
  $('#btn-dc-cancelar').onclick = () => api.cancelarDecupagem();
  $('#btn-dc-limpar').onclick = () => {
    dc.itens = [];
    renderDecupar();
  };
  $('#btn-dc-pasta').onclick = async () => {
    const p = await api.pastaSaida();
    if (p) dc.pasta = p;
    renderDecupar();
  };
  $('#btn-dc-pasta-limpar').onclick = () => {
    dc.pasta = null;
    renderDecupar();
  };
  areaDeSoltar($('#drop-decupar'), adicionarDecupar);
}

// ---------- configurações ----------

const CAMPOS = {
  'cfg-modelo': 'modeloClaude',
  'cfg-esforco': 'esforcoClaude',
  'cfg-apikey': 'apiKey',
  'cfg-workspace': 'workspaceDir',
  'cfg-whisper': 'whisperDir',
  'cfg-whisper-modelo': 'whisperModelo',
  'cfg-ffmpeg': 'ffmpegPath',
  'cfg-skills': 'skillsOrigem',
};

const MODELOS = [
  ['claude-opus-5-5', 'Opus 5.5 (melhor qualidade)'],
  ['claude-sonnet-5-5', 'Sonnet 5.5 (equilibrado)'],
  ['claude-haiku-5-5', 'Haiku 5.5 (mais rápido e barato)'],
  ['claude-fable-5-1', 'Fable 5.1'],
];

// Os seletores (chat, estilo e configurações) mostram o mesmo modelo salvo.
function preencherModelos() {
  const atual = estado.config?.modeloClaude;
  const lista = MODELOS.some(([v]) => v === atual) || !atual ? MODELOS : [...MODELOS, [atual, atual]];
  for (const sel of [$('#chat-modelo'), $('#cfg-modelo'), $('#estilo-modelo')]) {
    sel.replaceChildren(...lista.map(([v, t]) => new Option(t, v)));
    sel.value = atual ?? MODELOS[0][0];
  }
}

const ESFORCOS = [
  ['low', 'Baixo'],
  ['medium', 'Médio'],
  ['high', 'Alto'],
  ['xhigh', 'Extra'],
];

function preencherEsforcos() {
  const atual = estado.config?.esforcoClaude ?? 'high';
  for (const sel of [$('#chat-esforco'), $('#cfg-esforco')]) {
    sel.replaceChildren(...ESFORCOS.map(([v, t]) => new Option(sel.id === 'chat-esforco' ? `Esforço: ${t}` : t, v)));
    sel.value = atual;
  }
}

function abrirConfig() {
  preencherModelos();
  preencherEsforcos();
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
  preencherModelos();
  preencherEsforcos();
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
  if (!estado.ambiente.encoderGpu && estado.config.renderModo === 'gpu') {
    estado.config = await api.salvarConfig({ renderModo: 'cpu' });
  }
  renderRascunhos();
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
  ligarDecupar();
  $('#chat-esforco').onchange = async (e) => {
    estado.config = await api.salvarConfig({ esforcoClaude: e.target.value });
    preencherEsforcos();
  };
  for (const id of ['#chat-modelo', '#estilo-modelo']) {
    $(id).onchange = async (e) => {
      estado.config = await api.salvarConfig({ modeloClaude: e.target.value });
      preencherModelos();
    };
  }
  $('#btn-renomear-projeto').onclick = renomearProjetoAtual;
  $('#ed-nome').ondblclick = renomearProjetoAtual;
  $('#btn-sel-referencia').onclick = async () => adicionarReferencias(await api.escolher({ tipo: 'referencia', multiplos: true }));
  areaDeSoltar($('#drop-referencia'), adicionarReferencias);
  $('#btn-sel-audio-instrucao').onclick = async () => adicionarAudiosInstrucao(await api.escolher({ tipo: 'audioInstrucao', multiplos: true }));
  areaDeSoltar($('#drop-audio-instrucao'), adicionarAudiosInstrucao);
  $('#btn-pular-narracao').onclick = () => {
    estado.semNarracao = true;
    $('#sem-narracao').checked = true;
    renderNarracao();
    irPasso(3);
  };
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
  $('#btn-sel-roteiro-material').onclick = async () => adicionarRoteirosNovos(await api.escolher({ tipo: 'roteiro', multiplos: true }));
  areaDeSoltar($('#drop-roteiro-material'), (caminhos) => adicionarRoteirosNovos(caminhos.filter((c) => EXT_ROTEIRO.test(c))));
  areaDeSoltar($('#drop-narracao'), adicionarNarracoes);
}

async function renderEstilosUmaVez() {
  estado.catalogo = await api.catalogo();
  estado.config = await api.lerConfig();
  renderEstilos();
  segmentado($('#seg-motor'), estado.config.renderMotor, async (v) => (estado.config = await api.salvarConfig({ renderMotor: v })));
  segmentado($('#seg-modo'), estado.config.renderModo, async (v) => (estado.config = await api.salvarConfig({ renderModo: v })));
  $('#btn-render-todos').onclick = renderTodos;
  ['#exp-codec', '#exp-formato', '#render-qualidade', '#render-resolucao', '#exp-fps'].forEach((c) => ($(c).onchange = atualizarExportar));
  $('#exp-cancelar').onclick = () => aoFecharExportar?.(null);
  $('#exp-confirmar').onclick = confirmarExportar;
  // Esc fecha a janela: vale como cancelar.
  $('#dlg-exportar').addEventListener('cancel', (e) => {
    e.preventDefault();
    aoFecharExportar?.(null);
  });
  $('#exp-btn-pasta').onclick = async () => {
    const pasta = await api.pastaSaida();
    if (pasta) $('#exp-pasta').value = pasta;
  };
  iniciar();
}

// Espera timeline.js, que depende das funções deste arquivo.
window.addEventListener('DOMContentLoaded', ligar);
