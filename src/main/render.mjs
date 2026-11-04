import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';
import { dirs, caminhoProjeto, hyperframesBin, lerProjeto, gravarProjeto, carimbo, tipoDe } from './workspace.mjs';
import { ENCODERS_GPU, encoderGpu, infoVideo, transcodificar } from './transcodificar.mjs';
import { escreverModelo, lerTimeline, validarTimeline } from './timeline.mjs';

// Progresso vem como "123/900" (frames) ou "45%" nas linhas dos CLIs.
function lerProgresso(linha) {
  const pct = linha.match(/(\d{1,3}(?:\.\d+)?)\s?%/);
  if (pct) return Math.min(100, Number(pct[1])) / 100;
  const fr = linha.match(/\b(\d+)\s?\/\s?(\d+)\b/);
  if (fr && Number(fr[2]) > 1) return Math.min(1, Number(fr[1]) / Number(fr[2]));
  return null;
}

// As saídas dos CLIs vêm coloridas, e o erro vai para o chat.
const semCores = (texto) => texto.replace(/\x1b\[[0-9;]*m/g, '');

// Sem nenhuma saída por este tempo, o processo travou: melhor falhar com um aviso do que ficar parado para sempre.
const LIMITE_SEM_SAIDA = 10 * 60 * 1000;

async function etapa(nome, cmd, args, { cwd, env, onEvento, sinal, peso = [0, 1], limiteSemSaida = LIMITE_SEM_SAIDA }) {
  onEvento?.({ etapa: nome, progresso: peso[0] });
  const vigia = new AbortController();
  sinal?.addEventListener('abort', () => vigia.abort());
  let travou = false;
  let timer;
  const rearmar = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      travou = true;
      vigia.abort();
    }, limiteSemSaida);
  };
  rearmar();
  const r = await rodar(cmd, args, {
    cwd,
    env,
    sinal: vigia.signal,
    onLinha: (l) => {
      rearmar();
      onEvento?.({ log: l });
      const p = lerProgresso(l);
      if (p != null) onEvento?.({ etapa: nome, progresso: peso[0] + p * (peso[1] - peso[0]) });
    },
  });
  clearTimeout(timer);
  if (travou) throw new Error(`${nome} travou: nenhuma resposta por ${Math.round(limiteSemSaida / 60000)} minutos.`);
  if (sinal?.aborted) throw new Error('Render cancelado.');
  if (r.codigo !== 0) throw new Error(`${nome} falhou (código ${r.codigo}):\n${semCores(r.cauda)}`);
}

// ---------- pasta pública do render ----------

// Maior escala que o item usa, para a cópia leve não perder nitidez nos zooms.
function escalaMaxima(item) {
  const valores = [item.escala ?? 1, ...(item.keyframes?.escala ?? []).map((k) => k.v)];
  const zoom = Math.max(item.zoom?.de ?? 1, item.zoom?.para ?? 1);
  return Math.max(1, ...valores) * zoom;
}

// Vídeo bem maior que o quadro trava o Chrome na hora de buscar cada quadro (delayRender) e não melhora o resultado.
const CODECS_COM_COPIA = ['h264', 'hevc'];
const PROPORCAO_MINIMA = 0.9;

async function copiaLeve(id, arquivo, t, itens, opts) {
  const dir = caminhoProjeto(id);
  const origem = path.join(dir, 'assets', arquivo);
  const info = await infoVideo(origem);
  if (!info.largura || !CODECS_COM_COPIA.includes(info.codec)) return origem;
  const base = Math.max(t.largura / info.largura, t.altura / info.altura);
  const proporcao = base * Math.max(...itens.map(escalaMaxima));
  if (proporcao >= PROPORCAO_MINIMA) return origem;
  const destino = path.join(dir, '.previa', 'render', `${Math.round(proporcao * 100)}-${arquivo}`);
  if (fs.existsSync(destino) && fs.statSync(destino).mtimeMs >= fs.statSync(origem).mtimeMs) return destino;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const par = (x) => Math.round((x * proporcao) / 2) * 2;
  const encoder = ENCODERS_GPU[await encoderGpu()];
  const parcial = destino + '.tmp.mp4';
  await etapa(opts.nome, carregar().ffmpegPath, [
    '-y', '-hide_banner', '-i', origem, '-map', '0:v:0', '-map', '0:a?', '-vf', `scale=${par(info.largura)}:${par(info.altura)}`,
    ...(encoder ? encoder.args : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17']),
    // Quadro-chave a cada 0,5 s: buscar um quadro no meio do clipe fica bem mais rápido.
    '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', parcial,
  ], opts);
  fs.renameSync(parcial, destino);
  return destino;
}

function ligar(origem, destino) {
  try {
    fs.linkSync(origem, destino);
  } catch {
    fs.copyFileSync(origem, destino);
  }
}

// O Remotion copia a pasta pública inteira a cada render. Em vez de assets/, ele recebe uma pasta só com o que
// o vídeo usa, ligada (sem ocupar disco), com cópias leves no lugar dos clipes grandes.
export async function pastaPublica(id, t, destino, opts = {}) {
  const assets = path.join(caminhoProjeto(id), 'assets');
  const blocos = path.join(caminhoProjeto(id), 'src', 'blocos.tsx');
  const codigo = fs.existsSync(blocos) ? fs.readFileSync(blocos, 'utf8') : '';
  const porArquivo = new Map();
  for (const i of t.trilhas.flatMap((tr) => tr.itens)) {
    if (i.tipo !== 'video') continue;
    if (!porArquivo.has(i.arquivo)) porArquivo.set(i.arquivo, []);
    porArquivo.get(i.arquivo).push(i);
  }
  fs.mkdirSync(destino, { recursive: true });
  const entradas = fs.readdirSync(assets, { withFileTypes: true });
  const clipes = [...porArquivo.keys()];
  let feitos = 0;
  for (const e of entradas) {
    const origem = path.join(assets, e.name);
    if (e.isDirectory()) {
      fs.cpSync(origem, path.join(destino, e.name), { recursive: true });
      continue;
    }
    const itens = porArquivo.get(e.name);
    if (itens) {
      const nome = `Preparando clipes (${++feitos} de ${clipes.length})`;
      ligar(await copiaLeve(id, e.name, t, itens, { ...opts, nome, peso: [0, 0.1] }), path.join(destino, e.name));
      continue;
    }
    // Vídeo fora da timeline fica de fora, a não ser que um bloco o use pelo nome.
    if (tipoDe(e.name) === 'video' && !codigo.includes(e.name)) continue;
    ligar(origem, path.join(destino, e.name));
  }
  return destino;
}

// Recodifica com o encoder da GPU. O contêiner sai pela extensão do destino (.mp4 ou .mov).
// Qualidade -> valor do QP/CQ do encoder da GPU, do CRF do x264 e da nota 0-100 do Filmcraft.
const QUALIDADES = {
  alta: { qp: 19, crf: 16, nota: 90 },
  media: { qp: 24, crf: 21, nota: 70 },
  baixa: { qp: 29, crf: 26, nota: 50 },
};
const qualidadeDe = (q) => QUALIDADES[q] ?? QUALIDADES.alta;

// O encoder tem o QP/CQ fixo em 19 nos args: troca pelo da qualidade pedida.
function argsDoEncoder(encoder, q) {
  const { qp } = qualidadeDe(q);
  const a = [...encoder.args];
  for (const [i, v] of a.entries()) {
    if (['-cq', '-qp_i', '-qp_p'].includes(v)) a[i + 1] = String(qp);
    if (v === '-qp_b') a[i + 1] = String(qp + 2);
  }
  return a;
}

// Escala em relação ao tamanho do projeto: 1 = original. A resolução pedida é o lado menor do quadro.
function escalaDoRender(projeto, resolucao) {
  const lado = Math.min(projeto.largura ?? 0, projeto.altura ?? 0);
  if (!resolucao || !lado) return 1;
  return Math.round((resolucao / lado) * 1000) / 1000;
}

function argsGpu(encoder, entrada, saida, { qualidade, semAudio } = {}) {
  return [
    '-y', '-hide_banner', '-i', entrada,
    ...argsDoEncoder(encoder, qualidade),
    '-pix_fmt', 'yuv420p', ...(semAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', '320k']),
    '-movflags', '+faststart', saida,
  ];
}

// ---------- um render por vez ----------

// Tudo o que muda o resultado. Igual ao do último render, o arquivo já existente serve.
function impressao(id, projeto, modo, formato, ext) {
  const dir = caminhoProjeto(id);
  const h = crypto.createHash('sha1').update(`${modo}|${formato}|${projeto.engine}|${carregar().renderMotor}|${ext.resolucao}|${ext.qualidade}|${ext.semAudio}`);
  const incluir = (pasta) => {
    for (const e of fs.readdirSync(pasta, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const c = path.join(pasta, e.name);
      if (e.isDirectory()) incluir(c);
      else {
        const info = fs.statSync(c);
        h.update(`${e.name}:${info.size}:${info.mtimeMs}`);
      }
    }
  };
  if (projeto.timeline) {
    h.update(fs.readFileSync(path.join(dir, 'timeline.json')));
    for (const n of ['blocos.tsx', 'TimelineVideo.tsx']) {
      const c = path.join(dir, 'src', n);
      if (fs.existsSync(c)) h.update(fs.readFileSync(c));
    }
  } else {
    for (const n of fs.readdirSync(dir)) {
      const c = path.join(dir, n);
      if (['renders', '.previa', 'chat', 'projeto.json'].includes(n)) continue;
      if (fs.statSync(c).isDirectory()) incluir(c);
      else h.update(`${n}:${fs.readFileSync(c).length}:${fs.statSync(c).mtimeMs}`);
    }
  }
  incluir(path.join(dir, 'assets'));
  return h.digest('hex');
}

// Nome de arquivo do vídeo exportado para uma pasta escolhida: o nome do projeto, sem caracteres que o Windows recusa.
const nomeDoVideo = (p) => (p.nome || 'video').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';

function caminhoLivre(pasta, base, formato) {
  let c = path.join(pasta, `${base}.${formato}`);
  for (let i = 2; fs.existsSync(c); i++) c = path.join(pasta, `${base} (${i}).${formato}`);
  return c;
}

let filaRender = Promise.resolve();
const emAndamento = new Map(); // "id|modo|formato" -> promessa

// A GPU de 4 GB não aguenta dois renders juntos: os pedidos entram numa fila única. Pedir de novo o mesmo render
// enquanto ele roda não inicia outro; pedir depois, sem nada mudar, devolve o arquivo pronto.
export function renderizar(id, opcoes = {}, onEvento, sinal) {
  const s = carregar();
  const modo = opcoes.modo ?? s.renderModo;
  const formato = opcoes.formato ?? s.renderFormato;
  const ext = {
    resolucao: opcoes.resolucao ?? s.renderResolucao ?? 0,
    qualidade: opcoes.qualidade ?? s.renderQualidade ?? 'alta',
    semAudio: opcoes.semAudio ?? s.renderSemAudio ?? false,
  };
  const pastaSaida = opcoes.pastaSaida ?? null;
  const chave = `${id}|${modo}|${formato}|${ext.resolucao}|${ext.qualidade}|${ext.semAudio}|${pastaSaida ?? ''}`;
  if (emAndamento.has(chave)) {
    onEvento?.({ etapa: 'Este render já está rodando', progresso: 0 });
    return emAndamento.get(chave);
  }
  const trabalho = filaRender.catch(() => {}).then(() => {
    if (sinal?.aborted) throw new Error('Render cancelado.');
    const projeto = lerProjeto(id);
    if (projeto.timeline) escreverModelo(projeto);
    const marca = impressao(id, projeto, modo, formato, ext);
    const ultimo = projeto.renders[0];
    if (ultimo?.impressao === marca && fs.existsSync(ultimo.arquivo)) {
      onEvento?.({ etapa: 'Nada mudou desde o último render', progresso: 1 });
      let arquivo = ultimo.arquivo;
      // Já existe um render igual: só vai uma cópia para a pasta escolhida.
      if (pastaSaida && path.resolve(path.dirname(arquivo)) !== path.resolve(pastaSaida)) {
        arquivo = caminhoLivre(pastaSaida, nomeDoVideo(projeto), formato);
        fs.mkdirSync(pastaSaida, { recursive: true });
        fs.copyFileSync(ultimo.arquivo, arquivo);
      }
      return { arquivo, preview: ultimo.preview, segundos: 0, reaproveitado: true };
    }
    return executarRender(id, { modo, formato, marca, pastaSaida, ...ext }, onEvento, sinal);
  });
  filaRender = trabalho;
  emAndamento.set(chave, trabalho);
  const limpar = () => emAndamento.delete(chave);
  trabalho.then(limpar, limpar);
  return trabalho;
}

// O CLI só imprime o resultado no fim: em vídeos longos, ficar sem saída não quer dizer que travou.
const LIMITE_FILMCRAFT = 60 * 60 * 1000;

// Composição e decodificação na GPU, em um passo só; textos, legendas e blocos vêm do Remotion como camada.
async function exportarPeloFilmcraft(id, saida, { modo, formato, escala, qualidade, semAudio }, opts) {
  const { prepararProjetoFilmcraft, cli } = await import('./filmcraft.mjs');
  const projetoFc = path.join(path.dirname(opts.env.TEMP), `${path.basename(opts.env.TEMP)}.fcproj`);
  opts.onEvento?.({ etapa: 'Preparando textos e legendas', progresso: 0.02 });
  try {
    await prepararProjetoFilmcraft(id, projetoFc, (l) => opts.onEvento?.({ log: l }));
    if (opts.sinal?.aborted) throw new Error('Render cancelado.');
    await etapa('Exportando pelo Filmcraft', cli(), [
      '--project', projetoFc, 'export', saida, '--format', formato === 'mov' ? 'prores' : 'h264', '--gpu-rendering', modo === 'gpu' ? 'auto' : 'off',
      ...(escala !== 1 ? ['--scale', String(escala)] : []),
      ...(formato === 'mov' ? [] : ['--quality', String(qualidadeDe(qualidade).nota)]),
      ...(semAudio ? ['--no-audio'] : []),
    ], { ...opts, peso: [0.4, 1], limiteSemSaida: LIMITE_FILMCRAFT });
  } finally {
    fs.rmSync(projetoFc, { force: true });
  }
}

async function executarRender(id, { modo, formato, marca, pastaSaida, resolucao, qualidade, semAudio }, onEvento, sinal) {
  const s = carregar();
  const encoder = ENCODERS_GPU[await encoderGpu()];
  if (!encoder) modo = 'cpu';
  const projeto = lerProjeto(id);
  const escala = escalaDoRender(projeto, resolucao);
  const { crf } = qualidadeDe(qualidade);
  if (projeto.timeline) {
    const erros = validarTimeline(id, lerTimeline(id));
    if (erros.length) throw new Error('A timeline tem problemas:\n' + erros.join('\n'));
    escreverModelo(projeto);
  }
  const dir = caminhoProjeto(id);
  const quando = carimbo();
  const saida = pastaSaida
    ? caminhoLivre(pastaSaida, nomeDoVideo(projeto), formato)
    : path.join(dir, 'renders', `${projeto.id.split('-').slice(1).join('-') || 'video'}-${quando}.${formato}`);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  // Temporários no mesmo disco dos projetos: o C: costuma estar cheio e os arquivos ligados não cruzam discos.
  const raizTmp = path.join(dirs().ws, '.tmp');
  // Só um render roda por vez: o que estiver aqui sobrou de um app fechado no meio do render.
  fs.rmSync(raizTmp, { recursive: true, force: true });
  fs.mkdirSync(raizTmp, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(raizTmp, 'render-'));
  const inicio = Date.now();
  const opts = { cwd: dirs().ws, env: { TEMP: tmp, TMP: tmp }, onEvento, sinal };

  let motor = 'remotion';
  if (projeto.engine === 'remotion' && projeto.timeline && s.renderMotor === 'filmcraft') {
    const { filmcraftDisponivel } = await import('./filmcraft.mjs');
    if (filmcraftDisponivel()) {
      try {
        await exportarPeloFilmcraft(id, saida, { modo, formato, escala, qualidade, semAudio }, opts);
        motor = 'filmcraft';
      } catch (e) {
        if (sinal?.aborted) {
          fs.rmSync(tmp, { recursive: true, force: true });
          throw e;
        }
        fs.rmSync(saida, { force: true });
        onEvento?.({ log: `Filmcraft falhou, exportando pelo Remotion: ${semCores(e.message).slice(0, 300)}` });
        onEvento?.({ etapa: 'Filmcraft falhou: usando o Remotion', progresso: 0 });
      }
    }
  }

  try {
    if (motor === 'filmcraft') {
      // Já exportado acima.
    } else if (projeto.engine === 'remotion') {
      const cli = path.join(dirs().ws, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
      const entrada = path.join('projetos', id, 'src', 'index.ts');
      const publica = projeto.timeline
        ? await pastaPublica(id, lerTimeline(id), path.join(tmp, 'publico'), opts)
        : path.join('projetos', id, 'assets');
      // A RX 570 tem 4 GB: mais quadros ao mesmo tempo não acelera e estoura o limite de busca de cada quadro.
      const base = [cli, 'render', entrada, 'Main', '--public-dir', publica, '--concurrency=2', '--timeout=120000',
        ...(escala !== 1 ? [`--scale=${escala}`] : []), ...(semAudio ? ['--muted'] : [])];
      if (modo === 'gpu') {
        // Chrome desenha os quadros com a GPU (ANGLE); intermediário rápido e quase sem perda; final no encoder da GPU.
        const inter = path.join(tmp, 'inter.mp4');
        await etapa('Renderizando quadros (GPU)', s.nodePath,
          [...base, inter, '--gl=angle', '--codec=h264', '--crf=12', '--x264-preset=veryfast'],
          { ...opts, peso: [0.1, 0.85] });
        await etapa(`Codificando com ${encoder.nome}`, s.ffmpegPath, argsGpu(encoder, inter, saida, { qualidade, semAudio }), { ...opts, peso: [0.85, 1] });
      } else if (formato === 'mov') {
        await etapa('Renderizando (CPU, ProRes)', s.nodePath,
          [...base, saida, '--gl=swangle', '--codec=prores', '--prores-profile=hq'], { ...opts, peso: [0.1, 1] });
      } else {
        await etapa('Renderizando (CPU)', s.nodePath,
          [...base, saida, '--gl=swangle', '--codec=h264', `--crf=${crf}`], { ...opts, peso: [0.1, 1] });
      }
    } else {
      const bin = hyperframesBin();
      const gpuFlags = modo === 'gpu' ? ['--gpu', '--browser-gpu'] : ['--no-browser-gpu'];
      if (formato === 'mov' && modo === 'gpu') {
        // ProRes não tem encoder de GPU: renderiza H.264 na GPU e só troca o contêiner.
        const inter = path.join(tmp, 'inter.mp4');
        await etapa('Renderizando (GPU)', s.nodePath, [bin, 'render', dir, '-o', inter, ...gpuFlags], { ...opts, peso: [0, 0.95] });
        await etapa('Gerando MOV', s.ffmpegPath, ['-y', '-i', inter, '-c', 'copy', saida], { ...opts, peso: [0.95, 1] });
      } else if (formato === 'mov') {
        await etapa('Renderizando (CPU, ProRes)', s.nodePath,
          [bin, 'render', dir, '-o', saida, '--format', 'mov', '--prores-profile', 'hq', ...gpuFlags], opts);
      } else {
        await etapa(modo === 'gpu' ? 'Renderizando (GPU)' : 'Renderizando (CPU)', s.nodePath,
          [bin, 'render', dir, '-o', saida, ...gpuFlags], opts);
      }
    }
    if (projeto.engine !== 'remotion' && motor !== 'filmcraft' && (escala !== 1 || semAudio)) {
      const ajustado = path.join(tmp, 'ajustado' + path.extname(saida));
      const par = (x) => Math.max(2, Math.round((x * escala) / 2) * 2);
      const video = formato === 'mov'
        ? ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
      await etapa('Ajustando resolução e áudio', s.ffmpegPath, [
        '-y', '-hide_banner', '-i', saida,
        ...(escala !== 1 ? ['-vf', `scale=${par(projeto.largura)}:${par(projeto.altura)}:flags=lanczos`] : []),
        ...video, ...(semAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', '320k']), ajustado,
      ], { ...opts, peso: [0.95, 1] });
      fs.copyFileSync(ajustado, saida);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const segundos = Math.round((Date.now() - inicio) / 1000);
  let preview;
  if ((await infoVideo(saida)).codec === 'prores') {
    // O player do app (Chromium) não toca ProRes: gera uma cópia H.264 só para assistir.
    onEvento?.({ etapa: 'Gerando prévia', progresso: 1 });
    preview = path.join(dir, 'renders', '.previa', path.basename(saida, '.mov') + '.mp4');
    await transcodificar(saida, { formato: 'mp4', modo: encoder ? 'gpu' : 'cpu', saida: preview });
  }
  const atual = lerProjeto(id);
  atual.renders.unshift({ arquivo: saida, preview, modo, motor, formato, resolucao: escala === 1 ? null : Math.round(projeto.largura * escala) + 'x' + Math.round(projeto.altura * escala), qualidade, semAudio, data: new Date().toISOString(), segundos, impressao: marca });
  gravarProjeto(atual);
  onEvento?.({ etapa: 'Pronto', progresso: 1 });
  return { arquivo: saida, preview, segundos };
}

// Extrai quadros do último render para o Claude conferir o resultado visualmente.
export async function extrairQuadros(id, segundos) {
  const projeto = lerProjeto(id);
  const ultimo = projeto.renders[0]?.arquivo;
  if (!ultimo || !fs.existsSync(ultimo)) throw new Error('Ainda não há render. Chame renderizar primeiro.');
  const pasta = path.join(caminhoProjeto(id), 'renders', 'quadros');
  fs.mkdirSync(pasta, { recursive: true });
  const saidas = [];
  for (const t of segundos) {
    const arq = path.join(pasta, `t${String(t).replace('.', '_')}.png`);
    const r = await rodar(carregar().ffmpegPath, ['-y', '-ss', String(t), '-i', ultimo, '-frames:v', '1', '-vf', 'scale=540:-2', arq]);
    if (r.codigo === 0 && fs.existsSync(arq)) saidas.push(arq);
  }
  return saidas;
}
