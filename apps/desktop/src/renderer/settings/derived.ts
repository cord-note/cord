/**
 * Settings that don't map 1:1 onto a value in the app. Pure, so the mapping is
 * testable without a DOM; the effects that apply them live in builtin.ts.
 */

export type Density = 'compact' | 'comfortable' | 'spacious';
export type Roundness = 'sharp' | 'subtle' | 'standard' | 'round';
export type FontChoice = 'sans' | 'serif' | 'mono';
export type ListDateFormat = 'relative' | 'absolute' | 'hidden';
export type HoldSpeed = 'quick' | 'normal' | 'deliberate';

const DENSITY: Record<Density, number> = { compact: 0.8, comfortable: 1, spacious: 1.2 };
const ROUNDNESS: Record<Roundness, number> = { sharp: 0, subtle: 0.5, standard: 1, round: 1.5 };
const HOLD: Record<HoldSpeed, number> = { quick: 0.5, normal: 1, deliberate: 2 };

const SERIF = "'Iowan Old Style', 'Charter', 'Georgia', 'Cambria', serif";

function fontStack(choice: FontChoice, sans: string | null): string | null {
  if (choice === 'serif') return SERIF;
  if (choice === 'mono') return 'var(--font-mono)';
  return sans;
}

/**
 * CSS variables for the appearance settings; null means "remove the override".
 * Defaults remove everything, so a theme or augment that sets these tokens
 * keeps control until the user picks something else.
 */
export function appearanceVars(values: Readonly<Record<string, unknown>>): Record<string, string | null> {
  const text = values['appearance.textScale'] as number;
  const density = DENSITY[values['appearance.density'] as Density];
  const roundness = ROUNDNESS[values['appearance.roundness'] as Roundness];
  return {
    '--text-scale': text === 100 ? null : String(text / 100),
    '--space-scale': density === 1 ? null : String(density),
    '--radius-scale': roundness === 1 ? null : String(roundness),
    '--font-ui': fontStack(values['appearance.uiFont'] as FontChoice, null),
    '--editor-font': fontStack(values['editor.fontFamily'] as FontChoice, null),
  };
}

/** A note row's date in the chosen format; null when dates are hidden. */
export function formatListDate(ms: number, format: ListDateFormat, now: number = Date.now()): string | null {
  if (format === 'hidden') return null;
  const d = new Date(ms);
  if (format === 'absolute') {
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const diffDays = Math.floor((now - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** A hold-to-confirm duration scaled by the user's preference. */
export function holdDuration(baseMs: number, speed: HoldSpeed): number {
  return Math.round(baseMs * HOLD[speed]);
}
