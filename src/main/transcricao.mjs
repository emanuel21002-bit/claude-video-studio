import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { carregar } from './settings.mjs';
import { rodarOuFalhar } from './proc.mjs';
import { caminhoProjeto } from './workspace.mjs';

// Versões novas do whisper.cpp usam whisper-cli.exe (o main.exe delas é só um aviso de descontinuação).
function whisperExe() {
  const dir = carregar().whisperDir;
  return ['whisper-cli.exe', 'main.exe'].map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
}

export function whisperDisponivel() {
  const s = carregar();
  return !!whisperExe() && fs.existsSync(path.join(s.whisperDir, s.whisperModelo));
}

// Transcreve a narração do projeto com whisper.cpp e grava transcricao.json
// { segmentos: [{inicio, fim, texto}], palavras: [{inicio, fim, texto}] } em segundos.
export async function transcrever(projeto, onLinha) {
  const s = carregar();
  const dir = caminhoProjeto(projeto.id);
  const entrada = path.join(dir, 'assets', projeto.narracao.arquivo);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-whisper-'));
  const wav = path.join(tmp, 'narracao.wav');
  const base = path.join(tmp, 'saida');

  onLinha?.('Convertendo narração para 16 kHz…');
  await rodarOuFalhar(s.ffmpegPath, ['-y', '-i', entrada, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);

  onLinha?.('Transcrevendo com Whisper (modelo ' + s.whisperModelo.replace(/^ggml-|\.bin$/g, '') + ')…');
  await rodarOuFalhar(
    whisperExe(),
    [
      '-m', path.join(s.whisperDir, s.whisperModelo),
      '-f', wav,
      '-l', 'pt',
      '-t', String(Math.max(2, os.cpus().length - 2)),
      '-pp',
      '-ojf',
      '-of', base,
    ],
    {
      onLinha: (l) => {
        const m = l.match(/progress\s*=\s*(\d+)%/);
        if (m) onLinha?.(`Transcrevendo… ${m[1]}%`);
      },
    },
  );

  const bruto = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  const segmentos = [];
  const palavras = [];
  for (const seg of bruto.transcription ?? []) {
    const texto = seg.text.trim();
    if (!texto) continue;
    segmentos.push({ inicio: seg.offsets.from / 1000, fim: seg.offsets.to / 1000, texto });
    // Tokens que começam com espaço iniciam uma palavra nova; os outros continuam a anterior.
    for (const tok of seg.tokens ?? []) {
      if (!tok.text || tok.text.startsWith('[_')) continue;
      const inicio = tok.offsets.from / 1000;
      const fim = tok.offsets.to / 1000;
      if (tok.text.startsWith(' ') || palavras.length === 0) {
        palavras.push({ inicio, fim, texto: tok.text.trim() });
      } else {
        const ult = palavras.at(-1);
        ult.texto += tok.text;
        ult.fim = fim;
      }
    }
  }
  const resultado = { segmentos, palavras: palavras.filter((p) => p.texto) };
  fs.writeFileSync(path.join(dir, 'transcricao.json'), JSON.stringify(resultado, null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
  onLinha?.(`Transcrição pronta: ${segmentos.length} frases.`);
  return resultado;
}
