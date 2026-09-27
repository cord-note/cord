import { useEffect, useRef } from 'react';
import styles from './Dither.module.css';

/**
 * A generated, ordered-dither texture for large empty surfaces: the lock screen,
 * empty states, blank panes. Drawn on a canvas from a seeded noise field and a
 * Bayer threshold matrix, so it costs no image assets and follows the theme —
 * the ink colours are read from the `--dither-*` tokens and re-read whenever the
 * theme or scheme changes.
 *
 * Decorative only: the canvas is hidden from assistive technology.
 */

export type DitherShape = 'square' | 'diamond' | 'glyph';
/** The side the ink grows from. `none` scatters it evenly over the surface. */
export type DitherFrom = 'left' | 'right' | 'top' | 'bottom' | 'none';
/** `noise` is weather-like texture; `cumulus` draws lit, lobed cloud banks. */
export type DitherField = 'noise' | 'cumulus';

interface DitherProps {
  /** Same seed, same picture. */
  seed?: number;
  /** Size of one dither cell in CSS pixels. */
  cell?: number;
  shape?: DitherShape;
  field?: DitherField;
  from?: DitherFrom;
  /** How far the ink reaches, 0–1. */
  reach?: number;
  /** Noise feature size in cells; larger is calmer. */
  scale?: number;
  /** Slow drift. Ignored when the OS asks for reduced motion. */
  animate?: boolean;
  /**
   * Background texture rather than a feature: one ink, no accent patches.
   * For empty panes, where the dither should sit under notice.
   */
  quiet?: boolean;
  className?: string;
}

// 8×8 Bayer matrix, normalised to thresholds in (0, 1).
const BAYER: readonly number[] = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

// Densest last, for the glyph shape.
const GLYPHS = ['.', ':', '-', '=', '+', '*', '%', '#'];

const FRAME_MS = 1000 / 12;

/**
 * Clouds are sized against the shorter side (with some slack for wide
 * canvases), so a tall, narrow surface gets more banks rather than one giant one.
 */
function cloudUnit(width: number, height: number): number {
  return Math.min(height, width * 1.2);
}

/** One round lobe of a cloud, in cloud units (see `cloudUnit`). */
interface Puff {
  x: number;
  y: number;
  r: number;
  /** Flat underside of the cloud this lobe belongs to. */
  base: number;
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Cloud banks as clusters of overlapping lobes: big ones low, smaller ones
 * billowing on top, all cut flat along a shared base. `span` and `depth` are
 * the canvas width and height in cloud units.
 */
function makePuffs(seed: number, span: number, depth: number, from: DitherFrom, reach: number): Puff[] {
  const rand = seededRandom(seed * 7919);
  const puffs: Puff[] = [];
  const clusters = Math.max(3, Math.round(span * depth * 4 * (0.5 + reach)));
  for (let k = 0; k < clusters; k++) {
    // Lean the banks toward the side the ink grows from.
    let t = rand();
    if (from === 'right' || from === 'bottom') t = 1 - (1 - t) * (1 - t) ;
    if (from === 'left' || from === 'top') t = t * t;
    const horizontal = from === 'top' || from === 'bottom';
    const cx = horizontal ? rand() * span : t * span * 1.15 - span * 0.05;
    const cy = (horizontal ? t : rand()) * depth * 1.1 - depth * 0.05;
    const size = 0.16 + rand() * 0.2;
    const base = cy + size * 0.55;
    const lobes = 9 + Math.floor(rand() * 8);
    for (let i = 0; i < lobes; i++) {
      const across = (rand() * 2 - 1) * size * 1.5;
      // Lobes toward the middle of the bank rise higher.
      const lift = (1 - Math.abs(across) / (size * 1.5)) * size * (0.4 + rand() * 0.8);
      const r = size * (0.35 + rand() * 0.45) * (1 - Math.abs(across) / (size * 3));
      puffs.push({ x: cx + across, y: base - r * 0.6 - lift, r, base });
    }
  }
  return puffs;
}

/**
 * Brightness of the cloud field at (u, v), 0 (sky) to 1 (sunlit top). Each
 * lobe is brightest toward its upper-left and falls off into shadow at its
 * underside, so overlapping lobes read as separate billows.
 */
function cumulus(puffs: readonly Puff[], u: number, v: number): number {
  let best = 0;
  for (const p of puffs) {
    const dx = u - p.x;
    const dy = v - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= p.r * p.r) continue;
    if (v > p.base) continue;
    const d = Math.sqrt(d2) / p.r;
    // Light from above-left: the lobe's normal against the light direction.
    const light = 0.8 + 0.4 * ((-dy * 0.8 - dx * 0.35) / p.r);
    const edge = 1 - d * d * d * d;
    // Shade the band just above the flat base.
    const under = Math.min(1, (p.base - v) / (p.r * 0.5));
    const b = Math.min(1, edge * 1.15) * light * (0.5 + 0.5 * under);
    if (b > best) best = b;
  }
  return best;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Four octaves of value noise, roughly in [0, 1]. */
function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    amp *= 0.5;
    freq *= 2;
  }
  return sum / 0.9375;
}

/** 0 on the far side, 1 at the edge the ink grows from. */
function gradient(from: DitherFrom, nx: number, ny: number): number {
  switch (from) {
    case 'left':   return 1 - nx;
    case 'right':  return nx;
    case 'top':    return 1 - ny;
    case 'bottom': return ny;
    case 'none':   return 0.5;
  }
}

interface Inks {
  ink: string;
  strong: string;
  accent: string;
  font: string;
}

function readInks(el: HTMLElement): Inks {
  const css = getComputedStyle(el);
  const get = (name: string): string => css.getPropertyValue(name).trim();
  return {
    ink: get('--dither-ink') || '#777',
    strong: get('--dither-ink-strong') || '#ddd',
    accent: get('--dither-accent') || get('--dither-ink-strong') || '#ddd',
    font: get('--font-mono') || 'monospace',
  };
}

export default function Dither({
  seed = 1,
  cell = 6,
  shape = 'square',
  field = 'noise',
  from = 'right',
  reach = 0.6,
  scale = 22,
  animate = true,
  quiet = false,
  className,
}: DitherProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inks = readInks(canvas);
    let width = 0;
    let height = 0;
    let time = 0;
    let frame = 0;
    let last = 0;
    let visible = true;
    let puffs: Puff[] = [];

    function draw(): void {
      if (!canvas || !ctx || width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cols = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const drift = time * 0.00004;
      const bias = reach - 0.5;

      const inkPath = new Path2D();
      const strongPath = new Path2D();
      const accentPath = new Path2D();
      const glyphCells: [number, number, number, number][] = [];

      if (shape === 'glyph') {
        ctx.font = `${Math.round(cell * 1.1)}px ${inks.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const nx = cols > 1 ? c / (cols - 1) : 0;
          const ny = rows > 1 ? r / (rows - 1) : 0;
          const threshold = BAYER[(r & 7) * 8 + (c & 7)]!;
          let value: number;
          if (field === 'cumulus') {
            // Clouds drift sideways and wrap; a little fine noise breaks up the lobes.
            const unit = cloudUnit(width, height);
            const span = width / unit;
            let u = (c * cell) / unit - time * 0.000004;
            u = ((u % (span * 1.3)) + span * 1.3) % (span * 1.3) - span * 0.15;
            // Thin the banks out toward the far side, so they never end on the edge.
            const fade = from === 'none' ? 1 : Math.min(1, gradient(from, nx, ny) * 3);
            value = cumulus(puffs, u, (r * cell) / unit) * fade;
            if (value === 0) continue;
            value += (fbm(c / 6, r / 6, seed + 3) - 0.5) * 0.18;
            if (value <= threshold) continue;
            drawCell(c, r, value, threshold);
            continue;
          }
          const px = c / scale + drift;
          const py = r / scale - drift * 0.6;
          // Domain warp: sample the field at a point pushed around by a second
          // field, which turns round blobs into billows.
          const wx = fbm(px * 0.5 + 3.1, py * 0.5 + 7.7, seed + 5) - 0.5;
          const wy = fbm(px * 0.5 - 4.3, py * 0.5 + 1.9, seed + 9) - 0.5;
          // Value noise bunches around 0.5; stretch it so masses and holes both occur.
          const raw = fbm(px + wx * 2.4, py + wy * 2.4, seed);
          const n = Math.min(1, Math.max(0, (raw - 0.5) * 2.4 + 0.5));
          value = from === 'none'
            ? n * (0.4 + reach) - 0.2
            : n * 0.85 + (gradient(from, nx, ny) - 0.5) * 1.3 + bias;
          if (value <= threshold) continue;
          drawCell(c, r, value, threshold);
        }
      }

      function drawCell(c: number, r: number, value: number, threshold: number): void {
          const x = c * cell;
          const y = r * cell;
          const strong = !quiet && value > threshold + 0.3;
          // Accent comes in patches, not sparkles: a slow field decides where.
          // Clouds take only a tint of it, in their shaded parts.
          const accent = !quiet && fbm(c / (scale * 2.5), r / (scale * 2.5), seed + 31) > 0.66
            && hash(c, r, seed + 99) > (field === 'cumulus' ? 0.8 : 0.55)
            && (field !== 'cumulus' || !strong);
          if (shape === 'glyph') {
            glyphCells.push([x, y, value, accent ? 2 : strong ? 1 : 0]);
            return;
          }
          const path = accent ? accentPath : strong ? strongPath : inkPath;
          // Halftone: the denser the tone, the bigger the mark.
          const size = cell * (strong ? 0.74 : 0.52);
          const inset = (cell - size) / 2;
          if (shape === 'diamond') {
            const cx = x + cell / 2;
            const cy = y + cell / 2;
            const h = size * 0.62;
            path.moveTo(cx, cy - h);
            path.lineTo(cx + h, cy);
            path.lineTo(cx, cy + h);
            path.lineTo(cx - h, cy);
            path.closePath();
          } else {
            path.rect(x + inset, y + inset, size, size);
          }
      }

      if (shape === 'glyph') {
        for (const [x, y, value, tone] of glyphCells) {
          ctx.fillStyle = tone === 2 ? inks.accent : tone === 1 ? inks.strong : inks.ink;
          const i = Math.min(GLYPHS.length - 1, Math.floor(value * GLYPHS.length * 0.9));
          ctx.fillText(GLYPHS[i]!, x + cell / 2, y + cell / 2);
        }
        return;
      }
      ctx.fillStyle = inks.ink;
      ctx.fill(inkPath);
      ctx.fillStyle = inks.strong;
      ctx.fill(strongPath);
      ctx.fillStyle = inks.accent;
      ctx.fill(accentPath);
    }

    function resize(): void {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (field === 'cumulus' && height > 0) {
        const unit = cloudUnit(width, height);
        puffs = makePuffs(seed, width / unit, height / unit, from, reach);
      }
      draw();
    }

    function tick(now: number): void {
      frame = requestAnimationFrame(tick);
      if (!visible || now - last < FRAME_MS) return;
      if (last !== 0) time += Math.min(now - last, 200);
      last = now;
      draw();
    }

    function start(): void {
      cancelAnimationFrame(frame);
      last = 0;
      if (animate && !motion.matches) frame = requestAnimationFrame(tick);
      else draw();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // Pause while scrolled out of view or behind another surface.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    intersection.observe(canvas);

    // Theme and scheme changes arrive as attribute or inline-style changes on <html>.
    const themeObserver = new MutationObserver(() => {
      inks = readInks(canvas);
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-scheme', 'style', 'class'],
    });

    motion.addEventListener('change', start);
    resize();
    start();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      motion.removeEventListener('change', start);
    };
  }, [seed, cell, shape, field, from, reach, scale, animate, quiet]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas} cord-dither ${className ?? ''}`}
      aria-hidden="true"
    />
  );
}
