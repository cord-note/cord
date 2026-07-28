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

/** Colours offered by the picker, narrowed when distinct mode is enabled. */
export function vaultColorOptions(distinctOnly: boolean): readonly string[] {
  return distinctOnly ? DISTINCT_VAULT_COLORS : VAULT_COLORS;
}

/** Random colour for a newly created vault, respecting distinct mode. */
export function randomVaultColor(distinctOnly = false): string {
  const pool = vaultColorOptions(distinctOnly);
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_VAULT_COLOR;
}
