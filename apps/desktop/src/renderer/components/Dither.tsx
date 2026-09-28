import { useEffect, useRef } from 'react';
import { paint, prepare, type CloudField, type DitherField, type DitherFrom, type DitherOptions, type DitherShape, type Inks } from './dither/render';
import type { DitherMessage } from './dither/dither.worker';
import styles from './Dither.module.css';

export type { DitherField, DitherFrom, DitherShape } from './dither/render';

/**
 * A generated, ordered-dither texture for large empty surfaces: the lock screen,
 * empty states, blank panes. Drawn on a canvas from a seeded noise field and a
 * Bayer threshold matrix, so it costs no image assets and follows the theme:
 * the ink colours are read from the `--dither-*` tokens and re-read whenever the
 * theme or scheme changes.
 *
 * The drawing runs in a worker where OffscreenCanvas is available, so it never
 * delays input; elsewhere it falls back to the main thread. Either way it only
 * redraws a few times a second. The drift is slow enough that more frames
 * would change nothing a viewer could see.
 *
 * Decorative only: the canvas is hidden from assistive technology.
 */

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

/** Redraw interval while drifting. The drift moves about one cell a second. */
const FRAME_MS = 400;

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

/** Draws on this thread or in a worker; the component drives both the same way. */
interface Painter {
  resize(width: number, height: number, dpr: number): void;
  setInks(inks: Inks): void;
  setTime(time: number): void;
  dispose(): void;
}

/**
 * One worker per canvas. A canvas can be handed to a worker only once, so the
 * worker outlives a single effect run: React runs effects twice in development,
 * and the second run must find the canvas's worker still there. Disposal waits a
 * tick and is cancelled if the canvas is picked up again.
 */
const workers = new WeakMap<HTMLCanvasElement, { worker: Worker; retire: number }>();

function workerPainter(canvas: HTMLCanvasElement, options: DitherOptions, inks: Inks): Painter | null {
  let entry = workers.get(canvas);
  if (entry) {
    clearTimeout(entry.retire);
  } else {
    if (typeof Worker === 'undefined' || !('transferControlToOffscreen' in canvas)) return null;
    try {
      const worker = new Worker(new URL('./dither/dither.worker.ts', import.meta.url), { type: 'module' });
      const offscreen = canvas.transferControlToOffscreen();
      const init: DitherMessage = { type: 'init', canvas: offscreen, options, inks };
      worker.postMessage(init, [offscreen]);
      entry = { worker, retire: 0 };
      workers.set(canvas, entry);
    } catch {
      return null;
    }
  }
  const current = entry;
  const post = (msg: DitherMessage): void => current.worker.postMessage(msg);
  return {
    resize: (width, height, dpr) => post({ type: 'resize', width, height, dpr }),
    setInks: (next) => post({ type: 'inks', inks: next }),
    setTime: (time) => post({ type: 'time', time }),
    dispose: () => {
      current.retire = window.setTimeout(() => {
        current.worker.terminate();
        workers.delete(canvas);
      }, 0);
    },
  };
}

function mainThreadPainter(canvas: HTMLCanvasElement, options: DitherOptions, initialInks: Inks): Painter | null {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    // Already handed to a worker that failed afterwards; nothing more to draw with.
  }
  if (!ctx) return null;
  let inks = initialInks;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let time = 0;
  let clouds: CloudField | null = null;
  const draw = (): void => paint(ctx, options, width, height, dpr, time, inks, clouds);
  return {
    resize: (w, h, d) => {
      width = w;
      height = h;
      dpr = d;
      canvas.width = Math.round(w * d);
      canvas.height = Math.round(h * d);
      clouds = prepare(options, w, h);
      draw();
    },
    setInks: (next) => { inks = next; draw(); },
    setTime: (t) => { time = t; draw(); },
    dispose: () => {},
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
    if (!canvas) return;
    const options: DitherOptions = { seed, cell, shape, field, from, reach, scale, quiet };
    const inks = readInks(canvas);
    const painter = workerPainter(canvas, options, inks) ?? mainThreadPainter(canvas, options, inks);
    if (!painter) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let time = 0;
    let frame = 0;
    let last = 0;
    let visible = true;

    function resize(): void {
      if (!canvas || !painter) return;
      const rect = canvas.getBoundingClientRect();
      painter.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    }

    function tick(now: number): void {
      frame = requestAnimationFrame(tick);
      if (!visible || now - last < FRAME_MS) return;
      if (last !== 0) time += Math.min(now - last, FRAME_MS * 2);
      last = now;
      painter?.setTime(time);
    }

    function start(): void {
      cancelAnimationFrame(frame);
      last = 0;
      if (animate && !motion.matches) frame = requestAnimationFrame(tick);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // Pause while scrolled out of view or behind another surface.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    intersection.observe(canvas);

    // Theme and scheme changes arrive as attribute or inline-style changes on <html>.
    const themeObserver = new MutationObserver(() => painter.setInks(readInks(canvas)));
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
      painter.dispose();
    };
  }, [seed, cell, shape, field, from, reach, scale, animate, quiet]);

  // Keyed by the options: a canvas handed to a worker can never be drawn on
  // from here again, so new options need a fresh element.
  return (
    <canvas
      key={`${seed}-${cell}-${shape}-${field}-${from}-${reach}-${scale}-${quiet}`}
      ref={canvasRef}
      className={`${styles.canvas} cord-dither ${className ?? ''}`}
      aria-hidden="true"
    />
  );
}
