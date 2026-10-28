import type { LoginScene } from '@shared/types';

/**
 * A flower drawn in digits: two layers of pointed petals around a dark centre,
 * on a long stem. It sways from the stem's foot and the petals flutter, while
 * the digits themselves slowly change.
 */
export const flower: LoginScene = {
  id: 'flower',
  name: 'Flower',
  marks: 'glyph',
  fps: 5,
  cell: 7,
  source: `
const float PI = 3.14159265;

// Brightness of one ring of petals at d (from the centre), or -1 outside them.
float petals(vec2 d, float count, float len, float width, float turn, float lift, float salt) {
  float best = -1.0;
  for (int i = 0; i < 15; i++) {
    float fi = float(i);
    if (fi >= count) break;
    float a = (fi + turn + 0.35 * (hash1(vec2(fi, salt)) - 0.5)) / count * 2.0 * PI;
    a += 0.03 * sin(uTime * 1.1 + fi * 1.7 + salt);
    vec2 dir = vec2(cos(a), sin(a));
    // Seen a little from the side: petals pointing down are foreshortened.
    float l = len * (0.82 + 0.3 * hash1(vec2(salt, fi))) * (0.45 + 0.55 * clamp(-dir.y + 0.5, 0.0, 1.0));
    float along = dot(d, dir) / l;
    float across = abs(dot(d, vec2(-dir.y, dir.x))) / l;
    if (along <= 0.0 || along >= 1.0) continue;
    // Full in the middle, rounded at the tip.
    float w = width * pow(sin(PI * pow(along, 0.8)), 0.55);
    if (across >= w) continue;
    float edge = across / w;
    // Dark at the heart, light toward the tip and the rims, a darker vein.
    float v = 0.3 + 0.5 * along + 0.18 * smoothstep(0.55, 1.0, edge) + lift;
    v -= 0.25 * exp(-edge * edge * 40.0) * (1.0 - along);
    v += 0.12 * (hash1(vec2(fi, salt + 7.0)) - 0.5);
    best = max(best, v);
  }
  return best;
}

float scene(vec2 p, vec2 span) {
  vec2 foot = vec2(span.x * 0.6, span.y + 0.05);
  vec2 center = vec2(span.x * 0.6, span.y * 0.45);

  // Sway: the whole flower tilts about the foot of its stem.
  float sway = 0.035 * sin(uTime * 0.5) + 0.012 * sin(uTime * 1.3);
  vec2 r = p - foot;
  float c = cos(sway);
  float s = sin(sway);
  p = foot + vec2(c * r.x - s * r.y, s * r.x + c * r.y);

  // The ring of petals is tilted toward the viewer, so it reads as a head, not a star.
  vec2 d = (p - center) * vec2(1.0, 1.3);

  // Centre: a dark, textured disc on top of the petals.
  vec2 disc = d / vec2(0.1, 0.1);
  if (dot(disc, disc) < 1.0) return 0.12 + 0.35 * fbm(d * 45.0);

  float front = petals(d, 9.0, 0.25, 0.24, 0.5, 0.08, 3.0);
  if (front >= 0.0) return front;
  float back = petals(d, 14.0, 0.4, 0.2, 0.0, 0.0, 11.0);
  if (back >= 0.0) return back;

  // Stem: from under the flower to the bottom, with a slight bend.
  float t = clamp((p.y - center.y) / (foot.y - center.y), 0.0, 1.0);
  float x = mix(center.x, foot.x, t) + 0.015 * sin(t * PI);
  float stem = abs(p.x - x);
  if (p.y > center.y && stem < 0.014) return 0.45 + 0.25 * (1.0 - stem / 0.014);
  return -1.0;
}
`,
};
