// Regras do arquivo final (codec, contêiner, taxa de bits), sem Electron.

// ProRes só existe em MOV. Sem codec escolhido (configuração antiga), MOV continua sendo ProRes.
export function normalizarSaida({ codec, formato }) {
  const c = codec ?? (formato === 'mov' ? 'prores' : 'h264');
  return { codec: c, formato: c === 'prores' || formato === 'mov' ? 'mov' : 'mp4' };
}

// Bits por pixel: 0,16 em H.264 dá 10 Mbit/s em 1080x1920 a 30 fps. O HEVC chega na mesma qualidade com cerca de 60%,
// o que dá os 6 Mbit/s do "Recomendado" do CapCut.
const BITS_POR_PIXEL = { alta: 0.32, recomendado: 0.16, media: 0.16, baixa: 0.09 };
const FATOR_HEVC = 0.6;
const BITS_PRORES_HQ = 3.5;

export function kbpsDe({ codec, qualidade, largura, altura, fps }) {
  const bpp = codec === 'prores' ? BITS_PRORES_HQ : (BITS_POR_PIXEL[qualidade] ?? BITS_POR_PIXEL.recomendado) * (codec === 'hevc' ? FATOR_HEVC : 1);
  return Math.round((largura * altura * fps * bpp) / 100000) * 100;
}

// Argumentos de vídeo do ffmpeg. encoderId: 'nvenc' ou 'amf' para a placa de vídeo; sem ele, CPU.
export function argsVideo({ codec, encoderId, kbps }) {
  if (codec === 'prores') return ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'];
  const taxa = ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`];
  const hevc = codec === 'hevc';
  const prefixo = hevc ? 'hevc' : 'h264';
  const perfil = ['-profile:v', hevc ? 'main' : 'high'];
  let video;
  if (encoderId === 'nvenc') video = ['-c:v', `${prefixo}_nvenc`, '-preset', 'p5', '-rc', 'vbr', ...taxa, ...perfil];
  else if (encoderId === 'amf') video = ['-c:v', `${prefixo}_amf`, '-usage', 'transcoding', '-quality', 'quality', '-rc', 'vbr_peak', ...taxa, ...perfil];
  else video = ['-c:v', hevc ? 'libx265' : 'libx264', '-preset', 'medium', ...taxa, ...(hevc ? ['-x265-params', 'log-level=error'] : perfil)];
  return [
    ...video,
    '-pix_fmt', 'yuv420p',
    // Sem as marcas, reprodutores podem chutar outro espaço de cor. hvc1: Apple e redes sociais só aceitam HEVC assim.
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    ...(hevc ? ['-tag:v', 'hvc1'] : []),
  ];
}

// Nome de arquivo sem os caracteres que o Windows recusa.
export const limparNome = (nome) => String(nome ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
