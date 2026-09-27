import { describe, it, expect } from 'bun:test';
import { appearanceVars, formatListDate, holdDuration } from '../derived';

// Settings that don't map 1:1 onto a value in the app: appearance choices
// become CSS variables, the note list's date follows a format, and hold
// durations scale. Defaults must leave the app exactly as it was.

const defaults = {
  'appearance.textScale': 100,
  'appearance.density': 'comfortable',
  'appearance.roundness': 'standard',
  'appearance.uiFont': 'sans',
  'editor.fontFamily': 'sans',
};

describe('appearanceVars', () => {
  it('removes every override at the defaults, so themes and augments stay in charge', () => {
    expect(Object.values(appearanceVars(defaults)).every((v) => v === null)).toBe(true);
  });

  it('maps choices onto the scale and font tokens', () => {
    const vars = appearanceVars({
      ...defaults,
      'appearance.textScale': 115,
      'appearance.density': 'compact',
      'appearance.roundness': 'sharp',
      'appearance.uiFont': 'serif',
      'editor.fontFamily': 'mono',
    });
    expect(vars['--text-scale']).toBe('1.15');
    expect(vars['--space-scale']).toBe('0.8');
    expect(vars['--radius-scale']).toBe('0');
    expect(vars['--font-ui']).toMatch(/serif/);
    expect(vars['--editor-font']).toBe('var(--font-mono)');
  });
});

describe('formatListDate', () => {
  const now = new Date(2026, 8, 27, 15, 0).getTime();
  const earlier = new Date(2026, 8, 1, 9, 30).getTime();

  it('hides the date', () => {
    expect(formatListDate(earlier, 'hidden', now)).toBeNull();
  });

  it('shows a time for today in relative mode', () => {
    expect(formatListDate(new Date(2026, 8, 27, 9, 5).getTime(), 'relative', now)).toMatch(/9|09/);
  });

  it('always includes the year in absolute mode', () => {
    expect(formatListDate(earlier, 'absolute', now)).toContain('2026');
    expect(formatListDate(earlier, 'relative', now)).not.toContain('2026');
  });
});

describe('holdDuration', () => {
  it('scales a base duration', () => {
    expect(holdDuration(400, 'normal')).toBe(400);
    expect(holdDuration(400, 'quick')).toBe(200);
    expect(holdDuration(400, 'deliberate')).toBe(800);
  });
});
