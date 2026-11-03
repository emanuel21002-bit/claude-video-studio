// Renderiza build/icone.html em build/icon.png (512x512, fundo transparente).
// Rodar com: npx electron build/gerar-icone.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

app.whenReady().then(async () => {
  const w = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await w.loadFile(path.join(aqui, 'icone.html'));
  await new Promise((r) => setTimeout(r, 500));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(aqui, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  app.quit();
});
