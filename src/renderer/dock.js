// Painéis encaixáveis do editor, como no Filmcraft: cada painel tem uma aba; arrastar a aba para o meio de outro
// painel junta os dois em abas, para uma borda divide o espaço. Os divisores entre painéis mudam o tamanho.
// O layout fica guardado neste computador; "Layout padrão" volta ao original.
//
// Layout: { t: 'split', dir: 'row' | 'col', filhos: [nó], tamanhos: [número] } ou { t: 'grupo', paineis: [id], ativo }.

const Dock = (() => {
  const CHAVE = 'dockLayout.v1';
  const PAINEIS = {
    materiais: { titulo: 'Materiais', el: () => document.querySelector('#painel-materiais') },
    propriedades: { titulo: 'Propriedades', el: () => document.querySelector('#painel-propriedades') },
    origem: { titulo: 'Origem', el: () => document.querySelector('#painel-origem') },
    previa: { titulo: 'Prévia', el: () => document.querySelector('#painel-previa') },
    claude: { titulo: 'Claude', el: () => document.querySelector('#painel-claude') },
    timeline: { titulo: 'Timeline', el: () => document.querySelector('#tl') },
  };
  // Materiais, propriedades e timeline só existem nos projetos com timeline; a origem só quando há algo aberto nela.
  const disponivel = (id) => {
    if (id === 'materiais' || id === 'propriedades' || id === 'timeline') return !document.querySelector('#tl').hidden;
    if (id === 'origem') {
      const f = document.querySelector('#fonte');
      return !!f && !f.hidden;
    }
    return true;
  };

  const grupo = (paineis, ativo = paineis[0]) => ({ t: 'grupo', paineis, ativo });
  const split = (dir, filhos, tamanhos) => ({ t: 'split', dir, filhos, tamanhos });
  const padrao = () =>
    split('row', [
      split('col', [split('row', [grupo(['materiais', 'propriedades']), grupo(['origem']), grupo(['previa'])], [22, 30, 48]), grupo(['timeline'])], [62, 38]),
      grupo(['claude']),
    ], [76, 24]);

  let raiz = null;
  const raizEl = () => document.querySelector('#dock-raiz');

  // ---------- guardar ----------

  function idsDe(no, lista = []) {
    if (no.t === 'grupo') lista.push(...no.paineis);
    else no.filhos.forEach((f) => idsDe(f, lista));
    return lista;
  }

  function valido(no) {
    if (!no || typeof no !== 'object') return false;
    if (no.t === 'grupo') return Array.isArray(no.paineis) && no.paineis.length > 0;
    return (
      no.t === 'split' && ['row', 'col'].includes(no.dir) && Array.isArray(no.filhos) && no.filhos.length > 1 &&
      Array.isArray(no.tamanhos) && no.tamanhos.length === no.filhos.length && no.filhos.every(valido)
    );
  }

  function carregar() {
    try {
      const l = JSON.parse(localStorage.getItem(CHAVE));
      const ids = valido(l) ? idsDe(l) : [];
      const todos = Object.keys(PAINEIS);
      if (ids.length === todos.length && todos.every((id) => ids.includes(id))) return l;
    } catch {}
    return padrao();
  }

  function guardar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(raiz));
    } catch {}
  }

  // ---------- árvore ----------

  function paiDe(alvo, no = raiz, pai = null) {
    if (no === alvo) return pai;
    if (no.t !== 'split') return undefined;
    for (const f of no.filhos) {
      const r = paiDe(alvo, f, no);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  function grupoDe(id, no = raiz) {
    if (no.t === 'grupo') return no.paineis.includes(id) ? no : null;
    for (const f of no.filhos) {
      const r = grupoDe(id, f);
      if (r) return r;
    }
    return null;
  }

  function trocar(velho, novo) {
    const pai = paiDe(velho);
    if (!pai) raiz = novo;
    else pai.filhos[pai.filhos.indexOf(velho)] = novo;
  }

  // Tira o painel do grupo; grupo vazio sai do split, e split com um filho só vira esse filho.
  function remover(id) {
    const g = grupoDe(id);
    if (!g) return;
    g.paineis.splice(g.paineis.indexOf(id), 1);
    if (g.ativo === id) g.ativo = g.paineis[0];
    if (g.paineis.length) return;
    const pai = paiDe(g);
    if (!pai) return;
    const n = pai.filhos.indexOf(g);
    const sobra = pai.tamanhos[n];
    pai.filhos.splice(n, 1);
    pai.tamanhos.splice(n, 1);
    pai.tamanhos[Math.min(n, pai.tamanhos.length - 1)] += sobra;
    if (pai.filhos.length === 1) trocar(pai, pai.filhos[0]);
  }

  function encaixar(id, alvo, zona) {
    if (zona === 'centro') {
      if (alvo.paineis.includes(id)) return;
      remover(id);
      alvo.paineis.push(id);
      alvo.ativo = id;
      return;
    }
    if (alvo.paineis.length === 1 && alvo.paineis[0] === id) return;
    remover(id);
    const novo = grupo([id]);
    const dir = zona === 'esquerda' || zona === 'direita' ? 'row' : 'col';
    const antes = zona === 'esquerda' || zona === 'cima';
    const pai = paiDe(alvo);
    if (pai && pai.dir === dir) {
      const n = pai.filhos.indexOf(alvo);
      const metade = pai.tamanhos[n] / 2;
      pai.tamanhos[n] = metade;
      pai.filhos.splice(antes ? n : n + 1, 0, novo);
      pai.tamanhos.splice(antes ? n : n + 1, 0, metade);
    } else {
      trocar(alvo, split(dir, antes ? [novo, alvo] : [alvo, novo], [50, 50]));
    }
  }

  // ---------- desenho ----------

  function desenhar() {
    const box = raizEl();
    if (!box) return;
    // Os painéis saem antes de limpar: são os elementos de verdade do app, com tudo o que já está ligado neles.
    const deposito = document.querySelector('#dock-deposito');
    for (const p of Object.values(PAINEIS)) {
      const el = p.el();
      if (el && el.parentElement !== deposito) deposito.append(el);
    }
    box.replaceChildren(desenharNo(raiz));
    aplicarVisibilidade();
  }

  function desenharNo(no) {
    if (no.t === 'grupo') return desenharGrupo(no);
    const el = document.createElement('div');
    el.className = `dock-split ${no.dir}`;
    no.filhos.forEach((f, n) => {
      if (n > 0) el.append(divisor(no, n - 1));
      const filho = document.createElement('div');
      filho.className = 'dock-filho';
      filho.style.flexGrow = no.tamanhos[n];
      filho.append(desenharNo(f));
      filho.no = f;
      el.append(filho);
    });
    el.no = no;
    return el;
  }

  function desenharGrupo(g) {
    const el = document.createElement('div');
    el.className = 'dock-grupo';
    el.no = g;
    const abas = document.createElement('div');
    abas.className = 'dock-abas';
    const corpo = document.createElement('div');
    corpo.className = 'dock-corpo';
    for (const id of g.paineis) {
      const aba = document.createElement('button');
      aba.type = 'button';
      aba.className = 'dock-aba';
      aba.dataset.painel = id;
      aba.textContent = PAINEIS[id].titulo;
      aba.title = 'Clique para mostrar; arraste para mudar de lugar';
      aba.addEventListener('pointerdown', (e) => iniciarArraste(e, id, g));
      abas.append(aba);
      const lugar = document.createElement('div');
      lugar.className = 'dock-painel';
      lugar.dataset.painel = id;
      const p = PAINEIS[id].el();
      if (p) lugar.append(p);
      corpo.append(lugar);
    }
    el.append(abas, corpo);
    return el;
  }

  // Esconde o que não está disponível agora (painel sem uso neste projeto) e o espaço que ficou vazio por isso.
  function aplicarVisibilidade() {
    const box = raizEl();
    if (!box) return;
    const visivel = (no) => (no.t === 'grupo' ? no.paineis.some(disponivel) : no.filhos.some(visivel));
    box.querySelectorAll('.dock-grupo').forEach((el) => {
      const g = el.no;
      if (!disponivel(g.ativo)) g.ativo = g.paineis.find(disponivel) ?? g.ativo;
      el.querySelectorAll('.dock-aba').forEach((a) => {
        a.hidden = !disponivel(a.dataset.painel);
        a.classList.toggle('ativo', a.dataset.painel === g.ativo);
      });
      el.querySelectorAll('.dock-painel').forEach((p) => p.classList.toggle('ativo', p.dataset.painel === g.ativo));
    });
    box.querySelectorAll('.dock-split').forEach((el) => {
      const filhos = [...el.children].filter((c) => c.classList.contains('dock-filho'));
      const vis = filhos.map((c) => visivel(c.no));
      filhos.forEach((c, n) => c.classList.toggle('dock-oculto', !vis[n]));
      // Um divisor só aparece entre dois lados visíveis.
      [...el.children].forEach((c) => {
        if (!c.classList.contains('dock-divisor')) return;
        const n = c.indice;
        // Fica antes de cada filho visível que tem outro visível antes dele (com um filho escondido no meio, o divisor
        // seguinte liga os dois que sobraram).
        c.classList.toggle('dock-oculto', !(vis[n + 1] && vis.slice(0, n + 1).some(Boolean)));
      });
    });
  }

  function divisor(no, n) {
    const d = document.createElement('div');
    d.className = 'dock-divisor';
    d.indice = n;
    d.title = 'Arraste para mudar o tamanho';
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const caixa = d.parentElement;
      const filhos = [...caixa.children].filter((c) => c.classList.contains('dock-filho'));
      // O lado de antes é o filho visível mais próximo: o de índice n pode estar escondido.
      let ia = n;
      while (ia > 0 && filhos[ia].classList.contains('dock-oculto')) ia--;
      const ib = n + 1;
      const a = filhos[ia];
      const b = filhos[ib];
      const horizontal = no.dir === 'row';
      const total = horizontal ? caixa.clientWidth : caixa.clientHeight;
      const soma = no.filhos.reduce((s, f, i) => s + (filhos[i].classList.contains('dock-oculto') ? 0 : no.tamanhos[i]), 0);
      const p0 = horizontal ? e.clientX : e.clientY;
      const ta = no.tamanhos[ia];
      const tb = no.tamanhos[ib];
      const minimo = (soma * 80) / Math.max(1, total);
      document.body.classList.add(horizontal ? 'redimensionando' : 'redimensionando-v');
      const mover = (ev) => {
        const delta = (((horizontal ? ev.clientX : ev.clientY) - p0) / Math.max(1, total)) * soma;
        const na = Math.max(minimo, Math.min(ta + tb - minimo, ta + delta));
        no.tamanhos[ia] = na;
        no.tamanhos[ib] = ta + tb - na;
        a.style.flexGrow = no.tamanhos[ia];
        b.style.flexGrow = no.tamanhos[ib];
      };
      const soltar = () => {
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
        document.body.classList.remove('redimensionando', 'redimensionando-v');
        guardar();
        window.dispatchEvent(new Event('resize'));
      };
      window.addEventListener('pointermove', mover);
      window.addEventListener('pointerup', soltar);
    });
    return d;
  }

  // ---------- arrastar abas ----------

  function zonaEm(r, x, y) {
    const fx = (x - r.left) / r.width;
    const fy = (y - r.top) / r.height;
    const borda = Math.min(fx, 1 - fx, fy, 1 - fy);
    if (borda > 0.25) return 'centro';
    if (borda === fx) return 'esquerda';
    if (borda === 1 - fx) return 'direita';
    return borda === fy ? 'cima' : 'baixo';
  }

  function retanguloDaZona(r, zona) {
    if (zona === 'esquerda') return { left: r.left, top: r.top, width: r.width / 2, height: r.height };
    if (zona === 'direita') return { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height };
    if (zona === 'cima') return { left: r.left, top: r.top, width: r.width, height: r.height / 2 };
    if (zona === 'baixo') return { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 };
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function iniciarArraste(e, id, g) {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let arrastando = false;
    let alvo = null;
    let sombra = null;
    let etiqueta = null;
    const mover = (ev) => {
      if (!arrastando) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        arrastando = true;
        sombra = document.createElement('div');
        sombra.className = 'dock-sombra';
        etiqueta = document.createElement('div');
        etiqueta.className = 'dock-etiqueta';
        etiqueta.textContent = PAINEIS[id].titulo;
        document.body.append(sombra, etiqueta);
        document.body.classList.add('dock-arrastando');
      }
      etiqueta.style.left = ev.clientX + 12 + 'px';
      etiqueta.style.top = ev.clientY + 8 + 'px';
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.dock-grupo');
      alvo = null;
      sombra.hidden = true;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const zona = zonaEm(r, ev.clientX, ev.clientY);
      alvo = { no: el.no, zona };
      Object.assign(sombra.style, Object.fromEntries(Object.entries(retanguloDaZona(r, zona)).map(([k, v]) => [k, v + 'px'])));
      sombra.hidden = false;
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      sombra?.remove();
      etiqueta?.remove();
      document.body.classList.remove('dock-arrastando');
      if (!arrastando) {
        g.ativo = id;
        aplicarVisibilidade();
        guardar();
        window.dispatchEvent(new Event('resize'));
        return;
      }
      if (!alvo) return;
      encaixar(id, alvo.no, alvo.zona);
      guardar();
      desenhar();
      window.dispatchEvent(new Event('resize'));
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  // ---------- uso pelo app ----------

  function iniciar() {
    raiz = carregar();
    desenhar();
    // Painéis que aparecem e somem (timeline, origem) reajustam o espaço sozinhos.
    const obs = new MutationObserver(() => aplicarVisibilidade());
    obs.observe(document.querySelector('#tl'), { attributes: true, attributeFilter: ['hidden'] });
    obs.observe(document.querySelector('#painel-origem'), { attributes: true, subtree: true, childList: true, attributeFilter: ['hidden'] });
  }

  // Traz o painel para a frente do grupo dele.
  function mostrar(id) {
    const g = raiz && grupoDe(id);
    if (!g || g.ativo === id) return;
    g.ativo = id;
    aplicarVisibilidade();
  }

  function restaurar() {
    raiz = padrao();
    guardar();
    desenhar();
    window.dispatchEvent(new Event('resize'));
  }

  return { iniciar, mostrar, restaurar, atualizar: aplicarVisibilidade };
})();

Dock.iniciar();
document.querySelector("#btn-layout-padrao").onclick = () => Dock.restaurar();
