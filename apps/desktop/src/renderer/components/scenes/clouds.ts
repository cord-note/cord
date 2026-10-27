import type { LoginScene } from '@shared/types';

/**
 * Separate cumulus banks, each a dome on a wavy flat base, with three sizes of
 * round billows on top. Each billow is lit by its own surface normal and
 * shadowed by marching toward the sun, so creases and bellies fall into shade.
 * Drifts one cell a second.
 */
export const clouds: LoginScene = {
  id: 'clouds',
  name: 'Clouds',
  marks: 'square',
  fps: 1,
  cell: 4,
  source: `
// Sun from above, a little left, partly toward the viewer.
const vec3 SUN = vec3(-0.45, 0.75, 0.5);
// One bank at most per grid cell, in scene units.
const vec2 GRID = vec2(0.5, 0.3);
// Height where cloud begins.
const float EDGE = 0.5;

// How far inside the nearest dome p is (above 0 is inside); lift is 0 at the
// base and 1 at the top, blended where banks overlap.
float banks(vec2 p, out float lift) {
  vec2 i = floor(p / GRID);
  float best = -9.0;
  float liftSum = 0.0;
  float weight = 0.0;
  // Domes rise above their base, so look further down than up.
  for (int y = -1; y <= 2; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = i + vec2(float(x), float(y));
      // Leave some cells empty, for sky between the banks.
      if (hash1(g + 21.0) > 0.6) continue;
      vec2 base = (g + 0.2 + 0.6 * hash2(g * 1.37 + 4.0)) * GRID;
      float w = 0.13 + 0.15 * hash1(g + 9.0);
      float h = w * (0.8 + 0.6 * hash1(g + 3.0));
      vec2 d = (p - base) / vec2(w, h);
      float e = 1.0 - dot(d, d);
      // Flat underside: below the base the dome falls away fast. The base
      // waves a little, so it is not ruler-straight.
      float under = d.y - 0.12 * (0.5 + 0.5 * sin(p.x * 34.0 + g.x * 5.3));
      if (under > 0.0) e = min(e, 1.0) - under * 12.0;
      best = max(best, e);
      float k = max(e, 0.0) + 0.001;
      liftSum += clamp(-d.y, 0.0, 1.0) * k * k;
      weight += k * k;
    }
  }
  lift = liftSum / weight;
  return best;
}

float height(vec2 p, float drift, vec2 span, out float lift) {
  float b = banks(p, lift);
  if (b < -0.8) return -1.0;
  // Thinner toward the left of the surface, so banks dissolve as they drift off.
  float side = clamp((p.x - drift) / span.x * 1.6, 0.0, 1.0);
  return b * 0.6
    + 0.4 * billows(p * 9.0)
    + 0.15 * billows(p * 20.0 + 5.0)
    + 0.05 * billows(p * 44.0 + 11.0)
    - (1.0 - side) * 0.3;
}

float scene(vec2 q, vec2 span) {
  // Exactly one cell per second.
  float drift = floor(uTime) / uUnit;
  vec2 p = q + vec2(drift, 0.0);

  float lift;
  float h = height(p, drift, span, lift);
  if (h < EDGE) return -1.0;

  // Surface normal from the heightfield (y flipped back to up).
  float ignored;
  float e = 1.0 / uUnit;
  float hx = height(p + vec2(e, 0.0), drift, span, ignored) - h;
  float hy = height(p - vec2(0.0, e), drift, span, ignored) - h;
  vec3 n = normalize(vec3(-hx, -hy, e * 2.6));
  vec3 sun = normalize(SUN);
  float lambert = max(0.0, dot(n, sun));

  // Self-shadow: walk toward the sun; any taller cloud on the way blocks it.
  vec2 dir = normalize(vec2(sun.x, -sun.y));
  float rise = sun.z / length(sun.xy);
  float shadow = 0.0;
  float t = 0.005;
  for (int i = 0; i < 7; i++) {
    float above = height(p + dir * t, drift, span, ignored) - (h + t * rise * 2.4);
    shadow = max(shadow, clamp(above * 5.0, 0.0, 1.0));
    t *= 1.6;
  }

  float light = 0.3 + 1.0 * lambert * (1.0 - shadow * 0.8);
  // Bellies sit in the cloud's own shade.
  return light * (0.6 + 0.4 * lift);
}
`,
};
