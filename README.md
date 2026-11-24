# MovAi

**MovAi** — app de desktop (Electron) que edita vídeos sozinho com o Claude, usando Remotion ou HyperFrames, com conversor de vídeo próprio (H.264, H.265, AV1 e outros, em CPU ou placa de vídeo).

📖 **Primeira vez aqui? Siga o [GUIA.md](GUIA.md)**: tudo o que precisa ser instalado e o passo a passo de uso.

1. **Materiais** — arraste vídeos, fotos, logo e trilha (ou selecione arquivos/pasta). O botão "Só motion" pula materiais e narração: o Claude cria tudo em animação a partir da descrição e da duração.
2. **Narração** — solte as pastas ou os áudios; o Whisper transcreve com tempos por palavra. Cada narração vira um vídeo com os mesmos materiais, montados um de cada vez. Uma pasta é uma narração: os áudios dela são unidos na ordem dos nomes.
3. **Estilo** — escolha um preset (ou "Personalizado"), a engine e o formato.

O Claude (Agent SDK, o mesmo motor do Claude Code / extensão do VS Code) lê o briefing, escreve a composição, renderiza, confere quadros e mostra o vídeo no player. O chat ao lado pede alterações e novos renders.

## Rodar

```bash
npm install
npm start
```

Na primeira abertura o app pede para entrar na conta Claude e instala o Remotion e o HyperFrames em `Documentos\Claude Video Studio`.

## Gerar o executável

```bash
npm run dist
```

Sai em `dist\`: `Claude-Video-Studio-Setup-<versão>.exe`, instalador com atalhos. O ícone é `build/icon.png`, gerado de `build/icone.html` com `npm run icone`.

O instalador é autossuficiente: leva a pasta `recursos\` (fora do git, montada à mão) para `resources\recursos` da instalação:

| Pasta | Conteúdo |
|---|---|
| `bin\` | `node.exe`, `ffmpeg.exe`, `ffprobe.exe` (full build, com NVENC, AMF e libplacebo) — entram na frente do PATH |
| `whisper\` | `whisper-cli.exe` do whisper.cpp (build com Vulkan: usa a GPU, inclusive AMD), `ggml-medium-q5_0.bin` |
| `engines\node_modules\` | Remotion + HyperFrames já instalados (com o Chrome do Remotion em `.remotion`) |
| `chrome-hyperframes\` | Chrome do HyperFrames, copiado para `~\.cache\hyperframes\chrome` |
| `skills\` | skills de edição copiadas para o workspace (sem a lista de clientes) |
| `filmcraft\` | `filmcraft.exe` e `filmcraft-cli.exe` (pacote portátil Windows x64 do [Filmcraft](https://github.com/storytold/filmcraft)). Opcional: sem ele os botões do Filmcraft somem |

Na primeira abertura o app copia as engines e as skills para `Documentos\Claude Video Studio`, sem internet. Quem for usar só precisa entrar com a própria conta Claude (Pro ou superior) ou colar uma chave de API.

## Projetos e timelines

Um projeto tem um único conjunto de materiais e quantas timelines precisar, como no Filmcraft ou no CapCut. Criar um vídeo com várias narrações gera um projeto com uma timeline por narração. As abas no topo do editor criam (+ Nova), duplicam, renomeiam (clique duplo) e excluem timelines; nada disso copia ou apaga materiais.

```
projetos/<projeto>/
  projeto.json        materiais e dados de todas as timelines
  assets/             materiais e narrações, uma cópia só
  referencia/, instrucoes/
  .cache/             miniaturas, proxies e cópias leves, refeitas quando faltam
  timelines/<timeline>/
    timeline.json, BRIEFING.md, transcricao.json, src/, renders/, filmcraft/, .previa/
```

No código, o `id` que circula é o da timeline, `<projeto>/<timeline>`. `lerProjeto(id)` devolve a timeline já com os dados do projeto, e `gravarProjeto` separa de volta.

Na primeira abertura, `src/main/migracao.mjs` converte projetos do formato antigo (uma pasta com cópia dos materiais por timeline). Ele não apaga nada: os materiais entram por hard link e as pastas antigas vão para `projetos-antigos/`. O espaço só volta quando essa pasta é apagada. Conteúdo igual vira um arquivo só; nomes iguais com conteúdo diferente, como as narrações, ganham um sufixo, e as referências são atualizadas.

Testes da migração: `npm test`.

## Timeline

Projetos Remotion têm uma timeline editável com prévia ao vivo, sem precisar renderizar. Projetos HyperFrames seguem pelo chat.

- `timeline.json` é a fonte da verdade de cada timeline: o usuário edita pela timeline, o Claude edita o arquivo, e a mesma composição (`src/TimelineVideo.tsx`) desenha a prévia e o render.
- A prévia é o Remotion Player empacotado com esbuild em `.previa/previa.js`. Editar a timeline só troca os dados; o pacote é refeito quando `src/` muda.
- Efeitos sob medida ficam em `src/blocos.tsx`, o único arquivo de `src/` que o Claude escreve. Os outros vêm de `src/main/modelo-timeline/`.
- Vídeos que o Chromium não toca (ProRes) ganham uma cópia VP9 em `.cache/proxy/` do projeto só para a prévia; o render usa o original.
- Enquanto o Claude trabalha, a timeline fica travada; quando ele para, o app relê o arquivo e a versão anterior vai para o desfazer.

Recursos de edição, com os nomes de parâmetro no `timeline.json`:

- **Keyframes** (`keyframes`): posição, escala, rotação, opacidade e números dos efeitos, com curvas linear, suave, entrada, saída e segurar.
- **Mesclagem** (`mesclagem`) e **efeitos** (`efeitos`): correção de cor, desfoque, recorte, vinheta, preto e branco, inverter e espelhar.
- **Transições** (`trilha.transicoes`): aba **Transições**, como a do CapCut, com miniaturas animadas por categoria, duração, direção (empurrar, deslizar, chicote e cortina), "Aplicar a todos" e "Remover". Clicar põe na entrada dos selecionados ou no corte sob o cursor; arrastar põe num clipe. As do Filmcraft (dissolver, fades, flash, empurrar, chicote, deslizar, cortina, íris, zoom) e as só do app (`app_*`: desfoque, girar, aproximar, afastar, clarão, glitch, tremer, abrir ao meio, losango, persiana). As do app vão ao Filmcraft como a mais parecida dele e voltam com o tipo do app; o modo rápido do ffmpeg as passa para o Remotion.
- **Atalhos como no Premiere**: Ctrl+K divide, Ctrl+Shift+K divide todas as faixas, Q e W cortam até o cursor e fecham o vão, Ctrl+D põe a transição padrão, M marca (Shift+M e Ctrl+Shift+M andam entre marcadores, que ficam em `marcadores`), ↑ e ↓ vão ao ponto de edição anterior ou seguinte, Alt+setas movem os selecionados um quadro (com Shift, cinco), = e - mudam o zoom e \ ajusta a timeline na tela.
- **Materiais**: a aba ao lado do player lista os arquivos do projeto, com as pastas e subpastas de onde vieram, mais as narrações das outras timelines. Os arquivos ficam todos em `assets/` do projeto e a pasta é o campo `pasta` de cada material. Arrastar para uma trilha adiciona; soltar sobre um clipe substitui o arquivo dele e mantém lugar, efeitos e animações; o botão ⇄ substitui em todos os clipes.
- **Formato**: 9:16, 16:9, 1:1 e 4:5 na barra da timeline. Posições, textos e larguras acompanham o quadro novo.
- **Desativar** (`desativado`): V liga e desliga os clipes selecionados. O clipe fica na timeline, mais escuro, mas some da prévia, do render, do Filmcraft (vai como clipe desligado) e da transcrição.
- **Propriedades como os Controles de efeito do Premiere**: valores azuis que mudam arrastando para os lados (Shift mais rápido, Ctrl mais fino) ou com clique para digitar; posição em pixels a partir do canto (X e Y na mesma linha), escala, velocidade e opacidade em %, rotação em graus; cronômetro liga a animação (cria keyframe no cursor; desligar apaga os keyframes e deixa o valor do cursor); ◀ ◆ ▶ e a curva só aparecem com animação; ↺ redefine cada propriedade.
- **Transformar na prévia**, como no Monitor de programa do Premiere: clicar na imagem seleciona o clipe de cima naquele ponto (efeitos que cobrem o quadro inteiro não roubam o clique). Arrastar move (Shift trava o eixo; perto do centro gruda nele, Ctrl solta), os cantos mudam a escala e a alça de cima gira (Shift: de 15 em 15°). Com keyframes, o arraste grava keyframe no cursor. A caixa mede o que a prévia desenhou (`data-item` e `data-comp-raiz` na composição).
- **Faixas**: botão direito no cabeçalho de uma faixa (ou num espaço vazio dela) cria uma faixa nova do mesmo tipo logo acima ou logo abaixo, como no Premiere, ou exclui a faixa (com clipes, pede confirmação).
- **Ferramentas**: selecionar (A), ripple (B), roll (N), slip (Y), slide (U), velocidade (R) e navalha (C).

## Filmcraft

`src/main/otio.mjs` converte `timeline.json` em OpenTimelineIO e de volta; `src/main/filmcraft.mjs` chama o Filmcraft. "Abrir no Filmcraft" gera `filmcraft/projeto.fcproj` na pasta da timeline; o usuário salva lá e "Trazer" recebe as edições. `timeline.json` segue como a fonte da verdade, e a sincronia acontece nesses dois botões, não em tempo real.

- Vão e voltam: cortes, trilhas, velocidade, volume, keyframes, mesclagem, os efeitos acima e as transições. Na volta, o que não mudou mantém os campos do app (`zoom`, `entrada`, `saida`).
- Só lá: efeitos e modos sem equivalente ficam em `item.filmcraft` e voltam intactos na próxima ida, mas a prévia e o render do app não os desenham, e o app avisa. Tipos de transição desconhecidos viram dissolve na prévia.
- Só aqui: texto, legendas e blocos vão como o vídeo transparente "Camada Remotion", travado e só de referência, e são ignorados na volta.
- As cores são aproximadas: a prévia usa filtros CSS e o Filmcraft usa o Lumetri dele.

## Render

O botão **Renderizar** abre a janela de exportação: nome, pasta, resolução, taxa de bits, codec, formato, fps e áudio. As escolhas ficam salvas para a próxima.

O vídeo final pode sair pelo Filmcraft (padrão, se estiver em `recursos\filmcraft`) ou pelo Remotion, na mesma janela. Pelo Filmcraft, textos, legendas e blocos são renderizados pelo Remotion como uma camada transparente, guardada enquanto não mudam, e ele monta o resto em um passo só. A camada respeita a ordem das trilhas: gráficos abaixo de todos os vídeos (um papel de fundo) vão numa camada por baixo deles, e gráficos em multiplicar ou tela vão numa camada sobre fundo neutro (branco ou preto), misturada com os vídeos nesse modo. O modo rápido faz o mesmo (`graficosDaParte` em `exportar-ffmpeg.mjs`). Se ele falhar, o app exporta pelo Remotion. A prévia ao vivo é sempre do Remotion, e a correção de cor pode ter pequenas diferenças entre os dois.

**Pré-render, como as prévias do Premiere** (modo rápido): cada trecho montado fica guardado em `timelines/<timeline>/.previas/`, com uma chave de tudo o que aparece nele (clipes, efeitos, textos que o cruzam, código da composição, arquivos usados) e das escolhas de exportação. Exportar de novo só monta os trechos que mudaram, e a camada de textos do Remotion é renderizada só no intervalo deles (`renderizarCamadas(..., { intervalo })`); sem mudança nenhuma, só junta as partes e põe o som. Ficam as 80 prévias usadas por último.

Na placa de vídeo, cada clipe que cobre o quadro é reduzido, cortado e tem o tone mapping HDR feito pelo libplacebo (Vulkan), sem a CPU tocar no 4K: num trecho real do iPhone, 7,3 s → 5,0 s. Se o Vulkan falhar, o app volta sozinho ao caminho anterior. Rodar trechos em paralelo foi medido e não compensa (8%): a placa já fica no limite.

Só roda um render por vez. Pedir o mesmo render enquanto ele roda não inicia outro, e pedir de novo sem nada mudar devolve o arquivo pronto.

A composição do Remotion é empacotada uma vez por versão do código da timeline e guardada em `timelines\<timeline>\.render\` (ver `pacote-remotion.mjs`): o webpack só roda de novo quando o código muda, não a cada render. A timeline atual vai por `--props`, e tamanho, fps e duração vêm dela (`calculateMetadata` no `Root.tsx`).

Ao ler a timeline, o app põe clipes de vídeo e imagem na grade de quadros e traz para dentro do arquivo os cortes que passam do fim dele (`limites-fonte.mjs`). As duas coisas davam quadro preto no fim do take. A duração de um vídeo é a da imagem (fluxo de vídeo), não a do contêiner, que no iPhone pode ser maior.

| Modo | Remotion | HyperFrames |
|---|---|---|
| GPU | Chrome com ANGLE (GPU) + codificação final em NVENC ou AMF, H.264 ou HEVC | `--gpu --browser-gpu` |
| CPU | SwiftShader + x264 ou x265, ou ProRes HQ | `--no-browser-gpu` |

O app testa os encoders ao abrir, com uma codificação real, porque o ffmpeg lista NVENC e AMF mesmo sem a placa: usa NVENC, senão AMF (placas AMD), senão CPU. 

A taxa de bits segue a resolução e o fps: o Recomendado em 1080x1920 a 30 fps dá 10 Mbit/s em H.264 e 6 Mbit/s em HEVC. H.264 e HEVC saem em MP4 ou MOV; ProRes, só em MOV.

O Filmcraft não tem codificador de HEVC no Windows: ele monta o vídeo em H.264 com folga de qualidade, e o ffmpeg converte no fim, na placa de vídeo ou, se ela recusar, na CPU.

## Decupar áudios

A aba "Decupar áudios" tira as pausas de narrações (áudio ou vídeo) no estilo do corte à mão no CapCut. O núcleo está em `src/main/decupar-nucleo.mjs`, sem Electron e coberto por `test/decupar.test.mjs`.

- **Voz** (`analisarVoz`): energia em quadros de 10 ms, limiares tirados do ruído e da voz medidos, e periodicidade (cordas vocais) para separar fala de ruído. Uma segunda passada mede ruído e voz só perto da fala: no bruto, as pausas longas baixam o "ruído" e o limiar, e as pausas curtas entre frases sumiam.
- **O que corta** (`pausaCortavel`): pausa a partir de `pausaMinima` (0,15 s), ou a partir de `pausaMinimaFimFrase` (0,10 s) quando a voz cai mais de `quedaFimFrase` (14 dB) nos 150 ms antes dela (fim de frase). Os números vêm de 376 emendas feitas à mão no CapCut em 26 narrações de 11 clientes: cortam 77% delas, contra 34% da regra anterior (pausa de 0,25 s ou mais), com 73% das pausas cortadas coincidindo com cortes do editor. Na VPM 24.11 01, o resultado ficou com 51,4 s, igual ao corte à mão.
- **Emendas** (`calcularSegmentos`, `montarFiltro`): sobrepõem `sobreposicao` (0,2 s) com acrossfade e deixam `pausa` (0,05 s) de respiro. Pausa curta fica inteira, dividida ao meio, e a emenda sobrepõe menos (`segs.sobreposicoes`), para não comer fala.

## Estrutura

- `src/main/` — processo principal: `agente.mjs` (Claude + ferramentas `renderizar` e `ver_quadros`), `render.mjs`, `transcricao.mjs`, `workspace.mjs` (projetos, timelines, scaffold, briefing), `migracao.mjs` (formato antigo para o novo), `presets.mjs` (estilos).
- `src/renderer/` — interface (HTML/CSS/JS puro).
- Os projetos ficam em `Documentos\Claude Video Studio\projetos\`, no formato descrito em [Projetos e timelines](#projetos-e-timelines).
