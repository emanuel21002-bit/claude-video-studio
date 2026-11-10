import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { carregar } from './settings.mjs';
import { rodar, trabalhoPesado } from './proc.mjs';
import { dirs, caminhoTimeline, caminhoAssets, caminhoCache, relTimeline, hyperframesBin, lerProjeto, gravarProjeto, carimbo, tipoDe } from './workspace.mjs';
import { ENCODERS_GPU, encoderGpu, infoVideo, transcodificar, TONEMAP } from './transcodificar.mjs';
import { escreverModelo, lerTimeline, validarTimeline } from './timeline.mjs';
import { normalizarSaida, kbpsDe, argsVideo, limparNome } from './exportacao.mjs';

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

// Quanto cada etapa do render levou (em segundos): mostra onde o tempo e a CPU vão. Um render por vez, então vale um vetor só.
let temposAtual = [];

async function etapa(nome, cmd, args, { cwd, env, onEvento, sinal, peso = [0, 1], limiteSemSaida = LIMITE_SEM_SAIDA }) {
  const inicioEtapa = Date.now();
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
  if (r.codigo === 0) temposAtual.push([nome, Math.round((Date.now() - inicioEtapa) / 1000)]);
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
  const origem = path.join(caminhoAssets(id), arquivo);
  const info = await infoVideo(origem);
  // Vídeo HDR sempre ganha cópia: o Chrome do render não faz tone mapping e o vídeo sairia lavado.
  // A cópia é SDR BT.709, a mesma cor da prévia. Aqui o tamanho nunca passa do original.
  const hdr = !!info.hdr;
  if (!info.largura || (!hdr && !CODECS_COM_COPIA.includes(info.codec))) return origem;
  const base = Math.max(t.largura / info.largura, t.altura / info.altura);
  let proporcao = base * Math.max(...itens.map(escalaMaxima));
  if (hdr) proporcao = Math.min(1, proporcao);
  else if (proporcao >= PROPORCAO_MINIMA) return origem;
  // A cópia leve serve a qualquer timeline do projeto que use o clipe na mesma proporção.
  const destino = path.join(caminhoCache(id), 'render', `${hdr ? 'sdr-' : ''}${Math.round(proporcao * 100)}-${arquivo}`);
  if (fs.existsSync(destino) && fs.statSync(destino).mtimeMs >= fs.statSync(origem).mtimeMs) return destino;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const par = (x) => Math.round((x * proporcao) / 2) * 2;
  const encoder = ENCODERS_GPU[await encoderGpu()];
  const parcial = destino + '.tmp.mp4';
  await etapa(opts.nome, carregar().ffmpegPath, [
    '-y', '-hide_banner', '-i', origem, '-map', '0:v:0', '-map', '0:a?', '-vf', `scale=${par(info.largura)}:${par(info.altura)}${hdr ? ',' + TONEMAP : ''}`,
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
// esta timeline usa, ligada (sem ocupar disco), com cópias leves no lugar dos clipes grandes. Os assets são do
// projeto todo: vídeos e áudios de outras timelines (as narrações delas, por exemplo) ficam de fora.
export async function pastaPublica(id, t, destino, opts = {}) {
  const assets = caminhoAssets(id);
  const blocos = path.join(caminhoTimeline(id), 'src', 'blocos.tsx');
  const codigo = fs.existsSync(blocos) ? fs.readFileSync(blocos, 'utf8') : '';
  const porArquivo = new Map();
  const usados = new Set();
  for (const i of t.trilhas.flatMap((tr) => tr.itens)) {
    if (i.arquivo) usados.add(i.arquivo);
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
    // Vídeo e áudio fora da timeline ficam de fora, a não ser que um bloco os use pelo nome.
    if (['video', 'audio'].includes(tipoDe(e.name)) && !usados.has(e.name) && !codigo.includes(e.name)) continue;
    ligar(origem, path.join(destino, e.name));
  }
  return destino;
}

// CRF do x264, onde o Remotion e o HyperFrames codificam direto na CPU.
const CRF = { alta: 16, recomendado: 19, media: 19, baixa: 26 };
const crfDe = (q) => CRF[q] ?? CRF.recomendado;

// O tamanho do arquivo que sai com estas escolhas, para a janela de exportação mostrar antes de exportar.
export function estimarRender(id, { codec, qualidade, resolucao, fps }) {
  const p = lerProjeto(id);
  const escala = escalaDoRender(p, resolucao);
  const kbps = kbpsDe({ codec, qualidade, largura: p.largura * escala, altura: p.altura * escala, fps: fps || p.fps });
  const itens = p.timeline ? lerTimeline(id).trilhas.flatMap((t) => t.itens) : [];
  const duracao = itens.length ? Math.max(...itens.map((i) => i.inicio + i.duracao)) : 0;
  return { duracao, kbps, megabytes: ((kbps + 320) * duracao) / 8000 };
}

// Escala em relação ao tamanho do projeto: 1 = original. A resolução pedida é o lado menor do quadro.
function escalaDoRender(projeto, resolucao) {
  const lado = Math.min(projeto.largura ?? 0, projeto.altura ?? 0);
  if (!resolucao || !lado) return 1;
  return Math.round((resolucao / lado) * 1000) / 1000;
}

// ---------- um render por vez ----------

// Tudo o que muda o resultado. Igual ao do último render, o arquivo já existente serve.
function impressao(id, projeto, modo, formato, ext) {
  const dir = caminhoTimeline(id);
  const h = crypto.createHash('sha1').update(`${modo}|${formato}|${projeto.engine}|${ext.motor}|${ext.codec}|${ext.fps}|${ext.resolucao}|${ext.qualidade}|${ext.semAudio}`);
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
    const t = fs.readFileSync(path.join(dir, 'timeline.json'));
    h.update(t);
    let codigo = '';
    for (const n of ['blocos.tsx', 'TimelineVideo.tsx']) {
      const c = path.join(dir, 'src', n);
      if (fs.existsSync(c)) {
        const conteudo = fs.readFileSync(c);
        h.update(conteudo);
        codigo += conteudo;
      }
    }
    // Só o que esta timeline usa: importar um material novo no projeto não invalida o render das outras.
    const usados = new Set(JSON.parse(t).trilhas.flatMap((tr) => tr.itens).map((i) => i.arquivo).filter(Boolean));
    const assets = caminhoAssets(id);
    for (const e of fs.readdirSync(assets, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() || !(usados.has(e.name) || codigo.includes(e.name))) continue;
      const info = fs.statSync(path.join(assets, e.name));
      h.update(`${e.name}:${info.size}:${info.mtimeMs}`);
    }
    return h.digest('hex');
  }
  {
    for (const n of fs.readdirSync(dir)) {
      const c = path.join(dir, n);
      if (['renders', '.previa', 'chat', 'projeto.json', 'assets'].includes(n)) continue;
      if (fs.statSync(c).isDirectory()) incluir(c);
      else h.update(`${n}:${fs.readFileSync(c).length}:${fs.statSync(c).mtimeMs}`);
    }
  }
  incluir(caminhoAssets(id));
  return h.digest('hex');
}

// Nome de arquivo do vídeo exportado para uma pasta escolhida: o nome do projeto, sem caracteres que o Windows recusa.
const nomeDoVideo = (p) => limparNome(p.nome) || 'video';

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
  const { codec, formato } = normalizarSaida({ codec: opcoes.codec ?? s.renderCodec, formato: opcoes.formato ?? s.renderFormato });
  const ext = {
    codec,
    motor: opcoes.motor ?? s.renderMotor,
    fps: opcoes.fps ?? s.renderFps ?? 0,
    resolucao: opcoes.resolucao ?? s.renderResolucao ?? 0,
    qualidade: opcoes.qualidade ?? s.renderQualidade ?? 'alta',
    semAudio: opcoes.semAudio ?? s.renderSemAudio ?? false,
  };
  const pastaSaida = opcoes.pastaSaida ?? null;
  const nome = limparNome(opcoes.nome) || null;
  const chave = `${id}|${modo}|${formato}|${Object.values(ext).join('|')}|${pastaSaida ?? ''}|${nome ?? ''}`;
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
      // Já existe um render igual: só vai uma cópia para a pasta e o nome escolhidos.
      const pastaFinal = pastaSaida ?? path.dirname(arquivo);
      const outraPasta = path.resolve(path.dirname(arquivo)) !== path.resolve(pastaFinal);
      if (outraPasta || (nome && path.parse(arquivo).name !== nome)) {
        arquivo = caminhoLivre(pastaFinal, nome ?? nomeDoVideo(projeto), formato);
        fs.mkdirSync(pastaFinal, { recursive: true });
        fs.copyFileSync(ultimo.arquivo, arquivo);
      }
      return { arquivo, preview: ultimo.preview, segundos: 0, reaproveitado: true };
    }
    trabalhoPesado.renders++;
    return executarRender(id, { modo, formato, marca, pastaSaida, nome, ...ext }, onEvento, sinal).finally(() => {
      trabalhoPesado.renders--;
    });
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
async function exportarPeloFilmcraft(id, saida, { modo, codec, formato, escala, semAudio, fps, kbps, tmp, codificarFinal }, opts) {
  const { prepararProjetoFilmcraft, cli } = await import('./filmcraft.mjs');
  const projetoFc = path.join(path.dirname(opts.env.TEMP), `${path.basename(opts.env.TEMP)}.fcproj`);
  opts.onEvento?.({ etapa: 'Preparando textos e legendas', progresso: 0.02 });
  // O Filmcraft não tem codificador de HEVC no Windows: ele monta em H.264 com folga de qualidade, e o ffmpeg converte no fim.
  const hevc = codec === 'hevc';
  const destino = hevc ? path.join(tmp, 'filmcraft.mp4') : saida;
  const ajustes = {
    ...(codec === 'prores' ? {} : { bitrateKbps: hevc ? Math.max(kbps * 4, 40000) : kbps, multiplexer: hevc ? 'mp4' : formato }),
    ...(fps && !hevc ? { frameRate: { num: fps, den: 1 } } : {}),
  };
  try {
    const inicioCamada = Date.now();
    await prepararProjetoFilmcraft(id, projetoFc, (l) => {
      opts.onEvento?.({ log: l });
      // O app mostra se a camada de textos foi reaproveitada ou está sendo renderizada.
      if (/reaproveitando|Renderizando textos/.test(l)) opts.onEvento?.({ etapa: l.replace(/ para o Filmcraft/, '').replace(/…$/, ''), progresso: 0.05 });
    });
    temposAtual.push(['Textos e legendas (Remotion, CPU)', Math.round((Date.now() - inicioCamada) / 1000)]);
    if (opts.sinal?.aborted) throw new Error('Render cancelado.');
    await etapa('Exportando pelo Filmcraft', cli(), [
      '--project', projetoFc, 'export', destino, '--format', codec === 'prores' ? 'prores' : 'h264', '--gpu-rendering', modo === 'gpu' ? 'auto' : 'off',
      '--settings', JSON.stringify(ajustes),
      ...(escala !== 1 ? ['--scale', String(escala)] : []),
      ...(semAudio ? ['--no-audio'] : []),
    ], { ...opts, peso: [0.4, hevc ? 0.85 : 1], limiteSemSaida: LIMITE_FILMCRAFT });
    if (hevc) await codificarFinal(destino, { peso: [0.85, 1] });
  } finally {
    fs.rmSync(projetoFc, { force: true });
  }
}

async function executarRender(id, { modo, formato, codec, motor: motorPedido, fps, marca, pastaSaida, nome, resolucao, qualidade, semAudio }, onEvento, sinal) {
  temposAtual = [];
  const s = carregar();
  const encoderId = await encoderGpu();
  const encoder = ENCODERS_GPU[encoderId];
  if (!encoder) modo = 'cpu';
  const projeto = lerProjeto(id);
  const escala = escalaDoRender(projeto, resolucao);
  const crf = crfDe(qualidade);
  // 0 ou igual ao do projeto: nada a converter.
  const fpsNovo = fps && fps !== projeto.fps ? fps : 0;
  const kbps = kbpsDe({ codec, qualidade, largura: projeto.largura * escala, altura: projeto.altura * escala, fps: fps || projeto.fps });
  if (projeto.timeline) {
    const erros = validarTimeline(id, lerTimeline(id));
    if (erros.length) throw new Error('A timeline tem problemas:\n' + erros.join('\n'));
    escreverModelo(projeto);
  }
  const dir = caminhoTimeline(id);
  const quando = carimbo();
  const pastaRenders = path.join(dir, 'renders');
  const saida = pastaSaida || nome
    ? caminhoLivre(pastaSaida ?? pastaRenders, nome ?? nomeDoVideo(projeto), formato)
    : path.join(pastaRenders, `${projeto.timelineId}-${quando}.${formato}`);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  // Temporários no mesmo disco dos projetos: o C: costuma estar cheio e os arquivos ligados não cruzam discos.
  const raizTmp = path.join(dirs().ws, '.tmp');
  // Só um render roda por vez: o que estiver aqui sobrou de um app fechado no meio do render.
  fs.rmSync(raizTmp, { recursive: true, force: true });
  fs.mkdirSync(raizTmp, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(raizTmp, 'render-'));
  const inicio = Date.now();
  const opts = { cwd: dirs().ws, env: { TEMP: tmp, TMP: tmp }, onEvento, sinal };

  // Último passo: codec, contêiner, fps e taxa de bits do arquivo final. Na placa de vídeo; se ela recusar, na CPU.
  const codificarFinal = async (entrada, { peso, filtros = [] }) => {
    const vf = [...filtros, ...(fpsNovo ? [`fps=${fpsNovo}`] : [])];
    const args = (id) => [
      '-y', '-hide_banner', '-i', entrada, ...(vf.length ? ['-vf', vf.join(',')] : []),
      ...argsVideo({ codec, encoderId: id, kbps }),
      ...(semAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', '320k']), '-movflags', '+faststart', saida,
    ];
    const naGpu = modo === 'gpu' && codec !== 'prores';
    if (naGpu) {
      try {
        await etapa(`Codificando com ${encoder.nome}`, s.ffmpegPath, args(encoderId), { ...opts, peso });
        return;
      } catch (e) {
        if (sinal?.aborted) throw e;
        onEvento?.({ log: `${encoder.nome} falhou, codificando na CPU: ${semCores(e.message).slice(0, 200)}` });
      }
    }
    await etapa('Codificando (CPU)', s.ffmpegPath, args(null), { ...opts, peso });
  };
  // H.264 em MP4 no tamanho do projeto sai direto; o resto passa pelo último passo.
  const precisaFinal = codec !== 'h264' || formato !== 'mp4' || !!fpsNovo;
  const baseH264 = precisaFinal ? path.join(tmp, 'base.mp4') : saida;

  let motor = 'remotion';
  if (projeto.engine === 'remotion' && projeto.timeline && motorPedido === 'filmcraft') {
    const { filmcraftDisponivel } = await import('./filmcraft.mjs');
    if (filmcraftDisponivel()) {
      try {
        await exportarPeloFilmcraft(id, saida, { modo, codec, formato, escala, semAudio, fps: fpsNovo, kbps, tmp, codificarFinal }, opts);
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
    // Os clipes entram como estão (H.265, ProRes…). Só o OffthreadVideo da timeline Remotion lê esses codecs;
    // HyperFrames e código Remotion escrito à mão usam o <video> do Chrome, que não lê H.265.
    if (motor !== 'filmcraft' && !(projeto.engine === 'remotion' && projeto.timeline)) {
      const ruins = [];
      for (const e of fs.readdirSync(caminhoAssets(id), { withFileTypes: true })) {
        if (!e.isFile() || tipoDe(e.name) !== 'video') continue;
        const codec = (await infoVideo(path.join(caminhoAssets(id), e.name))).codec;
        if (codec && !['h264', 'vp8', 'vp9', 'av1'].includes(codec)) ruins.push(`${e.name} (${codec})`);
      }
      if (ruins.length) onEvento?.({ log: `Aviso: este render usa o Chrome, que pode não ler: ${ruins.join(', ')}. Se o vídeo sair em branco, converta esses clipes para H.264 em "Converter vídeos".` });
    }
    if (motor === 'filmcraft') {
      // Já exportado acima.
    } else if (projeto.engine === 'remotion') {
      const cli = path.join(dirs().ws, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
      const entrada = path.join(relTimeline(id), 'src', 'index.ts');
      const publica = projeto.timeline
        ? await pastaPublica(id, lerTimeline(id), path.join(tmp, 'publico'), opts)
        : caminhoAssets(id);
      // A RX 570 tem 4 GB: mais quadros ao mesmo tempo não acelera e estoura o limite de busca de cada quadro.
      const base = [cli, 'render', entrada, 'Main', '--public-dir', publica, '--concurrency=2', '--timeout=120000',
        ...(escala !== 1 ? [`--scale=${escala}`] : []), ...(semAudio ? ['--muted'] : [])];
      if (modo === 'gpu') {
        // Chrome desenha os quadros com a GPU (ANGLE); intermediário rápido e quase sem perda; final no encoder da GPU.
        const inter = path.join(tmp, 'inter.mp4');
        await etapa('Renderizando quadros (GPU)', s.nodePath,
          [...base, inter, '--gl=angle', '--codec=h264', '--crf=12', '--x264-preset=veryfast'],
          { ...opts, peso: [0.1, 0.85] });
        await codificarFinal(inter, { peso: [0.85, 1] });
      } else if (codec === 'prores') {
        await etapa('Renderizando (CPU, ProRes)', s.nodePath,
          [...base, saida, '--gl=swangle', '--codec=prores', '--prores-profile=hq'], { ...opts, peso: [0.1, 1] });
      } else {
        await etapa('Renderizando (CPU)', s.nodePath,
          [...base, baseH264, '--gl=swangle', '--codec=h264', `--crf=${precisaFinal ? 12 : crf}`], { ...opts, peso: [0.1, precisaFinal ? 0.85 : 1] });
        if (precisaFinal) await codificarFinal(baseH264, { peso: [0.85, 1] });
      }
    } else {
      const bin = hyperframesBin();
      const gpuFlags = modo === 'gpu' ? ['--gpu', '--browser-gpu'] : ['--no-browser-gpu'];
      const par = (x) => Math.max(2, Math.round((x * escala) / 2) * 2);
      const filtros = escala !== 1 ? [`scale=${par(projeto.largura)}:${par(projeto.altura)}:flags=lanczos`] : [];
      if (codec === 'prores' && modo !== 'gpu') {
        await etapa('Renderizando (CPU, ProRes)', s.nodePath,
          [bin, 'render', dir, '-o', saida, '--format', 'mov', '--prores-profile', 'hq', ...gpuFlags], opts);
      } else {
        await etapa(modo === 'gpu' ? 'Renderizando (GPU)' : 'Renderizando (CPU)', s.nodePath,
          [bin, 'render', dir, '-o', baseH264, ...gpuFlags], { ...opts, peso: [0, precisaFinal ? 0.9 : 1] });
        if (precisaFinal) await codificarFinal(baseH264, { peso: [0.9, 1], filtros });
      }
    }
    // O último passo já cuidou de resolução e áudio do HyperFrames.
    const faltaAjustar = (codec === 'prores' && modo !== 'gpu') || !precisaFinal;
    if (projeto.engine !== 'remotion' && motor !== 'filmcraft' && faltaAjustar && (escala !== 1 || semAudio)) {
      const ajustado = path.join(tmp, 'ajustado' + path.extname(saida));
      const par = (x) => Math.max(2, Math.round((x * escala) / 2) * 2);
      const video = codec === 'prores'
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
    preview = path.join(dir, 'renders', '.previa', path.parse(saida).name + '.mp4');
    await transcodificar(saida, { formato: 'mp4', modo: encoder ? 'gpu' : 'cpu', saida: preview });
  }
  const atual = lerProjeto(id);
  atual.renders.unshift({ etapas: temposAtual, arquivo: saida, preview, modo, motor, formato, codec, fps: fps || projeto.fps, resolucao: escala === 1 ? null : Math.round(projeto.largura * escala) + 'x' + Math.round(projeto.altura * escala), qualidade, semAudio, data: new Date().toISOString(), segundos, impressao: marca });
  gravarProjeto(atual);
  onEvento?.({ etapa: 'Pronto', progresso: 1 });
  return { arquivo: saida, preview, segundos, etapas: temposAtual };
}

// Extrai quadros do último render para o Claude conferir o resultado visualmente.
export async function extrairQuadros(id, segundos) {
  const projeto = lerProjeto(id);
  const ultimo = projeto.renders[0]?.arquivo;
  if (!ultimo || !fs.existsSync(ultimo)) throw new Error('Ainda não há render. Chame renderizar primeiro.');
  const pasta = path.join(caminhoTimeline(id), 'renders', 'quadros');
  fs.mkdirSync(pasta, { recursive: true });
  const saidas = [];
  for (const t of segundos) {
    const arq = path.join(pasta, `t${String(t).replace('.', '_')}.png`);
    const r = await rodar(carregar().ffmpegPath, ['-y', '-ss', String(t), '-i', ultimo, '-frames:v', '1', '-vf', 'scale=540:-2', arq]);
    if (r.codigo === 0 && fs.existsSync(arq)) saidas.push(arq);
  }
  return saidas;
}
