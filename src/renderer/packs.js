// Packs de edição: a aba da biblioteca, a escolha na criação do projeto e a janela dentro do editor.

const pk = { lista: [], aberto: null, busca: '', adicionando: false };

const tamanhoLegivel = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const contagemPack = (p) => [p.totais.video && plural(p.totais.video, 'vídeo', 'vídeos'), p.totais.imagem && plural(p.totais.imagem, 'imagem', 'imagens'), p.totais.audio && plural(p.totais.audio, 'áudio', 'áudios')].filter(Boolean).join(' · ') || 'Vazio';
const duracaoPack = (i) => (i.tipo === 'imagem' || i.duracao == null ? 'imagem' : `${i.duracao.toFixed(1)} s`);

async function atualizarPacks() {
  pk.lista = await api.listarPacks();
  renderPacksWizard();
}

// ---------- aba Packs ----------

function abrirPacks() {
  TL.fechar();
  estado.projetoId = null;
  mostrarVista('packs');
  atualizarPacks().then(renderPacks);
}

function renderPacks() {
  const ul = $('#lista-packs');
  ul.replaceChildren(
    ...pk.lista.map((p) => {
      const li = document.createElement('li');
      li.className = 'pack-linha' + (p.id === pk.aberto ? ' ativo' : '');
      li.innerHTML = '<div class="p-nome"></div><div class="p-meta"></div>';
      li.querySelector('.p-nome').textContent = p.nome;
      li.querySelector('.p-meta').textContent = `${contagemPack(p)}${p.itens.length ? ' · ' + tamanhoLegivel(p.totais.bytes) : ''}`;
      li.onclick = () => {
        pk.aberto = p.id;
        pk.busca = '';
        $('#pack-busca').value = '';
        renderPacks();
      };
      return li;
    }),
  );
  $('#packs-vazio').hidden = pk.lista.length > 0;
  const p = pk.lista.find((x) => x.id === pk.aberto);
  $('#pack-detalhe').hidden = !p;
  $('#pack-nenhum').hidden = !!p || !pk.lista.length;
  if (!p) return;
  if (document.activeElement !== $('#pack-nome')) $('#pack-nome').value = p.nome;
  if (document.activeElement !== $('#pack-descricao')) $('#pack-descricao').value = p.descricao ?? '';
  renderItensDoPack(p);
}

function renderItensDoPack(p) {
  const termo = sem(pk.busca);
  const itens = p.itens.filter((i) => !termo || sem(`${i.nome} ${i.pasta}`).includes(termo));
  const ul = $('#pack-itens');
  ul.replaceChildren(
    ...itens.slice(0, 500).map((i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="pack-tipo"></span><span class="pack-item-nome"></span><span class="pack-item-pasta"></span><span class="pack-item-dur"></span><button type="button" title="Tirar do pack. Os projetos que já usam continuam com o arquivo.">×</button>';
      li.querySelector('.pack-tipo').textContent = { video: 'Vídeo', imagem: 'Imagem', audio: 'Áudio' }[i.tipo];
      li.querySelector('.pack-item-nome').textContent = i.nome;
      li.querySelector('.pack-item-pasta').textContent = i.pasta;
      li.querySelector('.pack-item-dur').textContent = duracaoPack(i);
      li.onclick = () => previaDoPack(i);
      li.querySelector('button').onclick = async (ev) => {
        ev.stopPropagation();
        await api.removerDoPack({ id: p.id, arquivos: [i.arquivo] });
        await atualizarPacks();
        renderPacks();
      };
      return li;
    }),
  );
  $('#pack-total').textContent = itens.length > 500 ? `Mostrando 500 de ${itens.length}. Use a busca.` : `${itens.length} ${itens.length === 1 ? 'arquivo' : 'arquivos'}`;
}

function previaDoPack(i) {
  const box = $('#pack-previa');
  box.hidden = false;
  box.replaceChildren();
  const el = document.createElement(i.tipo === 'imagem' ? 'img' : i.tipo === 'video' ? 'video' : 'audio');
  el.src = urlArquivo(i.caminho);
  if (i.tipo !== 'imagem') {
    el.controls = true;
    el.autoplay = true;
  }
  box.append(el);
}

async function adicionarAoPackAberto(caminhos) {
  if (!pk.aberto || !caminhos?.length || pk.adicionando) return;
  pk.adicionando = true;
  const info = $('#pack-progresso');
  const tirar = api.aoProgressoPack((e) => {
    info.textContent = e.nome ? `Guardando ${e.feitos + 1} de ${e.total}: ${e.nome}` : '';
  });
  try {
    const r = await api.adicionarAoPack({ id: pk.aberto, caminhos });
    const partes = [`${r.adicionados} ${r.adicionados === 1 ? 'arquivo adicionado' : 'arquivos adicionados'}`];
    if (r.repetidos) partes.push(`${r.repetidos} já estavam no pack`);
    if (r.falhas) partes.push(`${r.falhas} não deram certo`);
    info.textContent = partes.join(', ') + '.';
  } catch (e) {
    info.textContent = 'Não consegui adicionar: ' + e.message.split('\n')[0];
  } finally {
    tirar();
    pk.adicionando = false;
  }
  await atualizarPacks();
  renderPacks();
}

// O Electron não tem prompt(): uma janelinha própria para o nome.
function pedirNomePack() {
  return new Promise((ok) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg-workspace';
    dlg.innerHTML = '<form method="dialog" class="form-config"><h3>Nome do pack</h3><input maxlength="60" required placeholder="Ex.: Efeitos sonoros" /><div class="linha-botoes"><button value="" formnovalidate>Cancelar</button><button value="ok" class="primario">Criar</button></div></form>';
    dlg.addEventListener('close', () => {
      const nome = dlg.returnValue === 'ok' ? dlg.querySelector('input').value.trim() : '';
      dlg.remove();
      ok(nome || null);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

function ligarPacks() {
  $('#btn-packs').onclick = abrirPacks;
  $('#btn-pack-novo').onclick = async () => {
    const nome = await pedirNomePack();
    if (!nome) return;
    const p = await api.criarPack(nome);
    pk.aberto = p.id;
    await atualizarPacks();
    renderPacks();
  };
  const guardarCampos = async () => {
    if (!pk.aberto) return;
    await api.atualizarPack({ id: pk.aberto, nome: $('#pack-nome').value, descricao: $('#pack-descricao').value });
    await atualizarPacks();
    renderPacks();
  };
  $('#pack-nome').onchange = guardarCampos;
  $('#pack-descricao').onchange = guardarCampos;
  $('#pack-busca').oninput = (e) => {
    pk.busca = e.target.value;
    const p = pk.lista.find((x) => x.id === pk.aberto);
    if (p) renderItensDoPack(p);
  };
  $('#btn-pack-arquivos').onclick = async () => adicionarAoPackAberto(await api.escolher({ tipo: 'materiais', multiplos: true }));
  $('#btn-pack-pasta').onclick = async () => adicionarAoPackAberto(await api.escolherPasta());
  areaDeSoltar($('#pack-drop'), adicionarAoPackAberto);
  $('#btn-pack-excluir').onclick = async () => {
    const p = pk.lista.find((x) => x.id === pk.aberto);
    if (!p || !confirm(`Apagar o pack "${p.nome}" e os ${p.itens.length} arquivos guardados nele? Isso não pode ser desfeito. Os projetos que já usam arquivos dele continuam com eles.`)) return;
    await api.excluirPack(p.id);
    pk.aberto = null;
    await atualizarPacks();
    renderPacks();
  };
  atualizarPacks();
}

// ---------- criação do projeto ----------

// estado.packs nulo quer dizer "todos": um pack novo já entra marcado.
const packsDoWizard = () => estado.packs ?? pk.lista.map((p) => p.id);

function renderPacksWizard() {
  const box = $('#wizard-packs');
  if (!box) return;
  $('#bloco-packs').hidden = !pk.lista.length;
  const marcados = packsDoWizard();
  box.replaceChildren(
    ...pk.lista.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-pack' + (marcados.includes(p.id) ? ' ativo' : '');
      b.textContent = p.nome;
      b.title = contagemPack(p);
      b.onclick = () => {
        const atuais = packsDoWizard();
        estado.packs = atuais.includes(p.id) ? atuais.filter((x) => x !== p.id) : [...atuais, p.id];
        renderPacksWizard();
      };
      return b;
    }),
  );
}

// ---------- dentro do editor ----------

async function abrirPacksDoProjeto(idTimeline, aoMudar) {
  await atualizarPacks();
  let projeto = await api.projeto(idTimeline);
  const escolhidos = new Set();
  let aberto = pk.lista.find((p) => projeto.packs?.includes(p.id))?.id ?? pk.lista[0]?.id ?? null;
  let busca = '';
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg-packs';
  dlg.innerHTML = `
    <div class="dlg-packs-cab"><h2>Packs de edição</h2><button type="button" class="dlg-fechar">×</button></div>
    <div class="dlg-packs-corpo">
      <div class="dlg-packs-lista"><small class="sub">Marcados: o Claude pode usar neste projeto.</small><ul></ul></div>
      <div class="dlg-packs-itens">
        <input type="search" placeholder="Buscar arquivo" />
        <ul></ul>
      </div>
    </div>
    <div class="linha-botoes dlg-packs-rodape"><span class="sub dlg-packs-info"></span><button type="button" class="primario" disabled>Adicionar ao projeto</button></div>`;
  const listaPacks = dlg.querySelector('.dlg-packs-lista ul');
  const listaItens = dlg.querySelector('.dlg-packs-itens ul');
  const botao = dlg.querySelector('.dlg-packs-rodape button');
  const info = dlg.querySelector('.dlg-packs-info');
  const chave = (p, i) => `${p.id}\n${i.arquivo}`;
  const atualizarBotao = () => {
    botao.disabled = !escolhidos.size;
    botao.textContent = escolhidos.size ? `Adicionar ao projeto (${escolhidos.size})` : 'Adicionar ao projeto';
  };
  const desenhar = () => {
    listaPacks.replaceChildren(
      ...pk.lista.map((p) => {
        const li = document.createElement('li');
        li.className = p.id === aberto ? 'ativo' : '';
        li.innerHTML = '<input type="checkbox" title="O Claude pode usar este pack neste projeto" /><span></span>';
        const c = li.querySelector('input');
        c.checked = !!projeto.packs?.includes(p.id);
        c.onclick = (ev) => ev.stopPropagation();
        c.onchange = async () => {
          const atuais = new Set(projeto.packs ?? []);
          if (c.checked) atuais.add(p.id);
          else atuais.delete(p.id);
          projeto.packs = await api.packsDoProjeto({ id: idTimeline, packs: [...atuais] });
        };
        li.querySelector('span').textContent = `${p.nome} (${p.itens.length})`;
        li.onclick = () => {
          aberto = p.id;
          desenhar();
        };
        return li;
      }),
    );
    const p = pk.lista.find((x) => x.id === aberto);
    const termo = sem(busca);
    const ligados = new Set((projeto.materiais ?? []).filter((m) => m.pack === p?.id).map((m) => m.arquivoPack));
    listaItens.replaceChildren(
      ...(p?.itens ?? []).filter((i) => !termo || sem(`${i.nome} ${i.pasta}`).includes(termo)).slice(0, 400).map((i) => {
        const li = document.createElement('li');
        li.innerHTML = '<label class="check"><input type="checkbox" /><span></span></label><small></small>';
        const c = li.querySelector('input');
        const ja = ligados.has(i.arquivo);
        c.checked = ja || escolhidos.has(chave(p, i));
        c.disabled = ja;
        c.onchange = () => {
          if (c.checked) escolhidos.add(chave(p, i));
          else escolhidos.delete(chave(p, i));
          atualizarBotao();
        };
        li.querySelector('span').textContent = i.nome;
        li.querySelector('small').textContent = ja ? 'já no projeto' : [i.pasta, duracaoPack(i)].filter(Boolean).join(' · ');
        return li;
      }),
    );
  };
  dlg.querySelector('input[type="search"]').oninput = (e) => {
    busca = e.target.value;
    desenhar();
  };
  dlg.querySelector('.dlg-fechar').onclick = () => dlg.close();
  botao.onclick = async () => {
    botao.disabled = true;
    const porPack = new Map();
    for (const k of escolhidos) {
      const [packId, arquivo] = k.split('\n');
      porPack.set(packId, [...(porPack.get(packId) ?? []), arquivo]);
    }
    for (const [pack, arquivos] of porPack) await api.usarDoPack({ id: idTimeline, pack, arquivos });
    info.textContent = `${escolhidos.size} ligados ao projeto, sem ocupar espaço.`;
    escolhidos.clear();
    atualizarBotao();
    projeto = await api.projeto(idTimeline);
    desenhar();
    await aoMudar?.();
  };
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  if (!pk.lista.length) info.textContent = 'Crie um pack na aba Packs, no início do app.';
  desenhar();
  dlg.showModal();
}
