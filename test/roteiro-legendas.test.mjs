import test from 'node:test';
import assert from 'node:assert/strict';
import { corrigirPalavras, trechoDoRoteiro } from '../src/main/conferir-nucleo.mjs';

// Palavras transcritas com um tempo qualquer: cada uma dura 0,5 s.
const falado = (texto) => texto.split(' ').map((t, n) => ({ texto: t, inicio: n / 2, fim: n / 2 + 0.5 }));
const textos = (r) => r.palavras.map((p) => p.texto).join(' ');

test('grafia e pontuação vêm do roteiro; os tempos continuam do áudio', () => {
  const r = corrigirPalavras(falado('a vitrificacao da byd custa pouco'), 'A vitrificação da BYD custa pouco.');
  assert.equal(r.usado, true);
  assert.equal(textos(r), 'A vitrificação da BYD custa pouco.');
  assert.deepEqual([r.palavras[1].inicio, r.palavras[1].fim], [0.5, 1]);
});

test('preço e desconto ficam inteiros; aspas e marcas de formatação saem', () => {
  const r = corrigirPalavras(falado('com 30% de desconto por r$150 no carro novo'), 'Com **30%** de desconto por R$150, no "carro novo".');
  assert.equal(textos(r), 'Com 30% de desconto por R$150, no carro novo.');
});

test('erro isolado do Whisper é trocado pelo roteiro', () => {
  const r = corrigirPalavras(falado('hoje o marcelu faz o polimento completo do carro'), 'Hoje o Marcelo faz o polimento completo do carro');
  assert.match(textos(r), /^Hoje o Marcelo faz/);
});

test('palavra partida em duas volta a ser uma, do início da primeira ao fim da segunda', () => {
  const r = corrigirPalavras(falado('faz a vitri ficacao no carro hoje'), 'Faz a vitrificação no carro hoje');
  assert.equal(textos(r), 'Faz a vitrificação no carro hoje');
  const v = r.palavras[2];
  assert.deepEqual([v.inicio, v.fim], [1, 2]);
});

test('o que está só no roteiro não vira legenda', () => {
  const r = corrigirPalavras(falado('o carro ficou novo'), 'CENA 1: abertura com drone. O carro ficou novo. CENA 2: preço na tela.');
  assert.equal(textos(r), 'O carro ficou novo.');
});

test('fala que o locutor mudou continua como foi dita', () => {
  const r = corrigirPalavras(falado('o carro ficou muito brilhante mesmo depois'), 'O carro ficou lindo e novo depois');
  assert.ok(r.palavras.some((p) => p.texto === 'brilhante'));
});

test('roteiro de outro áudio é ignorado', () => {
  const entrada = falado('promocao de lavagem so nesta semana aproveite');
  const r = corrigirPalavras(entrada, 'A película cerâmica protege o painel do sol forte do verão');
  assert.equal(r.usado, false);
  assert.equal(r.palavras, entrada);
});

test('num roteiro com vários áudios, cada um acha o trecho dele', () => {
  const roteiro = 'Áudio 1: A lavagem técnica limpa cada detalhe. Áudio 2: O polimento tira os riscos da pintura. Áudio 3: A vitrificação protege por anos.';
  assert.equal(trechoDoRoteiro('o polimento tira os riscos da pintura', roteiro), 'O polimento tira os riscos da pintura.');
  assert.equal(trechoDoRoteiro('nada a ver com isso aqui gente', roteiro), null);
});
