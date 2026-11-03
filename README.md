# Raio Jaborizador de videos

**Editor Jaborizador da Silva** — app de desktop (Electron) que edita vídeos sozinho com o Claude, usando Remotion ou HyperFrames, com conversor de vídeo próprio (H.264, H.265, AV1 e outros, em CPU ou placa de vídeo).

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

## Timeline

Projetos Remotion têm uma timeline editável com prévia ao vivo, sem precisar renderizar. Projetos HyperFrames seguem pelo chat.

- `timeline.json` no projeto é a fonte da verdade: o usuário edita pela timeline, o Claude edita o arquivo, e a mesma composição (`src/TimelineVideo.tsx`) desenha a prévia e o render.
- A prévia é o Remotion Player empacotado com esbuild em `.previa/previa.js`. Editar a timeline só troca os dados; o pacote é refeito quando `src/` muda.
- Efeitos sob medida ficam em `src/blocos.tsx`, o único arquivo de `src/` que o Claude escreve. Os outros vêm de `src/main/modelo-timeline/`.
- Vídeos que o Chromium não toca (ProRes) ganham uma cópia VP9 em `.previa/proxy/` só para a prévia; o render usa o original.
- Enquanto o Claude trabalha, a timeline fica travada; quando ele para, o app relê o arquivo e a versão anterior vai para o desfazer.

Recursos de edição, com os nomes de parâmetro no `timeline.json`:

- **Keyframes** (`keyframes`): posição, escala, rotação, opacidade e números dos efeitos, com curvas linear, suave, entrada, saída e segurar.
- **Mesclagem** (`mesclagem`) e **efeitos** (`efeitos`): correção de cor, desfoque, recorte, vinheta, preto e branco, inverter e espelhar.
- **Transições** (`trilha.transicoes`): dissolver, fade, flash, empurrar, chicote, deslizar, cortina, íris e zoom.
- **Materiais**: a aba ao lado do player lista os arquivos do projeto, com as pastas e subpastas de onde vieram. Os arquivos ficam todos em `assets/` e a pasta é o campo `pasta` de cada material. Arrastar para uma trilha adiciona; soltar sobre um clipe substitui o arquivo dele e mantém lugar, efeitos e animações; o botão ⇄ substitui em todos os clipes.
- **Formato**: 9:16, 16:9, 1:1 e 4:5 na barra da timeline. Posições, textos e larguras acompanham o quadro novo.
- **Ferramentas**: selecionar (V), ripple (B), roll (N), slip (Y), slide (U), velocidade (R) e navalha (C).

## Filmcraft

`src/main/otio.mjs` converte `timeline.json` em OpenTimelineIO e de volta; `src/main/filmcraft.mjs` chama o Filmcraft. "Abrir no Filmcraft" gera `filmcraft/projeto.fcproj` no projeto; o usuário salva lá e "Trazer" recebe as edições. `timeline.json` segue como a fonte da verdade, e a sincronia acontece nesses dois botões, não em tempo real.

- Vão e voltam: cortes, trilhas, velocidade, volume, keyframes, mesclagem, os efeitos acima e as transições. Na volta, o que não mudou mantém os campos do app (`zoom`, `entrada`, `saida`).
- Só lá: efeitos e modos sem equivalente ficam em `item.filmcraft` e voltam intactos na próxima ida, mas a prévia e o render do app não os desenham, e o app avisa. Tipos de transição desconhecidos viram dissolve na prévia.
- Só aqui: texto, legendas e blocos vão como o vídeo transparente "Camada Remotion", travado e só de referência, e são ignorados na volta.
- As cores são aproximadas: a prévia usa filtros CSS e o Filmcraft usa o Lumetri dele.

## Render

O vídeo final pode sair pelo Filmcraft (padrão, se estiver em `recursos\filmcraft`) ou pelo Remotion, no botão ao lado de GPU/CPU. Pelo Filmcraft, textos, legendas e blocos são renderizados pelo Remotion como uma camada transparente, guardada enquanto não mudam, e ele monta o resto em um passo só. Se ele falhar, o app exporta pelo Remotion. A prévia ao vivo é sempre do Remotion, e a correção de cor pode ter pequenas diferenças entre os dois.

Só roda um render por vez. Pedir o mesmo render enquanto ele roda não inicia outro, e pedir de novo sem nada mudar devolve o arquivo pronto.

| Modo | Remotion | HyperFrames |
|---|---|---|
| GPU | Chrome com ANGLE (GPU) + codificação final em NVENC (`h264_nvenc`) ou AMF (`h264_amf`) | `--gpu --browser-gpu` |
| CPU | SwiftShader + x264 (MP4) ou ProRes HQ (MOV) | `--no-browser-gpu` |

O app testa os encoders ao abrir, com uma codificação real, porque o ffmpeg lista NVENC e AMF mesmo sem a placa: usa NVENC, senão AMF (placas AMD), senão CPU. O AMF usa QP constante 19, com a qualidade do x264 CRF 18 em arquivos cerca de 3x maiores (medido na RX 570).

MOV em GPU sai em H.264 dentro de .mov; ProRes só existe em CPU.

## Estrutura

- `src/main/` — processo principal: `agente.mjs` (Claude + ferramentas `renderizar` e `ver_quadros`), `render.mjs`, `transcricao.mjs`, `workspace.mjs` (projetos, scaffold, briefing), `presets.mjs` (estilos).
- `src/renderer/` — interface (HTML/CSS/JS puro).
- Cada vídeo vira `Documentos\Claude Video Studio\projetos\<id>\` com `assets/`, `BRIEFING.md`, `transcricao.json`, o código da composição e `renders/`.
