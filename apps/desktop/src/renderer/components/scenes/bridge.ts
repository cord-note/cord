import type { LoginScene } from '@shared/types';

/**
 * A suspension bridge in fog over water. The fog glows and drifts; the bridge
 * is a dark silhouette that fades into it with distance, and the water below
 * shimmers. Composed from the right edge, where the lock screen shows it.
 */
export const bridge: LoginScene = {
  id: 'bridge',
  name: 'Bridge in fog',
  marks: 'square',
  fps: 2,
  cell: 4,
  source: `
const float HORIZON = 0.7;

// Height of a cable through three points, as a parabola in x.
float cable(float x, vec2 a, vec2 b, vec2 c) {
  float la = (x - b.x) * (x - c.x) / ((a.x - b.x) * (a.x - c.x));
  float lb = (x - a.x) * (x - c.x) / ((b.x - a.x) * (b.x - c.x));
  float lc = (x - a.x) * (x - b.x) / ((c.x - a.x) * (c.x - b.x));
  return a.y * la + b.y * lb + c.y * lc;
}

// Coverage of a horizontal band around y = mid, thickness w.
float band(float y, float mid, float w) {
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0 / uUnit, abs(y - mid));
}

// A tower: two legs and X bracing; s scales it, haze is its distance.
void tower(vec2 q, float x, float top, float foot, float s, float haze, inout float cover, inout float far) {
  float gap = 0.075 * s;
  float leg = 0.026 * s;
  float c = 0.0;
  c = max(c, stroke(q, vec2(x - gap, top), vec2(x - gap, foot), leg));
  c = max(c, stroke(q, vec2(x + gap, top), vec2(x + gap, foot), leg));
  // Cross beams and X bracing between them.
  float beam = leg * 0.7;
  c = max(c, stroke(q, vec2(x - gap, top + 0.02 * s), vec2(x + gap, top + 0.02 * s), beam));
  float y0 = top + 0.06 * s;
  float y1 = y0 + 0.2 * s;
  c = max(c, stroke(q, vec2(x - gap, y0), vec2(x + gap, y1), beam * 0.8));
  c = max(c, stroke(q, vec2(x + gap, y0), vec2(x - gap, y1), beam * 0.8));
  c = max(c, stroke(q, vec2(x - gap, y1), vec2(x + gap, y1), beam));
  float y2 = foot - 0.24 * s;
  c = max(c, stroke(q, vec2(x - gap, y2), vec2(x + gap, foot - 0.02), beam * 0.8));
  c = max(c, stroke(q, vec2(x + gap, y2), vec2(x - gap, foot - 0.02), beam * 0.8));
  if (c > cover) { cover = c; far = haze; }
}

float scene(vec2 p, vec2 span) {
  float t = uTime;
  // Measured leftward from the right edge, where the bridge comes in.
  vec2 q = vec2(span.x - p.x, p.y / span.y);
  float horizon = HORIZON;

  // Fog: brightest near the water, thinning upward, drifting slowly.
  float drift = fbm(vec2(p.x * 1.6 + t * 0.012, p.y * 3.2 + 4.0));
  float wisps = fbm(vec2(p.x * 4.0 + t * 0.03, p.y * 9.0));
  float fog = (0.32 + 0.55 * smoothstep(0.0, horizon, q.y)) * (0.75 + 0.5 * (drift - 0.5) * 2.0);
  fog += (wisps - 0.5) * 0.15;

  if (q.y > horizon) {
    // Water: dim, with stretched ripples that shimmer.
    float depth = (q.y - horizon) / (1.0 - horizon);
    float ripple = vnoise(vec2(p.x * 5.0 + t * 0.04, p.y * 70.0 - t * 0.6));
    float glint = smoothstep(0.62, 0.9, ripple) * (1.0 - depth * 0.6);
    fog = 0.12 + 0.25 * (1.0 - depth) + 0.45 * glint;
  }

  float cover = 0.0;
  float far = 0.0;

  // Deck: from past the right edge, rising into the distance, thinning as it goes.
  float k = clamp(q.x / 1.15, 0.0, 1.0);
  float deckY = mix(0.47, 0.31, k);
  float deck = band(q.y, deckY, mix(0.05, 0.01, k)) * step(q.x, 1.15);
  if (deck > cover) { cover = deck; far = k; }

  // Towers: one near, one far in the fog.
  tower(q, 0.34, 0.07, 0.8, 1.0, 0.18, cover, far);
  tower(q, 0.9, 0.17, horizon, 0.42, 0.72, cover, far);

  // Main cables: tower to tower, sagging toward the deck, and down past the edge.
  float near = cable(q.x, vec2(0.34, 0.075), vec2(0.62, 0.3), vec2(0.9, 0.175));
  float span1 = band(q.y, near, 0.008) * step(0.34, q.x) * step(q.x, 0.9);
  float back = cable(q.x, vec2(-0.1, 0.43), vec2(0.12, 0.22), vec2(0.34, 0.075));
  float span2 = band(q.y, back, 0.01) * step(q.x, 0.34);
  float cables = max(span1, span2);
  // Hangers: thin verticals from the cables down to the deck.
  float hang = step(fract(q.x * 26.0), 0.12) * step(min(near, back) - 0.001, q.y) * step(q.y, deckY);
  hang *= step(-0.1, q.x) * step(q.x, 0.9);
  float hangers = max(cables, hang * 0.85);
  if (hangers > cover) { cover = hangers; far = clamp(q.x / 1.1, 0.0, 1.0) * 0.8; }

  // Near structure is dark against the glow; far structure fades into it.
  return mix(fog, fog * far * 0.85, cover);
}
`,
};
