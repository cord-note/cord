import type { LoginScene } from '@shared/types';
import { fieldShader, MARK_SHADER, VERTEX_SHADER } from './glsl';

/**
 * Draws one scene onto a canvas with WebGL, in two passes: the scene's shader
 * works out a brightness per cell into a texture, then the shared mark pass
 * ordered-dithers it into marks. Used by the lock screen and by the previews
 * in settings.
 */

type Rgb = [number, number, number];

/** The theme's scene colours, resolved to 0–1 RGB. */
export interface SceneTones {
  shade: Rgb;
  mid: Rgb;
  light: Rgb;
  invert: boolean;
}

/** A scene whose frame takes longer than this is too heavy to keep. */
const MAX_FRAME_MS = 60;

let probe: CanvasRenderingContext2D | null = null;

/** Resolves any CSS colour (color-mix, oklch, …) to 0–1 RGB by painting it. */
function toRgb(color: string): Rgb {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) return [0.5, 0.5, 0.5];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [(r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255];
}

/** The `--dither-scene-*` tokens as they apply to `el`. */
export function readTones(el: Element): SceneTones {
  const css = getComputedStyle(el);
  const tone = (name: string, fallback: string): Rgb => toRgb(css.getPropertyValue(name).trim() || fallback);
  return {
    shade: tone('--dither-scene-shade', '#444'),
    mid: tone('--dither-scene-mid', '#777'),
    light: tone('--dither-scene-light', '#ddd'),
    invert: css.getPropertyValue('--dither-scene-invert').trim() === '1',
  };
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function link(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** Ten digits in a row, one cell each, white on transparent. */
function glyphAtlas(cellPx: number, font: string): HTMLCanvasElement {
  const atlas = document.createElement('canvas');
  atlas.width = cellPx * 10;
  atlas.height = cellPx;
  const ctx = atlas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(cellPx * 0.95)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 10; d++) ctx.fillText(String(d), d * cellPx + cellPx / 2, cellPx / 2 + 0.5);
  }
  return atlas;
}

export class SceneRenderer {
  private cols = 1;
  private rows = 1;
  private cellPx = 1;

  private constructor(
    private readonly gl: WebGLRenderingContext,
    private readonly canvas: HTMLCanvasElement,
    private readonly scene: LoginScene,
    private readonly field: WebGLProgram,
    private readonly marks: WebGLProgram,
    private readonly fieldTex: WebGLTexture,
    private readonly glyphTex: WebGLTexture,
    private readonly framebuffer: WebGLFramebuffer,
    private readonly buffer: WebGLBuffer,
  ) {}

  /**
   * Sets up `scene` on `canvas`. 'no-webgl' when the canvas cannot draw at
   * all; 'bad-scene' when the scene's shader does not compile.
   */
  static create(canvas: HTMLCanvasElement, scene: LoginScene, seed: number, options: WebGLContextAttributes = {}): SceneRenderer | 'no-webgl' | 'bad-scene' {
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, ...options });
    if (!gl) return 'no-webgl';
    const marks = link(gl, MARK_SHADER);
    const fieldTex = gl.createTexture();
    const glyphTex = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    const buffer = gl.createBuffer();
    if (!marks || !fieldTex || !glyphTex || !framebuffer || !buffer) return 'no-webgl';
    const field = link(gl, fieldShader(scene.source));
    if (!field) return 'bad-scene';

    // One triangle that covers the viewport, shared by both passes.
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const program of [field, marks]) {
      const aPos = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    }
    for (const tex of [fieldTex, glyphTex]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    const r = new SceneRenderer(gl, canvas, scene, field, marks, fieldTex, glyphTex, framebuffer, buffer);
    gl.useProgram(field);
    gl.uniform1f(r.at(field, 'uSeed'), seed);
    gl.useProgram(marks);
    gl.uniform1i(r.at(marks, 'uField'), 0);
    gl.uniform1i(r.at(marks, 'uGlyphs'), 1);
    gl.uniform1f(r.at(marks, 'uGlyph'), scene.marks === 'glyph' ? 1 : 0);
    return r;
  }

  private at(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(program, name);
  }

  setTones(tones: SceneTones): void {
    const { gl, marks } = this;
    gl.useProgram(marks);
    gl.uniform3fv(this.at(marks, 'uShade'), tones.shade);
    gl.uniform3fv(this.at(marks, 'uMid'), tones.mid);
    gl.uniform3fv(this.at(marks, 'uLight'), tones.light);
    gl.uniform1f(this.at(marks, 'uInvert'), tones.invert ? 1 : 0);
  }

  /** Sizes the canvas to cover `width` × `height` CSS pixels in whole cells. */
  resize(width: number, height: number, dpr: number): void {
    const { gl, canvas, scene, field, marks } = this;
    this.cellPx = Math.max(1, Math.round(scene.cell * dpr));
    this.cols = Math.max(1, Math.ceil((width * dpr) / this.cellPx));
    this.rows = Math.max(1, Math.ceil((height * dpr) / this.cellPx));
    canvas.width = this.cols * this.cellPx;
    canvas.height = this.rows * this.cellPx;
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;

    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fieldTex, 0);
    if (scene.marks === 'glyph') {
      const font = getComputedStyle(canvas).getPropertyValue('--font-mono').trim() || 'monospace';
      gl.bindTexture(gl.TEXTURE_2D, this.glyphTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glyphAtlas(this.cellPx, font));
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }

    // Scene units: the shorter side, with slack for wide surfaces.
    gl.useProgram(field);
    gl.uniform2f(this.at(field, 'uRes'), this.cols, this.rows);
    gl.uniform1f(this.at(field, 'uUnit'), Math.min(this.rows, this.cols * 1.2));
    gl.useProgram(marks);
    gl.uniform2f(this.at(marks, 'uCells'), this.cols, this.rows);
    gl.uniform1f(this.at(marks, 'uCellPx'), this.cellPx);
  }

  /** Draws the frame at `time` seconds. */
  draw(time: number): void {
    const { gl, field, marks } = this;
    if (gl.isContextLost()) return;
    gl.useProgram(field);
    gl.uniform1f(this.at(field, 'uTime'), time);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(marks);
    gl.uniform1f(this.at(marks, 'uTime'), time);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.cols * this.cellPx, this.rows * this.cellPx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Times a warm frame; true when the scene is too heavy to keep redrawing. */
  tooSlow(time: number): boolean {
    const pixel = new Uint8Array(4);
    this.draw(time);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    const t0 = performance.now();
    this.draw(time);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return performance.now() - t0 > MAX_FRAME_MS;
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteBuffer(this.buffer);
    gl.deleteTexture(this.fieldTex);
    gl.deleteTexture(this.glyphTex);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteProgram(this.field);
    gl.deleteProgram(this.marks);
  }
}

/**
 * A still frame of `scene` as an image URL, drawn on a throwaway canvas whose
 * GL context is released at once, so many previews never pile up contexts.
 * Null when it cannot be drawn.
 */
export function renderPreview(scene: LoginScene, width: number, height: number, tones: SceneTones): string | null {
  const canvas = document.createElement('canvas');
  const renderer = SceneRenderer.create(canvas, scene, 7, { preserveDrawingBuffer: true });
  if (typeof renderer === 'string') return null;
  try {
    renderer.setTones(tones);
    renderer.resize(width, height, window.devicePixelRatio || 1);
    // A few seconds in, so moving parts (a beam, a plane) have come into view.
    renderer.draw(3);
    return canvas.toDataURL();
  } finally {
    renderer.dispose();
    canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
