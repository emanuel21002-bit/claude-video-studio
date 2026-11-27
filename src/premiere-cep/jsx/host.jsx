// Executor do MovAi no Premiere (ExtendScript, ES3: sem let/const, setas nem template strings).
// O painel chama movai_executar('{"nome":..., "args":...}') e recebe '{"ok":true,"resultado":"..."}'.
// Tempos em segundos; trilhas numeradas a partir de 1 (V1, A1); clipes como "V1.0" (trilha + ordem na trilha).

var TICKS = 254016000000;

function mv_texto(s) {
  s = String(s);
  var r = '"';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    var n = s.charCodeAt(i);
    if (c === '"') r += '\\"';
    else if (c === '\\') r += '\\\\';
    else if (c === '\n') r += '\\n';
    else if (c === '\r') r += '\\r';
    else if (c === '\t') r += '\\t';
    else if (n < 32) r += ' ';
    else r += c;
  }
  return r + '"';
}

function mv_tempo(s) {
  var t = new Time();
  t.seconds = Math.max(0, Number(s) || 0);
  return t;
}

function mv_n(x) {
  return Math.round(x * 1000) / 1000;
}

function mv_seq() {
  if (!app.project) throw new Error('Nenhum projeto aberto no Premiere.');
  var seq = app.project.activeSequence;
  if (!seq) throw new Error('Nenhuma sequência aberta. Abra uma sequência na timeline.');
  return seq;
}

function mv_quadro(seq) {
  return Number(seq.timebase) / TICKS; // duração de um quadro em segundos
}

// Timecode HH:MM:SS:FF para o QE (razor e transições).
function mv_tc(seq, s) {
  var q = mv_quadro(seq);
  var fps = Math.round(1 / q);
  var f = Math.round(s / q);
  var ff = f % fps;
  var tot = Math.floor(f / fps);
  var p = function (x) {
    return (x < 10 ? '0' : '') + x;
  };
  return p(Math.floor(tot / 3600)) + ':' + p(Math.floor(tot / 60) % 60) + ':' + p(tot % 60) + ':' + p(ff);
}

function mv_trilha(seq, tipo, indice) {
  var lista = tipo === 'V' ? seq.videoTracks : seq.audioTracks;
  if (indice < 0 || indice >= lista.numTracks) throw new Error('A trilha ' + tipo + (indice + 1) + ' não existe.');
  return lista[indice];
}

function mv_clipe(seq, id) {
  var m = /^([VA])(\d+)\.(\d+)$/.exec(String(id).toUpperCase());
  if (!m) throw new Error('Id de clipe inválido: ' + id);
  var tr = mv_trilha(seq, m[1], Number(m[2]) - 1);
  var k = Number(m[3]);
  if (k >= tr.clips.numItems) throw new Error('O clipe ' + id + ' não existe (leia a sequência de novo: os ids mudam depois de editar).');
  return { id: String(id).toUpperCase(), tipo: m[1], trilha: Number(m[2]) - 1, k: k, item: tr.clips[k], track: tr };
}

function mv_caminho(item) {
  try {
    return item.projectItem ? item.projectItem.getMediaPath() : '';
  } catch (e) {
    return '';
  }
}

function mv_norm(p) {
  return String(p || '').replace(/\//g, '\\').toLowerCase();
}

function mv_acharItem(pasta, alvo) {
  for (var i = 0; i < pasta.children.numItems; i++) {
    var it = pasta.children[i];
    if (it.type === ProjectItemType.BIN) {
      var r = mv_acharItem(it, alvo);
      if (r) return r;
    } else {
      try {
        if (mv_norm(it.getMediaPath()) === alvo) return it;
      } catch (e) {}
    }
  }
  return null;
}

function mv_importar(arquivo) {
  var alvo = mv_norm(arquivo);
  var it = mv_acharItem(app.project.rootItem, alvo);
  if (it) return it;
  if (!new File(arquivo).exists) throw new Error('Não achei o arquivo ' + arquivo);
  app.project.importFiles([arquivo], true, app.project.getInsertionBin(), false);
  it = mv_acharItem(app.project.rootItem, alvo);
  if (!it) throw new Error('Importei ' + arquivo + ', mas não achei no projeto.');
  return it;
}

var MV_AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|aif|aiff|wma|opus)$/i;

// Põe um pedaço [entrada, saida] da mídia na sequência: marca entrada/saída no item do projeto, coloca e limpa.
function mv_colocar(seq, pi, a) {
  var soAudio = a.soAudio || MV_AUDIO.test(pi.getMediaPath());
  var recorte = a.entrada != null || a.saida != null;
  if (a.entrada != null) pi.setInPoint(Number(a.entrada), 4);
  if (a.saida != null) pi.setOutPoint(Number(a.saida), 4);
  try {
    var tr = soAudio ? mv_trilha(seq, 'A', (a.trilhaAudio || 1) - 1) : mv_trilha(seq, 'V', (a.trilhaVideo || 1) - 1);
    if (a.modo === 'inserir') tr.insertClip(pi, Number(a.inicio) || 0);
    else tr.overwriteClip(pi, Number(a.inicio) || 0);
  } finally {
    if (recorte) {
      pi.clearInPoint();
      pi.clearOutPoint();
    }
  }
}

function mv_qeTrilha(seq, tipo, indice) {
  app.enableQE();
  var qs = qe.project.getActiveSequence();
  return tipo === 'V' ? qs.getVideoTrackAt(indice) : qs.getAudioTrackAt(indice);
}

// O item do QE que corresponde ao clipe (o QE conta os vazios também).
function mv_qeItem(seq, c) {
  var qt = mv_qeTrilha(seq, c.tipo, c.trilha);
  var alvo = c.item.start.seconds;
  for (var i = 0; i < qt.numItems; i++) {
    var q = qt.getItemAt(i);
    if (q && q.type !== 'Empty' && Math.abs(Number(q.start.secs) - alvo) < mv_quadro(seq) / 2) return q;
  }
  throw new Error('Não achei ' + c.id + ' no QE do Premiere.');
}

function mv_razor(seq, tipo, indice, s) {
  mv_qeTrilha(seq, tipo, indice).razor(mv_tc(seq, s));
}

// O clipe que vai de `de` a `ate` (com folga de meio quadro) numa trilha.
function mv_clipeEntre(seq, tipo, indice, de, ate) {
  var tr = mv_trilha(seq, tipo, indice);
  var meio = mv_quadro(seq) / 2;
  for (var i = 0; i < tr.clips.numItems; i++) {
    var it = tr.clips[i];
    if (Math.abs(it.start.seconds - de) < meio && Math.abs(it.end.seconds - ate) < meio) return it;
  }
  return null;
}

// Os clipes ligados (mesma mídia, mesmo início e fim) nas outras trilhas: cortar e aparar levam eles junto.
function mv_ligados(seq, c) {
  var r = [{ tipo: c.tipo, trilha: c.trilha }];
  var cam = mv_caminho(c.item);
  if (!cam) return r;
  var meio = mv_quadro(seq) / 2;
  var outro = c.tipo === 'V' ? 'A' : 'V';
  var lista = outro === 'V' ? seq.videoTracks : seq.audioTracks;
  for (var t = 0; t < lista.numTracks; t++) {
    for (var i = 0; i < lista[t].clips.numItems; i++) {
      var it = lista[t].clips[i];
      if (Math.abs(it.start.seconds - c.item.start.seconds) < meio && Math.abs(it.end.seconds - c.item.end.seconds) < meio && mv_caminho(it) === cam) r.push({ tipo: outro, trilha: t });
    }
  }
  return r;
}

function mv_parametro(comp, nomes, indice) {
  for (var i = 0; i < comp.properties.numItems; i++) {
    if (nomes.test(String(comp.properties[i].displayName))) return comp.properties[i];
  }
  return indice < comp.properties.numItems ? comp.properties[indice] : null;
}

function mv_componente(item, matchName) {
  for (var i = 0; i < item.components.numItems; i++) {
    if (item.components[i].matchName === matchName) return item.components[i];
  }
  return null;
}

var MV = {};

MV.ler_sequencia = function () {
  var seq = mv_seq();
  var q = mv_quadro(seq);
  var linhas = [
    'Projeto: ' + app.project.name + ' | Sequência: ' + seq.name + ' | ' + seq.frameSizeHorizontal + 'x' + seq.frameSizeVertical + ' | ' + mv_n(1 / q) + ' fps | fim ' + mv_n(Number(seq.end) / TICKS) + ' s | agulha ' + mv_n(seq.getPlayerPosition().seconds) + ' s',
    'Trilhas: ' + seq.videoTracks.numTracks + ' de vídeo, ' + seq.audioTracks.numTracks + ' de áudio',
    'id | início–fim na sequência | entrada–saída na mídia | nome | arquivo',
  ];
  var tipos = [['V', seq.videoTracks], ['A', seq.audioTracks]];
  var algum = false;
  for (var g = 0; g < 2; g++) {
    var lista = tipos[g][1];
    for (var t = 0; t < lista.numTracks; t++) {
      for (var i = 0; i < lista[t].clips.numItems; i++) {
        var it = lista[t].clips[i];
        algum = true;
        var des = false;
        try {
          des = it.disabled;
        } catch (e) {}
        linhas.push(tipos[g][0] + (t + 1) + '.' + i + ' | ' + mv_n(it.start.seconds) + '–' + mv_n(it.end.seconds) + ' | mídia ' + mv_n(it.inPoint.seconds) + '–' + mv_n(it.outPoint.seconds) + ' | ' + it.name + (des ? ' | DESATIVADO' : '') + ' | ' + mv_caminho(it));
      }
    }
  }
  if (!algum) linhas.push('(sequência vazia)');
  if (seq.markers.numMarkers) {
    linhas.push('Marcadores:');
    var m = seq.markers.getFirstMarker();
    while (m) {
      linhas.push(mv_n(m.start.seconds) + ' s | ' + m.name + (m.comments ? ' | ' + m.comments : ''));
      m = seq.markers.getNextMarker(m);
    }
  }
  return linhas.join('\n');
};

MV.importar = function (a) {
  var r = [];
  for (var i = 0; i < a.arquivos.length; i++) r.push(mv_importar(a.arquivos[i]).name + ' <- ' + a.arquivos[i]);
  return r.join('\n');
};

MV.colocar_clipe = function (a) {
  var seq = mv_seq();
  var pi = mv_importar(a.arquivo);
  mv_colocar(seq, pi, a);
  return pi.name + ' em ' + mv_n(a.inicio) + ' s. Leia a sequência para ver os ids novos.';
};

MV.editar_clipes = function (a) {
  var seq = mv_seq();
  var ops = a.operacoes;
  // Resolve todos os ids antes de mexer: as posições mudam com as edições.
  var alvos = [];
  for (var i = 0; i < ops.length; i++) alvos.push(mv_clipe(seq, ops[i].clipe));
  var feitos = [];
  for (i = 0; i < ops.length; i++) {
    var o = ops[i];
    var c = alvos[i];
    var it = c.item;
    var ini = it.start.seconds;
    var fim = it.end.seconds;
    var meio = mv_quadro(seq) / 2;
    if (o.op === 'mover') it.move(mv_tempo(0 + (Number(o.inicio) - ini)));
    else if (o.op === 'cortar') {
      if (!(o.em > ini + meio && o.em < fim - meio)) throw new Error(c.id + ' vai de ' + mv_n(ini) + ' a ' + mv_n(fim) + ' s: não dá para cortar em ' + o.em + '.');
      var lig = mv_ligados(seq, c);
      for (var j = 0; j < lig.length; j++) mv_razor(seq, lig[j].tipo, lig[j].trilha, Number(o.em));
    } else if (o.op === 'aparar') {
      // Para dentro: corta e tira a sobra (vale para os clipes ligados também). Para fora: estica a borda.
      var ligA = mv_ligados(seq, c);
      if (o.inicio != null) {
        var ni = Number(o.inicio);
        if (ni > ini + meio && ni < fim - meio) {
          for (j = 0; j < ligA.length; j++) {
            mv_razor(seq, ligA[j].tipo, ligA[j].trilha, ni);
            var sobra = mv_clipeEntre(seq, ligA[j].tipo, ligA[j].trilha, ini, ni);
            if (sobra) sobra.remove(false, true);
          }
          ini = ni;
        } else if (ni < ini - meio) it.start = mv_tempo(ni);
      }
      if (o.fim != null) {
        var nf = Number(o.fim);
        if (nf > ini + meio && nf < fim - meio) {
          for (j = 0; j < ligA.length; j++) {
            mv_razor(seq, ligA[j].tipo, ligA[j].trilha, nf);
            var resto = mv_clipeEntre(seq, ligA[j].tipo, ligA[j].trilha, nf, fim);
            if (resto) resto.remove(false, true);
          }
        } else if (nf > fim + meio) {
          var atual = mv_clipeEntre(seq, c.tipo, c.trilha, ini, fim);
          if (atual) atual.end = mv_tempo(nf);
        }
      }
    } else if (o.op === 'remover') it.remove(!!o.ripple, true);
    else if (o.op === 'desativar') it.disabled = o.desativado !== false;
    else if (o.op === 'renomear') it.name = String(o.nome);
    else if (o.op === 'duplicar') {
      var pi = it.projectItem;
      var tr = o.trilhas || [c.tipo === 'V' ? 1 : 0, c.tipo === 'A' ? 1 : 0];
      mv_colocar(seq, pi, { inicio: ini + Number(o.deslocamento || 0), trilhaVideo: c.trilha + 1 + tr[0], trilhaAudio: c.trilha + 1 + tr[1], entrada: it.inPoint.seconds, saida: it.outPoint.seconds, soAudio: c.tipo === 'A' });
    } else throw new Error('Operação desconhecida: ' + o.op);
    feitos.push(o.op + ' ' + c.id);
  }
  return 'Feito: ' + feitos.join(', ') + '. Os ids mudaram: leia a sequência de novo antes de editar mais.';
};

MV.movimento = function (a) {
  var seq = mv_seq();
  var c = mv_clipe(seq, a.clipe);
  if (c.tipo !== 'V') throw new Error('Movimento só vale para clipes de vídeo.');
  var it = c.item;
  var mov = mv_componente(it, 'AE.ADBE Motion');
  var opa = mv_componente(it, 'AE.ADBE Opacity');
  var W = seq.frameSizeHorizontal;
  var H = seq.frameSizeVertical;
  var pedidos = [];
  if (a.escala != null) pedidos.push([mov && mv_parametro(mov, /^(escala|scale)$/i, 1), a.escala, false]);
  if (a.rotacao != null) pedidos.push([mov && mv_parametro(mov, /^(rotação|rotacao|rotation)$/i, 4), a.rotacao, false]);
  if (a.posicao != null) pedidos.push([mov && mv_parametro(mov, /^(posição|posicao|position)$/i, 0), a.posicao, true]);
  if (a.opacidade != null) pedidos.push([opa && mv_parametro(opa, /^(opacidade|opacity)$/i, 0), a.opacidade, false]);
  // Posição no Premiere é uma fração do quadro (0 a 1).
  var conv = function (v, ponto) {
    return ponto ? [Number(v[0]) / W, Number(v[1]) / H] : Number(v);
  };
  // Keyframe no tempo da mídia do clipe: entrada + o quanto passou desde o início dele na sequência.
  var local = function (t) {
    return it.inPoint.seconds + (Number(t) - it.start.seconds);
  };
  for (var i = 0; i < pedidos.length; i++) {
    var p = pedidos[i][0];
    var v = pedidos[i][1];
    var ponto = pedidos[i][2];
    if (!p) throw new Error('Não achei esse parâmetro no clipe ' + c.id + '.');
    var chaves = v instanceof Array && v.length && typeof v[0] === 'object' && !(v[0] instanceof Array);
    if (!chaves) {
      if (p.isTimeVarying()) p.setTimeVarying(false);
      p.setValue(conv(v, ponto), true);
    } else {
      p.setTimeVarying(true);
      for (var k = 0; k < v.length; k++) {
        var tl = local(v[k].t);
        p.addKey(tl);
        p.setValueAtKey(tl, conv(v[k].v, ponto), true);
      }
    }
  }
  return 'Movimento aplicado em ' + c.id + '.';
};

function mv_filtrar(lista, busca) {
  var q = String(busca || '').toLowerCase();
  var r = [];
  for (var i = 0; i < lista.length; i++) if (!q || String(lista[i]).toLowerCase().indexOf(q) >= 0) r.push(lista[i]);
  return r.join('\n');
}

MV.listar_transicoes = function (a) {
  app.enableQE();
  return mv_filtrar(qe.project.getVideoTransitionList(), a.busca);
};

MV.listar_efeitos = function (a) {
  app.enableQE();
  return mv_filtrar(qe.project.getVideoEffectList(), a.busca);
};

MV.aplicar_transicao = function (a) {
  var seq = mv_seq();
  app.enableQE();
  var tr = qe.project.getVideoTransitionByName(a.nome);
  if (!tr) throw new Error('Não achei a transição "' + a.nome + '". Use listar_transicoes.');
  var feitos = [];
  for (var i = 0; i < a.clipes.length; i++) {
    var c = mv_clipe(seq, a.clipes[i]);
    var q = mv_qeItem(seq, c);
    q.addTransition(tr, a.lado === 'inicio', mv_tc(seq, a.duracao || 0.5), '00:00:00:00', 0.5, !!a.umLado, true);
    feitos.push(c.id);
  }
  return 'Transição "' + a.nome + '" em ' + feitos.join(', ') + '.';
};

MV.aplicar_efeito = function (a) {
  var seq = mv_seq();
  app.enableQE();
  var ef = qe.project.getVideoEffectByName(a.nome);
  if (!ef) throw new Error('Não achei o efeito "' + a.nome + '". Use listar_efeitos.');
  var feitos = [];
  for (var i = 0; i < a.clipes.length; i++) {
    var c = mv_clipe(seq, a.clipes[i]);
    mv_qeItem(seq, c).addVideoEffect(ef);
    feitos.push(c.id);
  }
  return 'Efeito "' + a.nome + '" em ' + feitos.join(', ') + '.';
};

MV.marcadores = function (a) {
  var seq = mv_seq();
  for (var i = 0; i < a.lista.length; i++) {
    var x = a.lista[i];
    var m = seq.markers.createMarker(Number(x.t));
    m.name = x.nome;
    if (x.comentario) m.comments = x.comentario;
    if (x.duracao) m.end = Number(x.t) + Number(x.duracao);
  }
  return a.lista.length + ' marcador(es).';
};

MV.inserir_mogrt = function (a) {
  var seq = mv_seq();
  var r = seq.importMGT(a.arquivo, String(Math.round(Number(a.inicio) * TICKS)), (a.trilhaVideo || 1) - 1, 0);
  if (!r) throw new Error('O Premiere não inseriu o MOGRT.');
  return 'MOGRT inserido.';
};

// Narração decupada em cortes: cada trecho vira um clipe, alternando duas trilhas para as emendas se sobreporem.
MV.montar_trechos = function (a) {
  var seq = mv_seq();
  var pi = mv_importar(a.arquivo);
  var ta = a.trilhaAudio || 1;
  var duas = ta < seq.audioTracks.numTracks;
  var t = Number(a.inicio) || 0;
  var sob = a.sobreposicoes || [];
  for (var k = 0; k < a.trechos.length; k++) {
    var x = a.trechos[k];
    mv_colocar(seq, pi, { inicio: t, trilhaAudio: duas && k % 2 ? ta + 1 : ta, entrada: x[0], saida: x[1], soAudio: true });
    t += x[1] - x[0] - (sob[k] || 0);
  }
  return duas ? 'Trechos alternando A' + ta + ' e A' + (ta + 1) + ', até ' + mv_n(t) + ' s.' : 'Só há a trilha A' + ta + ': os trechos ficaram nela, sem sobreposição.';
};

// Sequência nova a partir do OTIO do MovAi: importa numa pasta própria, acerta o tamanho do quadro (o Premiere
// ignora o do OTIO), dá o nome, religa o que ficou offline procurando pelo nome nas pastas do projeto e abre.
MV.importar_sequencia = function (a) {
  if (!app.project) throw new Error('Nenhum projeto aberto no Premiere.');
  var antes = {};
  for (var i = 0; i < app.project.sequences.numSequences; i++) antes[app.project.sequences[i].sequenceID] = true;
  var pasta = app.project.rootItem.createBin(a.nome);
  if (!app.project.importFiles([new File(a.otio).fsName], true, pasta, false)) throw new Error('O Premiere não importou o OTIO.');
  var seq = null;
  for (i = 0; i < app.project.sequences.numSequences; i++) {
    if (!antes[app.project.sequences[i].sequenceID]) seq = app.project.sequences[i];
  }
  if (!seq) throw new Error('O Premiere importou, mas não criou a sequência.');
  var c = seq.getSettings();
  c.videoFrameWidth = a.largura;
  c.videoFrameHeight = a.altura;
  seq.setSettings(c);
  seq.name = a.nome;
  // Religa os itens offline (o Premiere às vezes não acha arquivos com acento ou extensão estranha).
  var offline = [];
  var religados = 0;
  var visitar = function (bin) {
    for (var k = 0; k < bin.children.numItems; k++) {
      var it = bin.children[k];
      if (it.type === ProjectItemType.BIN) visitar(it);
      else if (it.type === ProjectItemType.CLIP && it.isOffline()) {
        var nome = String(it.name).replace(/\s*⟦.*$/, '');
        var achou = false;
        for (var p = 0; p < a.pastas.length && !achou; p++) {
          var f = new File(a.pastas[p] + '/' + nome);
          if (f.exists && it.changeMediaPath(f.fsName, true)) achou = true;
        }
        if (achou) religados++;
        else offline.push(nome);
      }
    }
  };
  visitar(pasta);
  app.project.openSequence(seq.sequenceID);
  return 'Sequência "' + a.nome + '" (' + a.largura + 'x' + a.altura + ', ' + seq.videoTracks.numTracks + ' trilhas de vídeo, ' + seq.audioTracks.numTracks + ' de áudio).' + (religados ? ' Religuei ' + religados + ' arquivo(s).' : '') + (offline.length ? ' Ficaram offline: ' + offline.join(', ') + '.' : '');
};

function movai_executar(pedido) {
  try {
    var p = eval('(' + pedido + ')');
    var f = MV[p.nome];
    if (!f) throw new Error('Comando desconhecido: ' + p.nome);
    var r = f(p.args || {});
    return '{"ok":true,"resultado":' + mv_texto(r == null ? 'ok' : r) + '}';
  } catch (e) {
    return '{"ok":false,"erro":' + mv_texto((e && e.message) || e) + (e && e.line ? '' : '') + '}';
  }
}
