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
      if (s.sel === id && s.selecao.size <= 1) return;
      s.sel = id;
      s.selecao = new Set(id ? [id] : []);
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
    for (const c of areaTransferencia.itens) {
      // Mídia de outro projeto não está nos materiais deste: o item não teria o que mostrar.
      if (c.item.arquivo && !materialDe(c.item.arquivo)) {
        semMidia++;
        continue;
      }
      const tr = trilhaParaColar(c);
      if (!tr) continue;
      const novo = clonar(c.item);
      novo.id = novoId();
      novo.inicio = arredondar(t0 + c.desloc);
      plano.push([tr, novo]);
    }
    if (!plano.length) return avisar(semMidia ? 'A mídia copiada não existe neste projeto: importe os arquivos nele primeiro.' : 'Nada para colar aqui.');
    alterar(() => plano.forEach(([tr, novo]) => tr.itens.push(novo)));
    selecionarVarios(plano.map(([, novo]) => novo.id));
    avisar(`${plano.length} ${plano.length > 1 ? 'itens colados' : 'item colado'} no cursor.` + (semMidia ? ` ${semMidia} ficou de fora: a mídia não existe neste projeto.` : ''));
  }
