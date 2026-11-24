// Mídia otimizada, como a do Premiere: uma cópia SDR de cada vídeo grande no tamanho que a timeline usa (com folga
// para os zooms), feita uma vez, na placa, e guardada no cache do projeto. O modo rápido monta os trechos lendo a
// cópia em vez do 4K HDR do iPhone, que é o que mais pesa: medido num trecho de 8 s da RX 570, 4,9 s → 1,25 s.
// A cópia nunca atrasa um export: ela é feita em segundo plano (ver segundo-plano.mjs) e só entra se já estiver pronta.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { carregar } from './settings.mjs';
import { rodar } from './proc.mjs';
import { caminhoAssets, caminhoCache } from './workspace.mjs';
import { infoVideo, encoderGpu, TONEMAP } from './transcodificar.mjs';

// Muda quando o jeito de fazer a cópia muda: as antigas deixam de valer.
const VERSAO = 'otm-1';
// Só vale a pena com ganho de verdade: HDR (o tone mapping custa caro) ou bem maior que o necessário.
const PROPORCAO_MAXIMA = 0.75;

function escalaMaxima(item) {
  const valores = [item.escala ?? 1, ...(item.keyframes?.escala ?? []).map((k) => k.v)];
  const zoom = Math.max(item.zoom?.de ?? 1, item.zoom?.para ?? 1);
  return Math.max(1, ...valores) * zoom;
}

const videosDe = (t) => t.trilhas.filter((tr) => tr.tipo !== 'audio' && !tr.oculta).flatMap((tr) => tr.itens).filter((i) => i.tipo === 'video' && i.arquivo && !i.desativado);

// Qual cópia cada arquivo da timeline usaria: { arquivo: { destino, proporcao, info } }, só os que valem a pena.
export async function planoOtimizadas(id, t) {
  const assets = caminhoAssets(id);
  const porArquivo = new Map();
  for (const i of videosDe(t)) porArquivo.set(i.arquivo, [...(porArquivo.get(i.arquivo) ?? []), i]);
  const plano = {};
  for (const [arquivo, itens] of porArquivo) {
    const origem = path.join(assets, arquivo);
    if (!fs.existsSync(origem)) continue;
    const info = await infoVideo(origem);
    if (!info.largura || !info.altura || !info.codec) continue;
    const base = Math.max(t.largura / info.largura, t.altura / info.altura);
    // Degraus de 5%: timelines com zooms parecidos dividem a mesma cópia.
    const proporcao = Math.min(1, Math.ceil(base * Math.max(...itens.map(escalaMaxima)) * 20) / 20);
    if (!info.hdr && proporcao > PROPORCAO_MAXIMA) continue;
    const st = fs.statSync(origem);
    const chave = crypto.createHash('sha1').update(`${VERSAO}|${arquivo}|${st.size}|${Math.round(st.mtimeMs)}|${proporcao}`).digest('hex').slice(0, 16);
    const destino = path.join(caminhoCache(id), 'otimizada', `${chave}.mp4`);
    const par = (x) => Math.max(2, Math.round((x * proporcao) / 2) * 2);
    plano[arquivo] = { origem, destino, proporcao, info, largura: par(info.largura), altura: par(info.altura) };
  }
  return plano;
}

// As cópias que já estão prontas, no formato que o planoFfmpeg usa para trocar o arquivo: { arquivo: { caminho, info } }.
export async function otimizadasProntas(id, t) {
  const trocas = {};
  for (const [arquivo, p] of Object.entries(await planoOtimizadas(id, t))) {
    if (!fs.existsSync(p.destino)) continue;
    fs.utimesSync(p.destino, new Date(), new Date());
    trocas[arquivo] = { caminho: p.destino, info: { ...p.info, largura: p.largura, altura: p.altura, hdr: false, temAudio: false, codec: 'h264' } };
  }
  return trocas;
}

// Faz as cópias que faltam, uma de cada vez, com prioridade baixa. onLinha recebe o andamento.
export async function prepararOtimizadas(id, t, { sinal, onLinha } = {}) {
  const ffmpeg = carregar().ffmpegPath;
  const plano = Object.values(await planoOtimizadas(id, t)).filter((p) => !fs.existsSync(p.destino));
  const enc = await encoderGpu();
  for (const [k, p] of plano.entries()) {
    if (sinal?.aborted) return;
    fs.mkdirSync(path.dirname(p.destino), { recursive: true });
    const parcial = p.destino + '.tmp.mp4';
    onLinha?.(`Mídia otimizada ${k + 1} de ${plano.length}: ${path.basename(p.origem)}`);
    const cor = 'colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p';
    // Na placa (libplacebo) e, se falhar, na CPU. Qualidade alta (QP 16): a cópia ainda vai ser codificada de novo.
    const tentativas = [
      ['-init_hw_device', 'vulkan=vk', '-filter_hw_device', 'vk', '-hwaccel', 'd3d11va', '-i', p.origem, '-vf', `libplacebo=w=${p.largura}:h=${p.altura}${p.info.hdr ? ':tonemapping=bt.2390' : ''}:${cor}`],
      ['-threads', '4', '-i', p.origem, '-vf', `scale=${p.largura}:${p.altura}:flags=lanczos${p.info.hdr ? ',' + TONEMAP : ''},format=yuv420p`],
    ];
    const cod = enc === 'amf'
      ? ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '16', '-qp_p', '16', '-qp_b', '18', '-profile:v', 'high']
      : enc === 'nvenc'
        ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'constqp', '-qp', '16', '-profile:v', 'high']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15'];
    let ok = false;
    for (const ent of tentativas) {
      // Quadro-chave a cada 0,5 s: os trechos começam no meio do clipe e buscam rápido.
      const r = await rodar(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...ent, '-map', '0:v:0', '-an', ...cod, '-g', '15', '-pix_fmt', 'yuv420p', parcial], { sinal, baixa: true });
      if (sinal?.aborted) {
        fs.rmSync(parcial, { force: true });
        return;
      }
      if (r.codigo === 0) {
        ok = true;
        break;
      }
    }
    if (ok) fs.renameSync(parcial, p.destino);
    else fs.rmSync(parcial, { force: true });
  }
  limpar(id);
}

// Tira as cópias que nenhuma timeline usou há mais de 30 dias.
function limpar(id) {
  const pasta = path.join(caminhoCache(id), 'otimizada');
  try {
    const limite = Date.now() - 30 * 86400e3;
    for (const n of fs.readdirSync(pasta)) {
      const f = path.join(pasta, n);
      if (fs.statSync(f).mtimeMs < limite) fs.rmSync(f, { force: true });
    }
  } catch {}
}
