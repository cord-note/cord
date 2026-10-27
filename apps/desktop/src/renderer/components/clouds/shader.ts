/**
 * The cloud picture, drawn on the GPU in two passes.
 *
 * The field pass works at one pixel per dither cell. Clouds are separate
 * cumulus banks, each a dome on a flat base, with three sizes of round billows
 * on top. Each billow is lit by its own surface normal and shadowed by marching
 * toward the sun, so creases and bellies fall into shade. It writes brightness
 * to a texture.
 *
 * The mark pass works at full resolution: it ordered-dithers that brightness
 * into square halftone marks, bigger and brighter where the cloud is lit.
 */

export const VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FIELD_SHADER = `
precision highp float;

uniform vec2 uRes;     // field size in cells
uniform float uUnit;   // cells per cloud unit
uniform float uDrift;  // sideways drift, in cloud units
uniform float uSeed;

// Sun from above, a little left, partly toward the viewer.
const vec3 SUN = vec3(-0.45, 0.75, 0.5);
// One bank at most per grid cell, in cloud units.
const vec2 GRID = vec2(0.5, 0.3);
// Height where cloud begins.
const float EDGE = 0.5;

float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed * 1.618) * 43758.5453);
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p + uSeed) * 43758.5453);
}

// Tallest of the round billows near p: hemispheres on a jittered grid.
// Where two meet the surface dips into a crease, which the light finds.
float billows(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 d = g + hash2(i + g) - f;
      float r = 0.35 + 0.75 * hash1(i + g + 31.0);
      float s = r * r - dot(d, d);
      if (s > 0.0) h = max(h, sqrt(s) / r);
    }
  }
  return h;
}

// Cumulus banks: a half-ellipse dome standing on a lumpy, mostly flat base.
// Returns how far inside the nearest dome p is (above 0 is inside); lift is
// 0 at the base and 1 at the top, blended where banks overlap.
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

float height(vec2 p, vec2 span, out float lift) {
  float b = banks(p, lift);
  if (b < -0.8) return -1.0;
  // Thinner toward the left of the surface, so banks dissolve as they drift off.
  float side = clamp((p.x - uDrift) / span.x * 1.6, 0.0, 1.0);
  return b * 0.6
    + 0.4 * billows(p * 9.0)
    + 0.15 * billows(p * 20.0 + 5.0)
    + 0.05 * billows(p * 44.0 + 11.0)
    - (1.0 - side) * 0.3;
}

void main() {
  vec2 span = uRes / uUnit;
  // y down from the top, like the page.
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uUnit + vec2(uDrift, 0.0);

  float lift;
  float h = height(p, span, lift);
  if (h < EDGE) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Surface normal from the heightfield (y flipped back to up).
  float ignored;
  float e = 1.0 / uUnit;
  float hx = height(p + vec2(e, 0.0), span, ignored) - h;
  float hy = height(p - vec2(0.0, e), span, ignored) - h;
  vec3 n = normalize(vec3(-hx, -hy, e * 2.6));
  vec3 sun = normalize(SUN);
  float lambert = max(0.0, dot(n, sun));

  // Self-shadow: walk toward the sun; any taller cloud on the way blocks it.
  vec2 dir = normalize(vec2(sun.x, -sun.y));
  float rise = sun.z / length(sun.xy);
  float shadow = 0.0;
  float t = 0.005;
  for (int i = 0; i < 7; i++) {
    float above = height(p + dir * t, span, ignored) - (h + t * rise * 2.4);
    shadow = max(shadow, clamp(above * 5.0, 0.0, 1.0));
    t *= 1.6;
  }

  float light = 0.3 + 1.0 * lambert * (1.0 - shadow * 0.8);
  // Bellies sit in the cloud's own shade.
  light *= 0.6 + 0.4 * lift;
  gl_FragColor = vec4(clamp(light, 0.0, 1.0), 1.0, 0.0, 1.0);
}
`;

export const MARK_SHADER = `
precision highp float;

uniform sampler2D uField;
uniform vec2 uCells;    // field size in cells
uniform float uCellPx;  // device pixels per cell
uniform vec3 uShade;
uniform vec3 uMid;
uniform vec3 uLight;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCellPx);
  vec4 field = texture2D(uField, (cell + 0.5) / uCells);
  if (field.g < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float v = field.r;
  float t = bayer8(cell) + 0.5 / 64.0;

  // Halftone: the denser the tone, the bigger and brighter the mark.
  float size;
  vec3 col;
  if (v > t + 0.3) { size = 0.74; col = uLight; }
  else if (v > t) { size = 0.52; col = uMid; }
  else if (v > t * 0.45) { size = 0.4; col = uShade; }
  else {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Whole device pixels, centred in the cell, so marks stay crisp.
  float mark = max(1.0, floor(size * uCellPx + 0.5));
  float inset = floor((uCellPx - mark) * 0.5);
  vec2 local = floor(mod(gl_FragCoord.xy, uCellPx));
  if (any(lessThan(local, vec2(inset))) || any(greaterThanEqual(local, vec2(inset + mark)))) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
