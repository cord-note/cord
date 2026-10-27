import { useEffect, useRef, useState } from 'react';
import Dither from './Dither';
import { FIELD_SHADER, MARK_SHADER, VERTEX_SHADER } from './clouds/shader';
import styles from './Clouds.module.css';

/**
 * Lit, dithered cumulus for the lock screen, drawn by WebGL: one pass lights
 * the clouds at one pixel per cell, a second turns that into halftone marks
 * (see `clouds/shader.ts`). It redraws once a second, sliding the clouds one cell.
 *
 * Colours come from the `--dither-cloud-*` tokens and follow theme changes.
 * Where WebGL is missing it falls back to the plain canvas dither. Decorative only.
 */

interface CloudsProps {
  /** Same seed, same sky. */
  seed?: number;
  /** Size of one dither cell in CSS pixels. */
  cell?: number;
  /** Slow drift. Ignored when the OS asks for reduced motion. */
  animate?: boolean;
  className?: string;
}

/**
 * Time between redraws while drifting. Each redraw moves the clouds exactly
 * one cell, so nothing between two redraws would show anyway.
 */
const STEP_MS = 1000;

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

function readTones(el: HTMLElement, probe: CanvasRenderingContext2D): { shade: Rgb; mid: Rgb; light: Rgb } {
  const css = getComputedStyle(el);
  const get = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    shade: toRgb(probe, get('--dither-cloud-shade', '#444')),
    mid: toRgb(probe, get('--dither-cloud-mid', '#777')),
    light: toRgb(probe, get('--dither-cloud-light', '#ddd')),
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

export default function Clouds({ seed = 7, cell = 4, animate = true, className }: CloudsProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  // Bumped when a lost GPU context comes back, to rebuild on a fresh canvas.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || failed) return;
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false });
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!gl || !probe) {
      setFailed(true);
      return;
    }

    const field = link(gl, FIELD_SHADER);
    const marks = link(gl, MARK_SHADER);
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    const buffer = gl.createBuffer();
    if (!field || !marks || !texture || !framebuffer || !buffer) {
      setFailed(true);
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

    // The field pass renders brightness into this texture, one texel per cell.
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const at = (program: WebGLProgram, name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
    gl.useProgram(field);
    gl.uniform1f(at(field, 'uSeed'), seed);
    gl.useProgram(marks);
    gl.uniform1i(at(marks, 'uField'), 0);

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let steps = 0;
    let cols = 1;
    let rows = 1;
    let cellPx = 1;
    let unit = 1;
    let timer = 0;
    let visible = true;

    function setTones(): void {
      if (!gl || !probe || !marks) return;
      const { shade, mid, light } = readTones(canvas!, probe);
      gl.useProgram(marks);
      gl.uniform3fv(at(marks, 'uShade'), shade);
      gl.uniform3fv(at(marks, 'uMid'), mid);
      gl.uniform3fv(at(marks, 'uLight'), light);
    }

    function draw(): void {
      if (!gl || !field || !marks || gl.isContextLost()) return;
      gl.useProgram(field);
      // Wraps after many hours, so the noise inputs stay small.
      gl.uniform1f(at(field, 'uDrift'), (steps / unit) % 200);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, cols, rows);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(marks);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cols * cellPx, rows * cellPx);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Whole device pixels per cell, so the marks stay crisp.
    function resize(): void {
      if (!gl || !box || !canvas || !field || !marks) return;
      const rect = box.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cellPx = Math.max(1, Math.round(cell * dpr));
      cols = Math.max(1, Math.ceil((rect.width * dpr) / cellPx));
      rows = Math.max(1, Math.ceil((rect.height * dpr) / cellPx));
      canvas.width = cols * cellPx;
      canvas.height = rows * cellPx;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

      // Clouds are sized against the shorter side, with slack for wide boxes.
      unit = Math.min(rows, cols * 1.2);
      gl.useProgram(field);
      gl.uniform2f(at(field, 'uRes'), cols, rows);
      gl.uniform1f(at(field, 'uUnit'), unit);
      gl.useProgram(marks);
      gl.uniform2f(at(marks, 'uCells'), cols, rows);
      gl.uniform1f(at(marks, 'uCellPx'), cellPx);
      draw();
    }

    function tick(): void {
      if (!visible || document.hidden) return;
      steps += 1;
      draw();
    }

    function start(): void {
      clearInterval(timer);
      if (animate && !motion.matches) timer = window.setInterval(tick, STEP_MS);
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

    // A lost GPU context (driver reset, sleep) is rebuilt once it comes back.
    const onLost = (e: Event): void => e.preventDefault();
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
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteProgram(field);
      gl.deleteProgram(marks);
    };
  }, [seed, cell, animate, failed, generation]);

  if (failed) return <Dither seed={seed} cell={cell} from="right" reach={0.6} animate={animate} className={className ?? ''} />;

  return (
    <div ref={boxRef} className={`${styles.box} ${className ?? ''}`}>
      <canvas key={generation} ref={canvasRef} className={`${styles.canvas} cord-dither`} aria-hidden="true" />
    </div>
  );
}
