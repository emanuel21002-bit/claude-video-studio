// Decide se o áudio de um vídeo tem narração, a partir da transcrição do Whisper. Sem dependências: dá para testar à parte.

// Em trecho sem fala (música, ruído, silêncio) o Whisper inventa texto: marcas como "[Música]" e frases de rodapé.
const MARCA = /^[\[(♪*].*[\])♪*]$|^[\s♪.…-]*$/;
const INVENTADAS = /legendas?\s+(pela|por|da)\s+comunidade|obrigad[oa]\s+por\s+assistir|inscreva-se|amara\.org|transcrição\s+e\s+legendas/i;

// Tira o que o Whisper põe em trecho sem fala e as frases que ele repete em loop.
export function limparTranscricao({ segmentos = [], palavras = [] }) {
  const contagem = new Map();
  for (const s of segmentos) contagem.set(s.texto.toLowerCase(), (contagem.get(s.texto.toLowerCase()) ?? 0) + 1);
  const bom = (s) => !MARCA.test(s.texto.trim()) && !INVENTADAS.test(s.texto) && (contagem.get(s.texto.toLowerCase()) ?? 0) < 3;
  const ok = segmentos.filter(bom);
  const dentro = (p) => ok.some((s) => p.inicio >= s.inicio - 0.05 && p.fim <= s.fim + 0.05);
  return { segmentos: ok, palavras: palavras.filter(dentro) };
}

// Tempo com fala, juntando segmentos que se encostam (o Whisper às vezes sobrepõe um pouco).
function segundosComFala(segmentos) {
  const ordem = [...segmentos].sort((a, b) => a.inicio - b.inicio);
  let total = 0;
  let fim = -Infinity;
  for (const s of ordem) {
    const ini = Math.max(s.inicio, fim);
    if (s.fim > ini) total += s.fim - ini;
    fim = Math.max(fim, s.fim);
  }
  return total;
}

// veredito: 'narracao' (fala o vídeo quase todo), 'fala-curta' (alguma fala) ou 'sem-fala' (música, ruído ou silêncio).
export function resumoDaFala(transcricao, duracao) {
  const { segmentos, palavras } = limparTranscricao(transcricao);
  const dur = Math.max(duracao || 0, segmentos.at(-1)?.fim ?? 0, 0.001);
  const fala = Math.min(segundosComFala(segmentos), dur);
  const cobertura = fala / dur;
  const n = palavras.length;
  const porMinuto = n / (dur / 60);
  let veredito = 'sem-fala';
  if (n >= 15 && cobertura >= 0.3 && porMinuto >= 40) veredito = 'narracao';
  else if (n >= 5 && cobertura >= 0.08) veredito = 'fala-curta';
  return {
    veredito,
    cobertura: Math.round(cobertura * 100) / 100,
    palavras: n,
    segundosComFala: Math.round(fala * 10) / 10,
    texto: segmentos.map((s) => s.texto).join(' ').slice(0, 600),
  };
}
