import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Img, OffthreadVideo, continueRender, delayRender } from 'remotion';

// LUTs 3D (.cube) aplicadas na prévia e no render do Remotion, como o Lumetri do Filmcraft faz com "LUT de entrada".
// Um contexto WebGL só, compartilhado por todos os clipes (o Chrome limita quantos contextos uma página tem): ele
// processa o quadro e o resultado é copiado para o canvas 2D de cada clipe.
// Este arquivo é mantido pelo app.

export type PedidoLut = { url: string; intensidade: number };
type Dados = { n: number; texels: Uint8Array };

const cacheDados = new Map<string, Promise<Dados | null>>();

// .cube: LUT_3D_SIZE N e N³ linhas "r g b", com o vermelho variando mais rápido. Domínio 0 a 1.
export function lerCube(texto: string): Dados | null {
  let n = 0;
  const v: number[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const l = bruta.trim();
    if (!l || l[0] === '#') continue;
    const p = l.split(/\s+/);
    if (p[0] === 'LUT_3D_SIZE') {
      n = parseInt(p[1], 10);
      continue;
    }
    if (/^[A-Za-z_]/.test(p[0])) continue;
    if (p.length >= 3) v.push(Number(p[0]), Number(p[1]), Number(p[2]));
  }
  if (!n || n < 2 || n > 96 || v.length < n * n * n * 3) return null;
  // Textura 2D de N² x N: a fatia de azul b fica em x = b*N .. b*N+N-1; dentro dela x = vermelho, y = verde.
  const texels = new Uint8Array(n * n * n * 4);
  const b8 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const o = (r + g * n + b * n * n) * 3;
        const d = (g * n * n + b * n + r) * 4;
        texels[d] = b8(v[o]);
        texels[d + 1] = b8(v[o + 1]);
        texels[d + 2] = b8(v[o + 2]);
        texels[d + 3] = 255;
      }
  return { n, texels };
}

function carregarDados(url: string) {
  if (!cacheDados.has(url)) {
    cacheDados.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.text() : ''))
        .then((t) => (t ? lerCube(t) : null))
        .catch(() => null),
    );
  }
  return cacheDados.get(url)!;
}

// ---------- motor WebGL compartilhado ----------

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x+1.0)*0.5, (1.0-p.y)*0.5); gl_Position = vec4(p,0.0,1.0); }`;
const FRAG = `precision highp float;
varying vec2 uv;
uniform sampler2D img;
uniform sampler2D lut0; uniform sampler2D lut1; uniform sampler2D lut2;
uniform vec3 n; uniform vec3 mixes; uniform int qtd;
vec3 aplicar(sampler2D l, float N, vec3 c){
  c = clamp(c, 0.0, 1.0);
  float b = c.b * (N - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, N - 1.0);
  float x = (c.r * (N - 1.0) + 0.5) / (N * N);
  float y = (c.g * (N - 1.0) + 0.5) / N;
  vec3 a = texture2D(l, vec2(x + b0 / N, y)).rgb;
  vec3 d = texture2D(l, vec2(x + b1 / N, y)).rgb;
  return mix(a, d, b - b0);
}
void main(){
  vec4 c = texture2D(img, uv);
  vec3 r = c.rgb;
  if (qtd > 0) r = mix(r, aplicar(lut0, n.x, r), mixes.x);
  if (qtd > 1) r = mix(r, aplicar(lut1, n.y, r), mixes.y);
  if (qtd > 2) r = mix(r, aplicar(lut2, n.z, r), mixes.z);
  gl_FragColor = vec4(r, c.a);
}`;

type Motor = { gl: WebGLRenderingContext; canvas: HTMLCanvasElement; prog: WebGLProgram; img: WebGLTexture; luts: WeakMap<Dados, WebGLTexture> };
let motor: Motor | null | undefined;

function iniciarMotor(): Motor | null {
  if (motor !== undefined) return motor;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return (motor = null);
    const sh = (tipo: number, src: string) => {
      const s = gl.createShader(tipo)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const textura = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
    ['lut0', 'lut1', 'lut2'].forEach((u, i) => gl.uniform1i(gl.getUniformLocation(prog, u), i + 1));
    motor = { gl, canvas, prog, img: textura(), luts: new WeakMap() };
    (motor as any).textura = textura;
    return motor;
  } catch {
    return (motor = null);
  }
}

const tamanhoDe = (f: any): [number, number] => [f.videoWidth || f.naturalWidth || f.displayWidth || f.width || 0, f.videoHeight || f.naturalHeight || f.displayHeight || f.height || 0];

// Processa o quadro com as LUTs e copia para o canvas do clipe. Sem WebGL, copia sem LUT.
export function desenharComLuts(destino: HTMLCanvasElement, fonte: CanvasImageSource, luts: { dados: Dados; mix: number }[]) {
  const [w, h] = tamanhoDe(fonte);
  if (!w || !h) return;
  if (destino.width !== w || destino.height !== h) {
    destino.width = w;
    destino.height = h;
  }
  const ctx = destino.getContext('2d');
  if (!ctx) return;
  const m = iniciarMotor();
  const usadas = luts.filter((l) => l.mix > 0).slice(0, 3);
  if (!m || !usadas.length) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(fonte, 0, 0, w, h);
    return;
  }
  const { gl, prog } = m;
  if (m.canvas.width !== w || m.canvas.height !== h) {
    m.canvas.width = w;
    m.canvas.height = h;
  }
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, m.img);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fonte as any);
  const ns = [2, 2, 2];
  const mixes = [0, 0, 0];
  usadas.forEach((l, i) => {
    let t = m.luts.get(l.dados);
    gl.activeTexture(gl.TEXTURE1 + i);
    if (!t) {
      t = (m as any).textura() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, l.dados.n * l.dados.n, l.dados.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, l.dados.texels);
      m.luts.set(l.dados, t);
    } else gl.bindTexture(gl.TEXTURE_2D, t);
    ns[i] = l.dados.n;
    mixes[i] = Math.max(0, Math.min(2, l.mix));
  });
  gl.uniform3f(gl.getUniformLocation(prog, 'n'), ns[0], ns[1], ns[2]);
  gl.uniform3f(gl.getUniformLocation(prog, 'mixes'), mixes[0], mixes[1], mixes[2]);
  gl.uniform1i(gl.getUniformLocation(prog, 'qtd'), usadas.length);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(m.canvas, 0, 0, w, h);
}

// Espera do render (delayRender) que só termina quando o quadro já foi desenhado com a LUT.
function useEspera(rotulo: string) {
  const h = useRef<number | null>(null);
  const abrir = () => {
    if (h.current == null) h.current = delayRender(rotulo);
  };
  const fechar = () => {
    if (h.current != null) continueRender(h.current);
    h.current = null;
  };
  useEffect(() => fechar, []);
  return { abrir, fechar };
}

// Carrega as LUTs pedidas e devolve os dados prontos. O render espera (ver useEspera nos componentes).
function useLuts(pedidos: PedidoLut[], espera: { abrir: () => void }) {
  const chave = pedidos.map((p) => p.url).join('|');
  const [dados, setDados] = useState<Record<string, Dados | null>>({});
  if (pedidos.some((p) => !(p.url in dados))) espera.abrir();
  useEffect(() => {
    const faltam = pedidos.map((p) => p.url).filter((u) => !(u in dados));
    if (!faltam.length) return;
    let vivo = true;
    Promise.all(faltam.map((u) => carregarDados(u).then((d) => [u, d] as const))).then((lidos) => {
      if (vivo) setDados((a) => ({ ...a, ...Object.fromEntries(lidos) }));
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  const prontas = pedidos.every((p) => p.url in dados);
  const lista = useMemo(
    () => pedidos.flatMap((p) => (dados[p.url] ? [{ dados: dados[p.url] as Dados, mix: p.intensidade / 100 }] : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dados, chave, pedidos.map((p) => p.intensidade).join('|')],
  );
  return { prontas, lista };
}

// Vídeo com LUT: o OffthreadVideo segue tocando escondido e entrega cada quadro, que vai para o canvas já com a LUT.
export function VideoComLut({ luts, style, ...props }: { luts: PedidoLut[]; style: React.CSSProperties } & React.ComponentProps<typeof OffthreadVideo>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ultimo = useRef<CanvasImageSource | null>(null);
  const espera = useEspera('LUT do vídeo');
  const { prontas, lista } = useLuts(luts, espera);
  const listaRef = useRef(lista);
  listaRef.current = lista;
  const prontasRef = useRef(prontas);
  prontasRef.current = prontas;
  const aoQuadro = useCallback((f: CanvasImageSource) => {
    ultimo.current = f;
    if (canvas.current) desenharComLuts(canvas.current, f, listaRef.current);
    if (prontasRef.current) espera.fechar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // LUT carregada ou trocada com a prévia parada: refaz o último quadro.
  useEffect(() => {
    if (!prontas) return;
    if (ultimo.current && canvas.current) {
      desenharComLuts(canvas.current, ultimo.current, lista);
      espera.fechar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prontas, lista]);
  return (
    <>
      <OffthreadVideo {...props} style={{ ...style, position: 'absolute', opacity: 0 }} onVideoFrame={aoQuadro} />
      <canvas ref={canvas} style={style} />
    </>
  );
}

export function ImagemComLut({ luts, src, style }: { luts: PedidoLut[]; src: string; style: React.CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [carregada, setCarregada] = useState(false);
  const espera = useEspera('LUT da imagem');
  if (!carregada) espera.abrir();
  const { prontas, lista } = useLuts(luts, espera);
  useEffect(() => {
    if (carregada && prontas && img.current && canvas.current) {
      desenharComLuts(canvas.current, img.current, lista);
      espera.fechar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregada, prontas, lista]);
  return (
    <>
      <Img ref={img} src={src} style={{ ...style, position: 'absolute', opacity: 0 }} onLoad={() => setCarregada(true)} onError={() => espera.fechar()} />
      <canvas ref={canvas} style={style} />
    </>
  );
}
