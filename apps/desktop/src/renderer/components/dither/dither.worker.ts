/// <reference lib="webworker" />
import { paint, prepare, type CloudField, type DitherOptions, type Inks } from './render';

/**
 * Paints a dither onto a canvas handed over with transferControlToOffscreen,
 * off the main thread. The page stays the clock: it sends the time, size and
 * colours, and this only draws.
 */

export type DitherMessage =
  | { type: 'init'; canvas: OffscreenCanvas; options: DitherOptions; inks: Inks }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'inks'; inks: Inks }
  | { type: 'time'; time: number };

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let options: DitherOptions | null = null;
let inks: Inks | null = null;
let clouds: CloudField | null = null;
let width = 0;
let height = 0;
let dpr = 1;
let time = 0;

function draw(): void {
  if (ctx && options && inks) paint(ctx, options, width, height, dpr, time, inks, clouds);
}

self.onmessage = (e: MessageEvent<DitherMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      canvas = msg.canvas;
      ctx = canvas.getContext('2d');
      options = msg.options;
      inks = msg.inks;
      break;
    case 'resize':
      width = msg.width;
      height = msg.height;
      dpr = msg.dpr;
      if (canvas) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      if (options) clouds = prepare(options, width, height);
      break;
    case 'inks':
      inks = msg.inks;
      break;
    case 'time':
      time = msg.time;
      break;
  }
  draw();
};
