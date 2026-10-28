/**
 * The dither's drawing, free of the DOM: it runs on the main thread or, where
 * OffscreenCanvas is available, in a worker (see `dither.worker.ts`), so the
 * per-cell noise work never competes with typing.
 */

export type DitherShape = 'square' | 'diamond' | 'glyph';
/** The side the ink grows from. `none` scatters it evenly over the surface. */
export type DitherFrom = 'left' | 'right' | 'top' | 'bottom' | 'none';

/** Everything that decides the picture, apart from size, time and colours. */
export interface DitherOptions {
  seed: number;
  cell: number;
  shape: DitherShape;
  from: DitherFrom;
  reach: number;
  scale: number;
  quiet: boolean;
}

export interface Inks {
  ink: string;
  strong: string;
  accent: string;
  font: string;
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

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Paint one frame. `width`/`height` are CSS pixels; the context is already sized for `dpr`. */
export function paint(
  ctx: Ctx2D,
  options: DitherOptions,
  width: number,
  height: number,
  dpr: number,
  time: number,
  inks: Inks,
): void {
  const { seed, cell, shape, from, reach, scale, quiet } = options;
  if (width === 0 || height === 0) return;
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
        const px = c / scale + drift;
        const py = r / scale - drift * 0.6;
        // Domain warp: sample the field at a point pushed around by a second
        // field, which turns round blobs into billows.
        const wx = fbm(px * 0.5 + 3.1, py * 0.5 + 7.7, seed + 5) - 0.5;
        const wy = fbm(px * 0.5 - 4.3, py * 0.5 + 1.9, seed + 9) - 0.5;
        // Value noise bunches around 0.5; stretch it so masses and holes both occur.
        const raw = fbm(px + wx * 2.4, py + wy * 2.4, seed);
        const n = Math.min(1, Math.max(0, (raw - 0.5) * 2.4 + 0.5));
        const value = from === 'none'
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
        const accent = !quiet && fbm(c / (scale * 2.5), r / (scale * 2.5), seed + 31) > 0.66
          && hash(c, r, seed + 99) > 0.55;
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
