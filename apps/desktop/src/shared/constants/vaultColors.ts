// Vault colour palette.
//
// Previously duplicated between SettingsPage (12 colours) and VaultSidebar
// (the same list minus #dce775), which meant a randomly-created vault could
// never get one of the colours the settings picker offered. Single source now.
//
// The palette is laid out as a "digital palette": 12 hue families across,
// 4 shades down. Row index 1 (BASE) is the original 12-colour list, so every
// vault created before this change keeps a colour that still exists here.

export interface VaultColorFamily {
  /** Human-readable hue name, used for the swatch tooltip. */
  name: string;
  /** Four shades, light → deep. */
  shades: readonly [string, string, string, string];
}

export const VAULT_COLOR_FAMILIES: readonly VaultColorFamily[] = [
  { name: 'Violet',    shades: ['#b3a7fa', '#7c6af7', '#5a44e0', '#3f2fb0'] },
  { name: 'Blue',      shades: ['#9bc0fb', '#4f8ef7', '#2f6fd8', '#1f4fa0'] },
  { name: 'Sky',       shades: ['#9adcfb', '#4fc3f7', '#29a8e0', '#1b7fac'] },
  { name: 'Teal',      shades: ['#9ad7d1', '#4db6ac', '#2f958b', '#1f6b64'] },
  { name: 'Green',     shades: ['#b5dfb7', '#81c784', '#57a95b', '#3b7d3e'] },
  { name: 'Lime',      shades: ['#ecf2ab', '#dce775', '#bfcc4e', '#8e9a2f'] },
  { name: 'Amber',     shades: ['#ffd499', '#ffb74d', '#f59418', '#b86c0c'] },
  { name: 'Coral',     shades: ['#ffb9a2', '#ff8a65', '#f2603a', '#b8421f'] },
  { name: 'Pink',      shades: ['#f7a3bd', '#f06292', '#d93a70', '#a52450'] },
  { name: 'Purple',    shades: ['#d7a3e0', '#ba68c8', '#9a42aa', '#6f2c7c'] },
  { name: 'Clay',      shades: ['#c6b5ae', '#a1887f', '#7d635a', '#57443e'] },
  { name: 'Slate',     shades: ['#bcc8ce', '#90a4ae', '#6b7f8a', '#4a5a63'] },
] as const;

/** Shade row labels, aligned with the tuple order in `shades`. */
export const VAULT_SHADE_LABELS = ['Light', 'Base', 'Strong', 'Deep'] as const;

/** Every colour in the palette, flattened. */
export const VAULT_COLORS: readonly string[] = VAULT_COLOR_FAMILIES.flatMap((f) => f.shades);

/**
 * Curated high-contrast subset used when "Use Distinct Vault Colours" is on.
 * Hues are spaced far enough apart to stay tellable at 8px — the size a vault
 * dot actually renders at in the collapsed rail.
 */
export const DISTINCT_VAULT_COLORS: readonly string[] = [
  '#4f8ef7', // blue
  '#4db6ac', // teal
  '#57a95b', // green
  '#bfcc4e', // lime
  '#ffb74d', // amber
  '#f2603a', // coral
  '#f06292', // pink
  '#ba68c8', // purple
  '#a1887f', // clay
  '#90a4ae', // slate
];

export const DEFAULT_VAULT_COLOR = '#7c6af7';

const DISTINCT_SET = new Set(DISTINCT_VAULT_COLORS.map((c) => c.toLowerCase()));

/** True when a colour is already part of the curated distinct set. */
export function isDistinctVaultColor(color: string | null | undefined): boolean {
  return color !== null && color !== undefined && DISTINCT_SET.has(color.toLowerCase());
}

/** Fallback when a vault has no colour, or an unparseable one. */
export const DEFAULT_DISTINCT_COLOR: string = DISTINCT_VAULT_COLORS[0] ?? DEFAULT_VAULT_COLOR;

interface Hsl { h: number; s: number; l: number }

function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r)      h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else                h = 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

/** Shortest way round the colour wheel, 0–180. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Below this, a colour reads as a neutral and its hue is essentially noise. */
const NEUTRAL_SATURATION = 0.25;

/**
 * The distinct-set colour closest to `color`.
 *
 * Matching is done in HSL and led by hue, not by RGB distance. Plain RGB
 * distance is dominated by lightness, which sent pale green to slate — the
 * four shades of one hue family have to land on that family's curated colour,
 * because that is the whole promise of the setting.
 *
 * Near-greys are matched among the curated neutrals only, by lightness: their
 * hue carries no information worth honouring.
 */
export function nearestDistinctColor(color: string | null | undefined): string {
  const target = color ? hexToHsl(color) : null;
  if (!target) return DEFAULT_DISTINCT_COLOR;

  const candidates = DISTINCT_VAULT_COLORS
    .map((hex) => ({ hex, hsl: hexToHsl(hex) }))
    .filter((c): c is { hex: string; hsl: Hsl } => c.hsl !== null);

  // Neutrals and chromatics are matched within their own group. Crossing the
  // line is always wrong in one direction or the other: a vivid sky blue sits
  // one degree of hue from slate and would otherwise turn grey.
  const isNeutral = target.s < NEUTRAL_SATURATION;
  const pool = candidates.filter((c) => (c.hsl.s < NEUTRAL_SATURATION) === isNeutral);
  const searched = pool.length > 0 ? pool : candidates;

  let best = searched[0]?.hex ?? DEFAULT_DISTINCT_COLOR;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const c of searched) {
    // Among chromatics hue leads and the rest breaks ties. Among neutrals
    // lightness leads, with just enough hue weight to keep a cool grey cool.
    const score = isNeutral
      ? Math.abs(target.l - c.hsl.l) * 10 + hueDistance(target.h, c.hsl.h) * 0.15
      : hueDistance(target.h, c.hsl.h)
        + Math.abs(target.s - c.hsl.s) * 12
        + Math.abs(target.l - c.hsl.l) * 8;

    if (score < bestScore) {
      bestScore = score;
      best = c.hex;
    }
  }
  return best;
}

/** Colours offered by the picker, narrowed when distinct mode is enabled. */
export function vaultColorOptions(distinctOnly: boolean): readonly string[] {
  return distinctOnly ? DISTINCT_VAULT_COLORS : VAULT_COLORS;
}

/** Random colour for a newly created vault, respecting distinct mode. */
export function randomVaultColor(distinctOnly = false): string {
  const pool = vaultColorOptions(distinctOnly);
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_VAULT_COLOR;
}
