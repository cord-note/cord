import { describe, expect, it } from 'bun:test';
import {
  DISTINCT_VAULT_COLORS,
  DEFAULT_DISTINCT_COLOR,
  isDistinctVaultColor,
  nearestDistinctColor,
  VAULT_COLORS,
} from '../constants/vaultColors';

// Turning "distinct vault colors" on repaints existing vaults, so a bad
// mapping silently rewrites data the user chose by hand. Every colour in the
// full palette must land somewhere sensible, and nothing may map to nothing.

describe('isDistinctVaultColor', () => {
  it('accepts every colour in the curated set, in any case', () => {
    for (const c of DISTINCT_VAULT_COLORS) {
      expect(isDistinctVaultColor(c)).toBe(true);
      expect(isDistinctVaultColor(c.toUpperCase())).toBe(true);
    }
  });

  it('rejects a colour outside the set, and a missing one', () => {
    expect(isDistinctVaultColor('#3f2fb0')).toBe(false);
    expect(isDistinctVaultColor(null)).toBe(false);
    expect(isDistinctVaultColor(undefined)).toBe(false);
  });
});

describe('nearestDistinctColor', () => {
  it('leaves a colour that is already distinct alone', () => {
    for (const c of DISTINCT_VAULT_COLORS) {
      expect(nearestDistinctColor(c)).toBe(c);
    }
  });

  it('maps every palette colour into the curated set', () => {
    for (const c of VAULT_COLORS) {
      expect(isDistinctVaultColor(nearestDistinctColor(c))).toBe(true);
    }
  });

  it('keeps the hue family — shades map to their own hue, not across the wheel', () => {
    // Green's four shades all belong with the curated green. Lightness must
    // not outvote hue here: plain RGB distance sent the palest one to slate.
    for (const shade of ['#b5dfb7', '#81c784', '#57a95b', '#3b7d3e']) {
      expect(nearestDistinctColor(shade)).toBe('#57a95b');
    }
    // Violet and Sky have no curated entry of their own; both sit nearest to
    // blue on the wheel.
    expect(nearestDistinctColor('#7c6af7')).toBe('#4f8ef7');
    expect(nearestDistinctColor('#4fc3f7')).toBe('#4f8ef7');
  });

  it('does not turn a saturated colour grey, or a grey colourful', () => {
    // Sky sits one degree of hue from slate; only the saturation gap keeps it
    // out of the neutrals.
    expect(nearestDistinctColor('#29a8e0')).toBe('#4f8ef7');
    // …and the reverse: a cool grey stays a cool grey.
    expect(nearestDistinctColor('#6b7f8a')).toBe('#90a4ae');
    expect(nearestDistinctColor('#c6b5ae')).toBe('#a1887f');
  });

  it('falls back rather than throwing on junk input', () => {
    expect(nearestDistinctColor(null)).toBe(DEFAULT_DISTINCT_COLOR);
    expect(nearestDistinctColor('')).toBe(DEFAULT_DISTINCT_COLOR);
    expect(nearestDistinctColor('rebeccapurple')).toBe(DEFAULT_DISTINCT_COLOR);
    expect(nearestDistinctColor('#fff')).toBe(DEFAULT_DISTINCT_COLOR);
  });
});
