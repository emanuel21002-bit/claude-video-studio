// Tira quadros da composição sem renderizar o vídeo. Roda fora do Electron, com o Node e os pacotes do workspace.
// Argumento: caminho de um JSON { ws, entrada, publica, pacote, refazer, timeline, quadros: [n], escala, saida }.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const o = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const doWs = createRequire(path.join(o.ws, 'package.json'));
const { bundle } = doWs('@remotion/bundler');
const { selectComposition, renderStill, openBrowser } = doWs('@remotion/renderer');

function ligarTudo(de, para) {
  fs.mkdirSync(para, { recursive: true });
  for (const e of fs.readdirSync(de, { withFileTypes: true })) {
    const a = path.join(de, e.name);
    const b = path.join(para, e.name);
    if (e.isDirectory()) ligarTudo(a, b);
    else {
      fs.rmSync(b, { force: true });
      try {
        fs.linkSync(a, b);
      } catch {
        fs.copyFileSync(a, b);
      }
    }
  }
}

(async () => {
  // O pacote só é refeito quando o código muda; a timeline chega por inputProps. A pasta pública entra por link.
  if (o.refazer || !fs.existsSync(path.join(o.pacote, 'index.html'))) {
    fs.rmSync(o.pacote, { recursive: true, force: true });
    const vazia = o.pacote + '-vazia';
    fs.mkdirSync(vazia, { recursive: true });
    await bundle({ entryPoint: o.entrada, publicDir: vazia, outDir: o.pacote, rootDir: o.ws, enableCaching: true });
    fs.rmSync(vazia, { recursive: true, force: true });
  }
  ligarTudo(o.publica, path.join(o.pacote, 'public'));
  const inputProps = { timeline: o.timeline };
  const browser = await openBrowser('chrome', { chromiumOptions: { gl: 'angle' } });
  try {
    const composition = await selectComposition({ serveUrl: o.pacote, id: 'Main', inputProps, puppeteerInstance: browser });
    for (const frame of o.quadros) {
      await renderStill({
        composition: { ...composition, width: o.timeline.largura, height: o.timeline.altura },
        serveUrl: o.pacote, frame: Math.min(frame, composition.durationInFrames - 1), inputProps,
        output: path.join(o.saida, `q${String(frame).padStart(6, '0')}.jpg`), imageFormat: 'jpeg', jpegQuality: 80,
        scale: o.escala, puppeteerInstance: browser, timeoutInMilliseconds: 120000, overwrite: true,
      });
    }
  } finally {
    await browser.close({ silent: true });
  }
})().catch((e) => {
  console.error(String(e?.stack ?? e).slice(0, 1500));
  process.exit(1);
});
