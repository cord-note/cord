/**
 * The GLSL every lock-screen scene runs inside.
 *
 * A scene is only a function, `float scene(vec2 p, vec2 span)`, that returns
 * the brightness of one dither cell: 0 to 1, or below 0 for empty sky. The
 * field pass calls it once per cell and stores the result in a texture; the
 * mark pass turns that into ordered-dither marks at full resolution. So every
 * scene, built-in or from a theme, gets the same dither look.
 *
 * `p` is in scene units with y down from the top: one unit is the shorter side
 * of the surface (with slack for wide surfaces), and `span` is the surface size
 * in those units. Uniforms and helpers are listed in PRELUDE.
 */

export const VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Uniforms and helpers available to every scene. */
export const PRELUDE = `
precision highp float;

uniform vec2 uRes;     // surface size in cells
uniform float uUnit;   // cells per scene unit
uniform float uTime;   // seconds since the scene appeared; wraps every 4 hours
uniform float uSeed;   // a per-scene random number

float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed * 1.618) * 43758.5453);
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p + uSeed) * 43758.5453);
}

// Smooth value noise in [0, 1].
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash1(i);
  float b = hash1(i + vec2(1.0, 0.0));
  float c = hash1(i + vec2(0.0, 1.0));
  float d = hash1(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Four octaves of value noise, roughly in [0, 1].
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + 17.0;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

// Tallest of the round bumps near p: hemispheres on a jittered grid, in [0, 1].
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

// Coverage of a straight stroke from a to b, width w, softened over one cell.
float stroke(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float d = length(pa - ba * t);
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0 / uUnit, d);
}
`;

/** Appended after the scene's own source. */
const FIELD_MAIN = `
void main() {
  vec2 span = uRes / uUnit;
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uUnit;
  float v = scene(p, span);
  gl_FragColor = v < 0.0 ? vec4(0.0) : vec4(clamp(v, 0.0, 1.0), 1.0, 0.0, 1.0);
}
`;

export function fieldShader(sceneSource: string): string {
  return `${PRELUDE}\n// ── scene ──\n${sceneSource}\n// ── end of scene ──\n${FIELD_MAIN}`;
}

/** Ordered-dithers the field into marks: squares, or digits from an atlas. */
export const MARK_SHADER = `
precision highp float;

uniform sampler2D uField;
uniform sampler2D uGlyphs;  // ten digits in a row, one cell each
uniform vec2 uCells;        // field size in cells
uniform float uCellPx;      // device pixels per cell
uniform float uGlyph;       // 1 for digit marks
uniform float uInvert;      // 1 on a light page: dense marks mean dark
uniform float uTime;
uniform vec3 uShade;
uniform vec3 uMid;
uniform vec3 uLight;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

float rand(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCellPx);
  vec4 field = texture2D(uField, (cell + 0.5) / uCells);
  if (field.g < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float v = uInvert > 0.5 ? 1.0 - field.r : field.r;
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

  vec2 local = floor(mod(gl_FragCoord.xy, uCellPx));
  if (uGlyph > 0.5) {
    // Each cell shows a digit that changes now and then, at its own moment.
    float digit = floor(rand(cell + floor(uTime * 0.25 + rand(cell.yx) * 4.0)) * 10.0);
    vec2 uv = vec2((digit + (local.x + 0.5) / uCellPx) / 10.0, (local.y + 0.5) / uCellPx);
    float ink = texture2D(uGlyphs, uv).a;
    gl_FragColor = vec4(col, 1.0) * ink;
    return;
  }

  // Whole device pixels, centred in the cell, so marks stay crisp.
  float mark = max(1.0, floor(size * uCellPx + 0.5));
  float inset = floor((uCellPx - mark) * 0.5);
  if (any(lessThan(local, vec2(inset))) || any(greaterThanEqual(local, vec2(inset + mark)))) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
