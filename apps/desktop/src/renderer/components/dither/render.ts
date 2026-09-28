/**
 * The dither's drawing, free of the DOM: it runs on the main thread or, where
 * OffscreenCanvas is available, in a worker (see `dither.worker.ts`), so the
 * per-cell noise work never competes with typing.
 */

export type DitherShape = 'square' | 'diamond' | 'glyph';
/** The side the ink grows from. `none` scatters it evenly over the surface. */
export type DitherFrom = 'left' | 'right' | 'top' | 'bottom' | 'none';
/** `noise` is weather-like texture; `cumulus` draws lit, lobed cloud banks. */
export type DitherField = 'noise' | 'cumulus';


/** Everything that decides the picture, apart from size, time and colours. */
export interface DitherOptions {
  seed: number;
  cell: number;
  shape: DitherShape;
  field: DitherField;
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
  /** Depth toward the viewer; the nearest lobe surface is the one seen. */
  z: number;
  /** Flat underside of the cloud this lobe belongs to. */
  base: number;
}

/**
 * The cloud layer. It is `period` wide and wraps: lobes near one end reach
 * round to the other, so the drift loops without a seam. Lobes are bucketed
 * by x so a sample only visits the few that can reach it.
 */
export interface CloudField {
  period: number;
  bucketWidth: number;
  buckets: Puff[][];
}

const BUCKET_WIDTH = 0.08;

function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** `dx` folded into [-period/2, period/2). */
function wrapDelta(dx: number, period: number): number {
  return dx - period * Math.floor(dx / period + 0.5);
}

/**
 * Cumulus banks: a broad flat base, a domed top built from big lobes along
 * its contour, and small lobes on the rim for the cauliflower edge. `span`
 * and `depth` are the canvas width and height in cloud units.
 */
function makeClouds(seed: number, span: number, depth: number, from: DitherFrom, reach: number): CloudField {
  const rand = seededRandom(seed * 7919);
  const period = span * 1.3;
  const puffs: Puff[] = [];
  const clusters = Math.max(4, Math.round(period * depth * 4.5 * (0.5 + reach)));
  for (let k = 0; k < clusters; k++) {
    // Lean the banks toward the side the ink grows from.
    let t = rand();
    if (from === 'right' || from === 'bottom') t = 1 - (1 - t) * (1 - t);
    if (from === 'left' || from === 'top') t = t * t;
    const horizontal = from === 'top' || from === 'bottom';
    const cx = horizontal ? rand() * period : t * span * 1.1;
    const cy = (horizontal ? t : rand()) * depth * 1.1 - depth * 0.05;
    const halfWidth = 0.16 + rand() * 0.2;
    const height = halfWidth * (0.75 + rand() * 0.5);
    const base = cy + height * 0.4;

    // Core: a few big lobes sitting on the base, filling the body.
    const core = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < core; i++) {
      const a = (i / (core - 1)) * 1.4 - 0.7 + (rand() - 0.5) * 0.2;
      const r = halfWidth * (0.42 + rand() * 0.2) * (1 - Math.abs(a) * 0.35);
      puffs.push({ x: cx + a * halfWidth, y: base - r * 0.55, r, z: (rand() - 0.5) * r * 0.6, base });
    }
    // Crown: mid-size lobes along the domed top, higher toward the middle.
    const crown = 5 + Math.floor(rand() * 5);
    for (let i = 0; i < crown; i++) {
      const a = rand() * 1.6 - 0.8;
      const dome = 1 - a * a;
      const r = halfWidth * (0.24 + rand() * 0.18) * (0.6 + 0.4 * dome);
      puffs.push({ x: cx + a * halfWidth, y: base - height * dome + r * 0.55, r, z: rand() * r * 0.8, base });
    }
    // Rim detail: small lobes on the upper contour.
    const rim = 8 + Math.floor(rand() * 8);
    for (let i = 0; i < rim; i++) {
      const a = rand() * 1.8 - 0.9;
      const dome = 1 - a * a;
      const r = halfWidth * (0.08 + rand() * 0.1);
      puffs.push({ x: cx + a * halfWidth, y: base - height * dome * (0.92 + rand() * 0.12) + r * 0.3, r, z: rand() * r * 2, base });
    }
  }

  const count = Math.max(1, Math.ceil(period / BUCKET_WIDTH));
  const bucketWidth = period / count;
  const buckets: Puff[][] = Array.from({ length: count }, () => []);
  for (const p of puffs) {
    p.x = ((p.x % period) + period) % period;
    const reachX = p.r * 1.2;
    const first = Math.floor((p.x - reachX) / bucketWidth);
    const last = Math.floor((p.x + reachX) / bucketWidth);
    for (let b = first; b <= last; b++) buckets[((b % count) + count) % count]!.push(p);
  }
  return { period, bucketWidth, buckets };
}

// Sunlight from above, a little left and toward the viewer.
const LIGHT = (() => {
  const x = -0.35, y = -0.8, z = 0.5;
  const n = Math.hypot(x, y, z);
  return { x: x / n, y: y / n, z: z / n };
})();

/**
 * Brightness of the cloud layer at (u, v): 0 is open sky. Every lobe is a
 * sphere; the one whose surface is nearest the viewer here is the one seen,
 * lit by its own surface normal. So each billow gets a bright rim and the
 * creases where lobes overlap fall into shade — which is what makes it read
 * as cumulus rather than a blob. Lobes darken toward the cloud's flat base.
 * `u` must already be folded into [0, period).
 */
function cloudShade(field: CloudField, u: number, v: number): number {
  const index = Math.floor(u / field.bucketWidth);
  const bucket = field.buckets[Math.min(field.buckets.length - 1, Math.max(0, index))]!;
  let nearest = -Infinity;
  let shade = 0;
  for (const p of bucket) {
    if (v >= p.base) continue;
    const dx = wrapDelta(u - p.x, field.period) / p.r;
    const dy = (v - p.y) / p.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= 1) continue;
    const nz = Math.sqrt(1 - d2);
    const surface = p.z + nz * p.r;
    if (surface <= nearest) continue;
    nearest = surface;
    const lambert = Math.max(0, dx * LIGHT.x + dy * LIGHT.y + nz * LIGHT.z);
    // The very rim of a lobe goes thin and translucent.
    const rim = Math.min(1, nz * 3.2);
    const underside = Math.min(1, (p.base - v) / (p.r * 0.9));
    shade = (0.3 + 1.15 * lambert) * rim * (0.5 + 0.5 * underside);
  }
  return shade;
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

/** Cloud banks for a canvas of this size, or null for the noise field. */
export function prepare(options: DitherOptions, width: number, height: number): CloudField | null {
  if (options.field !== 'cumulus' || width === 0 || height === 0) return null;
  const unit = cloudUnit(width, height);
  return makeClouds(options.seed, width / unit, height / unit, options.from, options.reach);
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
  clouds: CloudField | null,
): void {
  const { seed, cell, shape, field, from, reach, scale, quiet } = options;
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
        let value: number;
        if (field === 'cumulus' && clouds) {
          const unit = cloudUnit(width, height);
          // Unwrapped cloud-space x: continuous as the layer drifts, so the
          // noise sampled from it never jumps at the wrap.
          const uc = (c * cell) / unit - time * 0.000004;
          const v = (r * cell) / unit;
          // Lumpy edges: nudge where the lobes are sampled with fine noise.
          const wu = uc + (fbm(uc * 16, v * 16, seed + 13) - 0.5) * 0.05;
          const wv = v + (fbm(uc * 16 + 9.2, v * 16 + 4.1, seed + 17) - 0.5) * 0.05;
          const u = ((wu % clouds.period) + clouds.period) % clouds.period;
          const shade = cloudShade(clouds, u, wv) * (0.88 + (fbm(uc * 3, v * 3, seed + 21) - 0.5) * 0.3);
          if (shade <= 0) continue;
          // Thin the banks out toward the far side, so they never end on the edge.
          const fade = from === 'none' ? 1 : Math.min(1, gradient(from, nx, ny) * 3);
          value = Math.min(1, shade) * fade;
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
