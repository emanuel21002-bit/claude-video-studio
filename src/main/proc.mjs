import { spawn } from 'node:child_process';

// Roda um processo e entrega cada linha de saída (stdout + stderr) para onLinha.
// Resolve com { codigo, cauda } — cauda são as últimas linhas, para mensagens de erro.
export function rodar(cmd, args, { cwd, env, onLinha, sinal, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      windowsHide: true,
    });
    const cauda = [];
    let resto = '';
    const ler = (buf) => {
      const texto = resto + buf.toString();
      const linhas = texto.split(/\r?\n|\r/);
      resto = linhas.pop();
      for (const l of linhas) {
        if (!l.trim()) continue;
        cauda.push(l);
        if (cauda.length > 40) cauda.shift();
        onLinha?.(l);
      }
    };
    filho.stdout.on('data', ler);
    filho.stderr.on('data', ler);
    filho.on('error', reject);
    filho.on('close', (codigo) => {
      if (resto.trim()) {
        cauda.push(resto);
        onLinha?.(resto);
      }
      resolve({ codigo, cauda: cauda.join('\n') });
    });
    sinal?.addEventListener('abort', () => {
      // No Windows kill() só encerra o processo direto: o Chrome e o ffmpeg do render ficariam presos à GPU.
      if (process.platform === 'win32' && filho.pid) spawn('taskkill', ['/T', '/F', '/PID', String(filho.pid)], { windowsHide: true, stdio: 'ignore' });
      else filho.kill();
    });
  });
}

export async function rodarOuFalhar(cmd, args, opts = {}) {
  const r = await rodar(cmd, args, opts);
  if (r.codigo !== 0) {
    throw new Error(`${cmd} saiu com código ${r.codigo}\n${r.cauda}`);
  }
  return r;
}
