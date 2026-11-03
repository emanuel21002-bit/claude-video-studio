# Claude Video Studio

App de desktop (Electron) que edita vídeos sozinho com o Claude, usando Remotion ou HyperFrames.

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
| `bin\` | `node.exe`, `ffmpeg.exe`, `ffprobe.exe` (full build, com NVENC e libplacebo) — entram na frente do PATH |
| `whisper\` | `whisper-cli.exe` e DLLs de CPU do whisper.cpp, runtime do Visual C++, `ggml-medium-q5_0.bin` |
| `engines\node_modules\` | Remotion + HyperFrames já instalados (com o Chrome do Remotion em `.remotion`) |
| `chrome-hyperframes\` | Chrome do HyperFrames, copiado para `~\.cache\hyperframes\chrome` |
| `skills\` | skills de edição copiadas para o workspace (sem a lista de clientes) |

Na primeira abertura o app copia as engines e as skills para `Documentos\Claude Video Studio`, sem internet. Quem for usar só precisa entrar com a própria conta Claude (Pro ou superior) ou colar uma chave de API.

## Timeline

Projetos Remotion têm uma timeline editável com prévia ao vivo, sem precisar renderizar. Projetos HyperFrames seguem pelo chat.

- `timeline.json` no projeto é a fonte da verdade: o usuário edita pela timeline, o Claude edita o arquivo, e a mesma composição (`src/TimelineVideo.tsx`) desenha a prévia e o render.
- A prévia é o Remotion Player empacotado com esbuild em `.previa/previa.js`. Editar a timeline só troca os dados; o pacote é refeito quando `src/` muda.
- Efeitos sob medida ficam em `src/blocos.tsx`, o único arquivo de `src/` que o Claude escreve. Os outros vêm de `src/main/modelo-timeline/`.
- Vídeos que o Chromium não toca (ProRes) ganham uma cópia VP9 em `.previa/proxy/` só para a prévia; o render usa o original.
- Enquanto o Claude trabalha, a timeline fica travada; quando ele para, o app relê o arquivo e a versão anterior vai para o desfazer.

## Render

| Modo | Remotion | HyperFrames |
|---|---|---|
| GPU | Chrome com ANGLE (GPU) + codificação final em NVENC (`h264_nvenc`) | `--gpu --browser-gpu` |
| CPU | SwiftShader + x264 (MP4) ou ProRes HQ (MOV) | `--no-browser-gpu` |

MOV em GPU sai em H.264 dentro de .mov; ProRes só existe em CPU.

## Estrutura

- `src/main/` — processo principal: `agente.mjs` (Claude + ferramentas `renderizar` e `ver_quadros`), `render.mjs`, `transcricao.mjs`, `workspace.mjs` (projetos, scaffold, briefing), `presets.mjs` (estilos).
- `src/renderer/` — interface (HTML/CSS/JS puro).
- Cada vídeo vira `Documentos\Claude Video Studio\projetos\<id>\` com `assets/`, `BRIEFING.md`, `transcricao.json`, o código da composição e `renders/`.
