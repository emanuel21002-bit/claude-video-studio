// A tela do painel (CEP): o chat com o Claude do MovAi e o laço que busca os comandos e devolve os resultados.
/* global window, executarComando */
const $ = (s) => document.querySelector(s);
let base = 'http://127.0.0.1:47821';
let token = '';
let ultimo = 0;
let ocupado = false;

// config.js (gravado pelo MovAi na instalação) define window.MOVAI_CONFIG = { porta, token }.
async function lerConfig() {
  const c = window.MOVAI_CONFIG;
  if (!c) return situacao('Sem configuração: instale o painel pelo MovAi.', false);
  base = `http://127.0.0.1:${c.porta}`;
  token = c.token;
}

function situacao(texto, conectado) {
  $('#situacao').textContent = texto;
  $('#ponto').className = conectado ? (ocupado ? 'ocupado' : 'ok') : '';
}

function mensagem(tipo, texto) {
  const m = $('#mensagens');
  const d = document.createElement('div');
  d.className = `msg ${tipo}`;
  d.textContent = texto;
  m.appendChild(d);
  m.scrollTop = m.scrollHeight;
}

async function chamar(rota, corpo) {
  const r = await fetch(base + rota, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-movai-token': token },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

function marcarOcupado(v) {
  ocupado = v;
  $('#cancelar').hidden = !v;
  $('#enviar').disabled = v;
  situacao(v ? 'O Claude está editando…' : 'Conectado ao MovAi', true);
}

async function responderComando(e) {
  let resposta;
  try {
    resposta = { id: e.id, ok: true, resultado: await executarComando(e.nome, e.args) };
  } catch (erro) {
    resposta = { id: e.id, ok: false, erro: String((erro && erro.message) || erro) };
  }
  await chamar('/resposta', resposta).catch(() => {});
}

// Andamento (montagem no MovAi, render dos textos): uma linha só, que vai sendo trocada.
function progresso(texto) {
  let d = $('#mensagens .msg.progresso:last-child');
  if (!d) {
    mensagem('progresso', texto);
    return;
  }
  d.textContent = texto;
}

function tratar(e) {
  if (e.tipo === 'comando') return responderComando(e);
  if (e.tipo === 'progresso') return progresso(e.texto);
  if (e.tipo === 'voce' || e.tipo === 'texto' || e.tipo === 'acao' || e.tipo === 'erro') mensagem(e.tipo, e.texto);
  if (e.tipo === 'ocupado') marcarOcupado(true);
  if (e.tipo === 'parado') marcarOcupado(false);
}

async function carregarHistorico() {
  const h = await chamar('/historico');
  $('#mensagens').innerHTML = '';
  for (const e of h.historico) mensagem(e.tipo, e.texto);
  if (!h.historico.length) mensagem('info', 'Peça uma edição: o Claude lê e edita a sequência aberta.');
  ultimo = h.ultimo;
  marcarOcupado(h.ocupado);
}

// Long-poll: o app segura o pedido até ter novidade.
async function laco() {
  let conectado = false;
  for (;;) {
    try {
      if (!conectado) {
        await carregarHistorico();
        conectado = true;
      }
      const r = await chamar(`/eventos?desde=${ultimo}`);
      ultimo = r.ultimo;
      for (const e of r.eventos) tratar(e);
      if (!r.ocupado && ocupado) marcarOcupado(false);
    } catch (e) {
      conectado = false;
      situacao(/Token/.test(e.message) ? e.message : 'MovAi fechado: abra o app para usar o painel.', false);
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
}

async function enviar() {
  const texto = $('#entrada').value.trim();
  if (!texto || ocupado) return;
  $('#entrada').value = '';
  marcarOcupado(true);
  try {
    await chamar('/chat', { mensagem: texto });
  } catch (e) {
    mensagem('erro', e.message);
    marcarOcupado(false);
  }
}

$('#enviar').addEventListener('click', enviar);
$('#entrada').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar();
});
$('#cancelar').addEventListener('click', () => chamar('/cancelar', {}).catch(() => {}));
$('#novo').addEventListener('click', async () => {
  try {
    await chamar('/novo', {});
    await carregarHistorico();
  } catch (e) {
    mensagem('erro', e.message);
  }
});

// ---------- Novo vídeo: o mesmo "Novo projeto" do app, e a sequência aparece aqui ----------

const escolhidos = { materiais: [], narracoes: [] };
let estilos = [];
const nomeCurto = (c) => c.split(/[\\/]/).pop();

function desenharListas() {
  for (const k of ['materiais', 'narracoes']) {
    const el = $(`#f-${k}`);
    el.innerHTML = '';
    for (const c of escolhidos[k]) {
      const d = document.createElement('div');
      d.textContent = nomeCurto(c);
      d.title = c;
      el.appendChild(d);
    }
  }
  $('#f-mat-conta').textContent = escolhidos.materiais.length ? `(${escolhidos.materiais.length})` : '';
}

async function abrirFormulario() {
  $('#form').hidden = false;
  $('#mensagens').hidden = true;
  $('#rodape').hidden = true;
  if (!estilos.length) {
    try {
      const r = await chamar('/estilos');
      estilos = r.estilos;
      $('#f-estilo').innerHTML = estilos.map((e, i) => `<option value="${i}">${e.nome}</option>`).join('');
      $('#f-formato').innerHTML = r.formatos.map((f) => `<option>${f}</option>`).join('');
      escolherEstilo();
    } catch (e) {
      mensagem('erro', e.message);
    }
  }
}

function fecharFormulario() {
  $('#form').hidden = true;
  $('#mensagens').hidden = false;
  $('#rodape').hidden = false;
}

function escolherEstilo() {
  const e = estilos[Number($('#f-estilo').value)];
  if (!e) return;
  $('#f-estilo-desc').textContent = e.descricao || '';
  if (e.formato) $('#f-formato').value = e.formato;
}

document.querySelectorAll('[data-escolher]').forEach((b) =>
  b.addEventListener('click', async () => {
    const k = b.dataset.escolher;
    try {
      const r = await chamar('/escolher', { tipo: b.dataset.tipo, filtro: k === 'narracoes' ? 'audio' : 'midia', titulo: k === 'narracoes' ? 'Narração' : 'Material' });
      for (const c of r.caminhos) if (!escolhidos[k].includes(c)) escolhidos[k].push(c);
      desenharListas();
    } catch (e) {
      mensagem('erro', e.message);
    }
  }),
);
document.querySelectorAll('[data-limpar]').forEach((b) =>
  b.addEventListener('click', () => {
    escolhidos[b.dataset.limpar] = [];
    desenharListas();
  }),
);
$('#f-estilo').addEventListener('change', escolherEstilo);
$('#abrir-novo').addEventListener('click', () => ($('#form').hidden ? abrirFormulario() : fecharFormulario()));
$('#f-cancelar').addEventListener('click', fecharFormulario);
$('#f-criar').addEventListener('click', async () => {
  if (ocupado) return mensagem('erro', 'Espere o Claude terminar.');
  const e = estilos[Number($('#f-estilo').value)] || {};
  const dados = {
    nome: $('#f-nome').value.trim(),
    materiais: escolhidos.materiais,
    narracoes: escolhidos.narracoes,
    estiloId: e.id,
    estiloTexto: $('#f-briefing').value.trim(),
    engine: e.engine || 'remotion',
    formato: $('#f-formato').value,
  };
  if (!dados.materiais.length) return alert('Escolha o material.');
  $('#f-criar').disabled = true;
  fecharFormulario();
  marcarOcupado(true);
  try {
    await chamar('/novo-video', dados);
    escolhidos.materiais = [];
    escolhidos.narracoes = [];
    desenharListas();
    $('#f-nome').value = '';
    $('#f-briefing').value = '';
  } catch (err) {
    mensagem('erro', err.message);
    marcarOcupado(false);
  } finally {
    $('#f-criar').disabled = false;
  }
});

lerConfig().then(laco);
