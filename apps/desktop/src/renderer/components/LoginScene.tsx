import { useEffect, useMemo, useRef, useState } from 'react';
import type { LoginScene as Scene } from '@shared/types';
import Dither from './Dither';
import { fieldShader, MARK_SHADER, VERTEX_SHADER } from './scenes/glsl';
import { loadBlocked, pickScene, saveBlocked, sceneKey } from './scenes/pick';
import styles from './LoginScene.module.css';

/**
 * The animated dither picture on the lock screen. Picks one scene at random
 * from `scenes` each time it appears and keeps it while on screen.
 *
 * Drawn by WebGL in two passes: the scene's shader works out a brightness per
 * cell, then a shared pass ordered-dithers that into marks (see
 * `scenes/glsl.ts`), so every scene has the same look. Colours come from the
 * `--dither-scene-*` tokens and follow theme changes.
 *
 * Theme scenes are untrusted: one that fails to compile, draws too slowly or
 * loses the GPU context is skipped from then on. Without WebGL, or with no
 * scene left, it falls back to the plain canvas dither. Decorative only.
 */

interface LoginSceneProps {
  scenes: readonly Scene[];
  /** Ids of the built-in scenes; only theme scenes are remembered as broken. */
  builtinIds: ReadonlySet<string>;
  /** Ignored when the OS asks for reduced motion. */
  animate?: boolean;
  className?: string;
}

/** A scene whose frame takes longer than this is too heavy to keep. */
const MAX_FRAME_MS = 60;
/** uTime wraps so scene maths stays precise. */
const TIME_WRAP_S = 4 * 60 * 60;

type Rgb = [number, number, number];

/** Resolves any CSS colour (color-mix, oklch, …) to 0–1 RGB by painting it. */
function toRgb(probe: CanvasRenderingContext2D, color: string): Rgb {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [(r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255];
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

export default function LoginScene({ scenes, builtinIds, animate = true, className }: LoginSceneProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [noWebgl, setNoWebgl] = useState(false);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(loadBlocked);
  // Bumped when a lost GPU context comes back, to rebuild on a fresh canvas.
  const [generation, setGeneration] = useState(0);

  const available = useMemo(() => scenes.filter((s) => !blocked.has(sceneKey(s))), [scenes, blocked]);
  const [scene, setScene] = useState<Scene | null>(() => pickScene(available));

  // Keep the scene while it is still on offer, so it never swaps mid-PIN.
  useEffect(() => {
    if (!scene || !available.some((s) => s.id === scene.id)) setScene(pickScene(available));
  }, [available, scene]);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || !scene || noWebgl) return;
    const current = scene;
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false });
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!gl || !probe) {
      setNoWebgl(true);
      return;
    }

    /** Never show this scene again (theme scenes) or this session (built-ins). */
    function reject(): void {
      setBlocked((prev) => {
        const next = new Set(prev).add(sceneKey(current));
        if (!builtinIds.has(current.id)) saveBlocked(new Set([...loadBlocked(), sceneKey(current)]));
        return next;
      });
    }

    const field = link(gl, fieldShader(current.source));
    const marks = link(gl, MARK_SHADER);
    const fieldTex = gl.createTexture();
    const glyphTex = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    const buffer = gl.createBuffer();
    if (!marks || !fieldTex || !glyphTex || !framebuffer || !buffer) {
      setNoWebgl(true);
      return;
    }
    if (!field) {
      reject();
      return;
    }

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

    const at = (program: WebGLProgram, name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
    gl.useProgram(field);
    gl.uniform1f(at(field, 'uSeed'), 1 + Math.floor(Math.random() * 100));
    gl.useProgram(marks);
    gl.uniform1i(at(marks, 'uField'), 0);
    gl.uniform1i(at(marks, 'uGlyphs'), 1);
    gl.uniform1f(at(marks, 'uGlyph'), current.marks === 'glyph' ? 1 : 0);

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const started = performance.now();
    let cols = 1;
    let rows = 1;
    let cellPx = 1;
    let timer = 0;
    let visible = true;
    let checked = false;

    function setTones(): void {
      if (!gl || !probe || !marks) return;
      const css = getComputedStyle(canvas!);
      const tone = (name: string, fallback: string): Rgb => toRgb(probe, css.getPropertyValue(name).trim() || fallback);
      gl.useProgram(marks);
      gl.uniform3fv(at(marks, 'uShade'), tone('--dither-scene-shade', '#444'));
      gl.uniform3fv(at(marks, 'uMid'), tone('--dither-scene-mid', '#777'));
      gl.uniform3fv(at(marks, 'uLight'), tone('--dither-scene-light', '#ddd'));
      gl.uniform1f(at(marks, 'uInvert'), css.getPropertyValue('--dither-scene-invert').trim() === '1' ? 1 : 0);
    }

    function draw(): void {
      if (!gl || !field || !marks || gl.isContextLost()) return;
      const time = animate && !motion.matches ? ((performance.now() - started) / 1000) % TIME_WRAP_S : 0;
      gl.useProgram(field);
      gl.uniform1f(at(field, 'uTime'), time);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, cols, rows);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(marks);
      gl.uniform1f(at(marks, 'uTime'), time);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cols * cellPx, rows * cellPx);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glyphTex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /** Times a warm frame; a scene too heavy to redraw is dropped. */
    function tooSlow(): boolean {
      if (!gl) return false;
      const pixel = new Uint8Array(4);
      draw();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const t0 = performance.now();
      draw();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return performance.now() - t0 > MAX_FRAME_MS;
    }

    // Whole device pixels per cell, so the marks stay crisp.
    function resize(): void {
      if (!gl || !box || !canvas || !field || !marks) return;
      const rect = box.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cellPx = Math.max(1, Math.round(current.cell * dpr));
      cols = Math.max(1, Math.ceil((rect.width * dpr) / cellPx));
      rows = Math.max(1, Math.ceil((rect.height * dpr) / cellPx));
      canvas.width = cols * cellPx;
      canvas.height = rows * cellPx;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;

      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
      if (current.marks === 'glyph') {
        const font = getComputedStyle(canvas).getPropertyValue('--font-mono').trim() || 'monospace';
        gl.bindTexture(gl.TEXTURE_2D, glyphTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glyphAtlas(cellPx, font));
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      }

      // Scene units: the shorter side, with slack for wide surfaces.
      gl.useProgram(field);
      gl.uniform2f(at(field, 'uRes'), cols, rows);
      gl.uniform1f(at(field, 'uUnit'), Math.min(rows, cols * 1.2));
      gl.useProgram(marks);
      gl.uniform2f(at(marks, 'uCells'), cols, rows);
      gl.uniform1f(at(marks, 'uCellPx'), cellPx);

      if (!checked) {
        checked = true;
        if (tooSlow()) {
          reject();
          return;
        }
      }
      draw();
    }

    function tick(): void {
      if (visible && !document.hidden) draw();
    }

    function start(): void {
      clearInterval(timer);
      if (animate && !motion.matches) timer = window.setInterval(tick, 1000 / current.fps);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(box);

    // Pause while scrolled out of view or behind another surface.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    intersection.observe(canvas);

    // Theme and scheme changes arrive as attribute or inline-style changes on <html>.
    const themeObserver = new MutationObserver(() => {
      setTones();
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-scheme', 'style', 'class'],
    });

    // A lost context while a theme scene runs is blamed on the scene; either
    // way the canvas is rebuilt once the GPU is back.
    const onLost = (e: Event): void => {
      e.preventDefault();
      if (!builtinIds.has(current.id)) reject();
    };
    const onRestored = (): void => setGeneration((g) => g + 1);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    motion.addEventListener('change', start);
    setTones();
    resize();
    start();

    return () => {
      clearInterval(timer);
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      motion.removeEventListener('change', start);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gl.deleteBuffer(buffer);
      gl.deleteTexture(fieldTex);
      gl.deleteTexture(glyphTex);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteProgram(field);
      gl.deleteProgram(marks);
    };
  }, [scene, animate, noWebgl, generation, builtinIds]);

  if (noWebgl || !scene) {
    return <Dither seed={7} cell={4} from="right" reach={0.6} animate={animate} className={className ?? ''} />;
  }

  return (
    <div ref={boxRef} className={`${styles.box} ${className ?? ''}`}>
      {/* Keyed by scene: a canvas keeps its GL context, so a new scene gets a fresh one. */}
      <canvas key={`${scene.id}-${generation}`} ref={canvasRef} className={`${styles.canvas} cord-dither`} aria-hidden="true" />
    </div>
  );
}
