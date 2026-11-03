import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Estilos de edição predefinidos. O texto de "instrucoes" vai para o briefing do Claude.
export const ESTILOS = [
  {
    id: 'reels-estetica',
    nome: 'Reels Estética Automotiva',
    descricao: 'Seu padrão de clientes: legenda Montserrat ExtraBold, selo de preço, light leak, logo a 60%.',
    engine: 'remotion',
    formato: '9:16',
    instrucoes:
      'Siga a skill "edicao-reels-estetica" à risca (legenda Montserrat ExtraBold branca em y −300, motion na legenda dos ganchos, selo animado em preço/desconto, light leak entre etapas, logo do cliente sem fundo a 60%, ordem antes → lavagem → polimento → vitrificação → depois).',
  },
  {
    id: 'youtube-motion',
    nome: 'YouTube Motion (canal Mateus Dias)',
    descricao: 'Motion graphics em preto, branco e verde-azulado, efeitos sonoros e trilha baixa.',
    engine: 'hyperframes',
    formato: '16:9',
    instrucoes:
      'Siga a skill "yt-ddiasmatt-animation": identidade em preto, branco e verde-azulado, motion HTML/CSS/GSAP sobre o material, títulos cinéticos acompanhando a narração.',
  },
  {
    id: 'reels-dinamico',
    nome: 'Reels Dinâmico',
    descricao: 'Cortes rápidos no ritmo da fala, legenda palavra a palavra com destaque, zoom punch-in.',
    engine: 'remotion',
    formato: '9:16',
    instrucoes:
      'Cortes a cada 1,5–3 s sincronizados com as frases da narração. Legenda palavra a palavra (2–4 palavras por vez) centralizada no terço inferior, fonte bold grande com contorno, palavra-chave destacada em amarelo. Zoom punch-in sutil (1.0 → 1.08) em cada corte. Gancho forte nos 2 primeiros segundos.',
  },
  {
    id: 'minimalista',
    nome: 'Minimalista Clean',
    descricao: 'Transições suaves, tipografia fina, muito respiro e cores neutras.',
    engine: 'hyperframes',
    formato: '9:16',
    instrucoes:
      'Visual limpo: transições crossfade de 0,5 s, tipografia sans-serif leve (Inter ou similar), legendas pequenas em caixa baixa, paleta neutra (branco, off-white, cinza escuro). Nada de efeitos chamativos; movimento lento e elegante.',
  },
  {
    id: 'cinematografico',
    nome: 'Documental / Cinematográfico',
    descricao: 'Barras letterbox, color grade quente, títulos de capítulo e ritmo mais lento.',
    engine: 'remotion',
    formato: '16:9',
    instrucoes:
      'Clima de documentário: letterbox 2.39:1, leve color grade quente e vinheta, cortes mais longos (4–7 s), títulos de capítulo em serifa elegante com fade, legenda discreta embaixo. Ken Burns lento em fotos.',
  },
  {
    id: 'personalizado',
    nome: 'Personalizado',
    descricao: 'Descreva o estilo com suas palavras e o Claude cria a edição.',
    engine: 'remotion',
    formato: '9:16',
    instrucoes: '',
  },
];

// Estilos que o Claude salvou a pedido do usuário (ferramenta salvar_estilo).
const ARQUIVO_USUARIO = () => path.join(app.getPath('userData'), 'estilos.json');

export function estilosUsuario() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_USUARIO(), 'utf8'));
  } catch {
    return [];
  }
}

// Personalizado fica sempre por último.
export function todosEstilos() {
  return [...ESTILOS.slice(0, -1), ...estilosUsuario(), ESTILOS.at(-1)];
}

export function salvarEstilo({ nome, descricao, instrucoes, engine, formato }) {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const estilo = { id: 'usuario-' + base, nome, descricao, instrucoes, engine, formato, doUsuario: true };
  const lista = estilosUsuario().filter((e) => e.id !== estilo.id);
  lista.push(estilo);
  fs.writeFileSync(ARQUIVO_USUARIO(), JSON.stringify(lista, null, 2));
  return estilo;
}

export function excluirEstilo(id) {
  fs.writeFileSync(ARQUIVO_USUARIO(), JSON.stringify(estilosUsuario().filter((e) => e.id !== id), null, 2));
}

export const FORMATOS = {
  '9:16': { largura: 1080, altura: 1920 },
  '16:9': { largura: 1920, altura: 1080 },
  '1:1': { largura: 1080, altura: 1080 },
  '4:5': { largura: 1080, altura: 1350 },
};
