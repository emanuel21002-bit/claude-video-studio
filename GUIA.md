# Guia de instalação e uso — Raio Jaborizador de videos

Este guia leva você do zero até o primeiro vídeo pronto. O app (**Editor Jaborizador da Silva**) é um programa de desktop para **Windows 10/11 64 bits**. Ele edita vídeos sozinho com o Claude, usando Remotion ou HyperFrames, e tem um conversor de vídeo próprio.

---

## 1. O que você precisa instalar

| # | O quê | Obrigatório? | Para quê |
|---|---|---|---|
| 1 | **Git** | Sim, para baixar o código | Clonar o repositório |
| 2 | **Node.js 20 ou mais novo** (já inclui o npm) | Sim | Rodar o app, o Remotion e o HyperFrames |
| 3 | **FFmpeg "full build"** | Sim | Converter, cortar e codificar vídeo |
| 4 | **Conta Claude (Pro ou superior) ou chave de API da Anthropic** | Sim | É o Claude que monta e altera os vídeos |
| 5 | **Whisper (whisper.cpp) + modelo** | Opcional | Transcrever a narração e gerar legendas sincronizadas |
| 6 | **Filmcraft** | Opcional | Exportar e editar a timeline fora do app |
| 7 | **Driver de vídeo atualizado** (NVIDIA, AMD ou Intel) | Recomendado | Render e conversão pela placa de vídeo |

Espaço em disco: reserve **cerca de 5 GB** (dependências do app, Remotion, HyperFrames, Chrome dos renders e os vídeos que você gerar). Internet é necessária só na instalação e para o Claude funcionar.

### 1.1 Git

1. Baixe em <https://git-scm.com/download/win> e instale com as opções padrão.
2. Confira num terminal (PowerShell):

```bash
git --version
```

### 1.2 Node.js

1. Baixe a versão **LTS** em <https://nodejs.org> e instale com as opções padrão.
2. Feche e abra o terminal e confira:

```bash
node -v
npm -v
```

O `node -v` deve mostrar `v20` ou maior.

### 1.3 FFmpeg (full build)

Use a versão **full**, porque ela traz os codificadores de placa de vídeo (NVENC, AMF, QSV) e o `libplacebo`, usado em vídeos HDR de celular.

1. Baixe o **`ffmpeg-release-full.7z`** (ou o `.zip` "full") em <https://www.gyan.dev/ffmpeg/builds/>.
2. Extraia em `C:\ffmpeg` (a pasta `bin` fica em `C:\ffmpeg\bin`).
3. Coloque `C:\ffmpeg\bin` no **PATH**:
   - Menu Iniciar → "Editar as variáveis de ambiente do sistema" → **Variáveis de Ambiente** → em *Path* do usuário, **Novo** → `C:\ffmpeg\bin`.
4. Abra um terminal **novo** e confira:

```bash
ffmpeg -version
ffprobe -version
```

Para ver quais codificadores de placa de vídeo o seu FFmpeg tem:

```bash
ffmpeg -hide_banner -encoders | findstr /i "nvenc amf qsv"
```

> O FFmpeg lista NVENC e AMF mesmo sem a placa. O app testa de verdade ao abrir e usa só o que funciona no seu PC.

### 1.4 Conta do Claude

Escolha uma das duas formas:

- **Conta Claude (Pro ou superior):** o app abre o login na primeira vez (passo 3.3). Não precisa instalar o Claude Code separado: o app já traz o motor dele.
- **Chave de API da Anthropic:** crie em <https://console.anthropic.com>, e cole em **Configurações → Chave de API** dentro do app. Se esse campo ficar vazio, o app usa o login da conta Claude.

### 1.5 Whisper (opcional, para legendas sincronizadas)

Sem ele, o app funciona, mas o Claude monta sem legendas com tempo por palavra.

1. Baixe o **whisper.cpp** para Windows em <https://github.com/ggml-org/whisper.cpp/releases> (o pacote com `whisper-cli.exe`). Se a sua placa for AMD ou Intel, prefira a versão **Vulkan**; para NVIDIA, a versão **CUDA**; sem placa compatível, a versão de CPU.
2. Baixe um modelo em <https://huggingface.co/ggerganov/whisper.cpp/tree/main>:
   - `ggml-medium-q5_0.bin` (recomendado: bom e leve) ou `ggml-medium.bin` (mais preciso, maior).
3. Coloque o `whisper-cli.exe` e o modelo na **mesma pasta**, por exemplo `C:\whisper`.
4. No app, em **Configurações**, aponte **Pasta do whisper.cpp** para `C:\whisper` e **Modelo do Whisper** para o nome do arquivo (por exemplo `ggml-medium-q5_0.bin`).

### 1.6 Filmcraft (opcional)

Se quiser exportar pelo Filmcraft, baixe o pacote portátil Windows x64 em <https://github.com/storytold/filmcraft> e coloque `filmcraft.exe` e `filmcraft-cli.exe` em `recursos\filmcraft\` dentro da pasta do projeto. Sem ele, os botões do Filmcraft simplesmente não aparecem e o render sai pelo Remotion.

---

## 2. Baixar e instalar o projeto

Em um terminal, na pasta onde quer guardar o projeto (por exemplo `D:\Repositórios`):

```bash
git clone https://github.com/emanuel21002-bit/Raio-Jaborizador-de-videos.git
cd Raio-Jaborizador-de-videos
npm install
```

O `npm install` baixa o Electron e o motor do Claude. Leva alguns minutos.

---

## 3. Abrir o app pela primeira vez

```bash
npm start
```

Na primeira abertura aparece a tela de **verificação do ambiente**, com uma lista:

| Item | O que significa | Se faltar |
|---|---|---|
| **Conta do Claude** | Login ou chave de API | Clique em **Entrar no Claude** (veja 3.3) |
| **Node.js** | Rodar Remotion e HyperFrames | Reveja o passo 1.2 |
| **FFmpeg** | Mostra se há NVENC/AMF para render por GPU | Reveja o passo 1.3 |
| **Whisper** | Opcional | Passo 1.5 |
| **Remotion + HyperFrames** | Os motores de edição | Clique em **Instalar** (veja 3.2) |

### 3.1 Pasta de trabalho

Os projetos ficam em `Documentos\Claude Video Studio` (o nome da pasta foi mantido para não perder projetos antigos). Dá para trocar em **Configurações → Pasta do workspace**.

### 3.2 Instalar o Remotion e o HyperFrames

Clique em **Instalar**. O app roda um `npm install` na pasta de trabalho, **só na primeira vez**, e leva alguns minutos. Precisa de internet. Na primeira renderização, o Remotion também baixa o navegador dele (Chrome), o que pode demorar um pouco.

### 3.3 Entrar no Claude

1. Clique em **Entrar no Claude**. O app abre o navegador e uma janela preta.
2. No navegador, entre na sua conta Claude e autorize.
3. Copie o código que a página mostrar.
4. Cole o código na janela preta e aperte **Enter**.

Em segundos o item fica verde. Se preferir a chave de API, abra **Configurações** e cole a chave.

Quando todos os itens obrigatórios estiverem verdes, o app abre a tela de criação.

---

## 4. Criar o primeiro vídeo

A criação tem 3 passos.

### Passo 1 — Materiais

Arraste vídeos, fotos, logo e trilha, ou use **Escolher** (arquivos ou pasta). As subpastas são mantidas.

- Vídeos H.265 (HEVC) e outros formatos que o Chrome dos renders não lê bem são **convertidos para H.264 automaticamente** na importação, pelo FFmpeg local. Isso **não gasta tokens do Claude**.
- **Só motion:** pula materiais e narração. O Claude cria tudo em animação a partir da sua descrição e da duração.

### Passo 2 — Narração

Solte as pastas ou os áudios da narração.

- Cada narração vira **um vídeo**, com os mesmos materiais. Eles são montados **um de cada vez**.
- Uma pasta é uma narração: os áudios dela são unidos na ordem dos nomes.
- Se o Whisper estiver configurado, a narração é transcrita com tempo por palavra.
- Marque **sem narração** se o vídeo não tiver fala.

### Passo 3 — Estilo

- Escolha um estilo. **Passe o mouse sobre o card** para ver uma prévia animada de 8 segundos (sem som).
- Escolha a **engine** (Remotion ou HyperFrames) e o **formato** (9:16, 16:9, 1:1 ou 4:5).
- **Material de referência (opcional):** solte um vídeo ou imagem no jeito que você quer. O Claude estuda o ritmo dos cortes, as legendas, as cores e os efeitos e faz parecido com os seus materiais. Funciona com qualquer estilo.
- **Detalhes do estilo:** escreva pedidos extras, por exemplo "legendas amarelas, cortes rápidos, terminar com o logo".
- **Salvar estilo:** marque para o Claude guardar o resultado como um novo estilo reutilizável.
- Clique em **Criar vídeo com o Claude**.

---

## 5. Editar depois de montar

- **Projetos (barra lateral):** cada projeto é uma **pasta** com uma ou mais **timelines**. Os vídeos criados juntos a partir de várias narrações ficam na mesma pasta, e as timelines aparecem como abas acima do player.
- **Chat com o Claude:** peça alterações em português ("deixe os cortes mais rápidos", "troque a cor da legenda"). No topo do chat há um seletor para **trocar o modelo do Claude** (Opus, Sonnet, Haiku ou Fable); vale a partir da próxima mensagem.
- **Timeline (projetos Remotion):** edição manual com prévia ao vivo e atalhos V (selecionar), B (ripple), N (roll), Y (slip), U (slide), R (velocidade) e C (navalha). Enquanto o Claude trabalha, a timeline fica travada para as edições não se atropelarem.
- **Render:** escolha **GPU** ou **CPU** e **MP4** ou **MOV**. O app usa NVENC (NVIDIA), senão AMF (AMD), senão CPU. Só roda um render por vez. Os vídeos prontos ficam na pasta `renders` do projeto.

---

## 6. Conversor de vídeos (sem Claude)

No botão **Converter vídeos** da barra lateral. Roda só no FFmpeg da sua máquina e **não gasta tokens**.

1. Solte os vídeos (ou **Selecionar vídeos**).
2. Escolha o **formato** (MP4, MOV ou MKV).
3. Escolha o **codificador de vídeo**, como no HandBrake:
   - **CPU:** H.264 (x264), H.265 (x265), AV1 (SVT-AV1), VP9, VP8, MPEG-4, MPEG-2 e Theora.
   - **Placa de vídeo:** H.264, H.265 e AV1 em NVIDIA NVENC, AMD VCN (AMF) e Intel QSV. A lista só mostra o que o seu PC realmente consegue usar.
4. Ajuste **qualidade** (RF: nos codificadores de CRF, menor é melhor), **velocidade** (Rápido, Equilibrado ou Melhor compressão) e **áudio** (AAC, Opus, AC3, MP3, FLAC, Vorbis ou copiar o original).
5. Escolha a pasta de saída (ou deixe na mesma do original) e clique em **Converter**.

Combinações que não existem ficam bloqueadas (por exemplo, AV1 em MOV). Vídeos HDR de celular saem convertidos para cores normais (SDR).

---

## 7. Gerar o instalador (opcional)

Para ter um `.exe` com atalhos:

```bash
npm run dist
```

Sai em `dist\`. O instalador completo leva a pasta `recursos\` (FFmpeg, Node, Whisper, engines e skills) montada à mão, descrita no `README.md`. Sem a pasta `recursos\`, o instalador funciona, mas depende de tudo o que o passo 1 pede.

---

## 8. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `ffmpeg não é reconhecido` | FFmpeg fora do PATH | Refaça o passo 1.3 e abra um terminal novo |
| Item "FFmpeg" sem GPU | Sem NVENC/AMF/QSV funcionando | Atualize o driver de vídeo; o render por CPU continua funcionando |
| "Conta do Claude" não fica verde | Código do login não foi colado | Repita o passo 3.3 ou use a chave de API |
| Instalar o Remotion falha | Sem internet ou antivírus bloqueando o npm | Verifique a conexão e rode **Instalar** de novo |
| Legendas sem sincronia | Whisper não configurado | Passo 1.5 |
| Prévias dos estilos não animam | Nada a fazer: elas tocam só com o mouse sobre o card | Passe o mouse sobre o card |
| Render muito lento | Modo CPU | Escolha GPU no botão ao lado do render |

Se algo não estiver nesta lista, copie a mensagem de erro do app (ou do terminal onde rodou `npm start`) e abra uma *issue* no repositório.
