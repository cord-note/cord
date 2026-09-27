import { describe, it, expect, beforeEach } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  resolveThemeId,
  useThemeRegistry,
  type ThemeRegistration,
} from '../ThemeRegistry';

// Themes are an open set: built-ins plus whatever augments register at
// runtime. Built-ins must stay untouchable, and a preferred theme that is not
// (or no longer) registered must fall back instead of leaving the app unstyled.

const augment = (id: string, label = id): ThemeRegistration =>
  ({ id, label, description: '', source: 'augment' });

const ids = (): string[] => useThemeRegistry.getState().themes.map((t) => t.id);

beforeEach(() => {
  useThemeRegistry.setState({ themes: [...BUILTIN_THEMES] });
});

describe('ThemeRegistry', () => {
  it('starts with the built-in themes, default first', () => {
    expect(ids()).toEqual(BUILTIN_THEMES.map((t) => t.id));
    expect(ids()[0]).toBe(DEFAULT_THEME_ID);
  });

  it('adds an augment theme after the built-ins', () => {
    useThemeRegistry.getState().register(augment('dithered'));
    expect(ids()[ids().length - 1]).toBe('dithered');
  });

  it('replaces an augment theme registered twice, keeping its place', () => {
    const { register } = useThemeRegistry.getState();
    register(augment('dithered', 'Old'));
    register(augment('solar'));
    register(augment('dithered', 'New'));
    const themes = useThemeRegistry.getState().themes;
    expect(themes.filter((t) => t.id === 'dithered')).toHaveLength(1);
    expect(themes[themes.length - 2]?.label).toBe('New');
  });

  it('refuses to replace a built-in theme', () => {
    expect(() => useThemeRegistry.getState().register(augment('blue'))).toThrow(/built-in/);
    expect(useThemeRegistry.getState().themes.find((t) => t.id === 'blue')?.source).toBe('builtin');
  });

  it('refuses ids that are unsafe in an attribute selector', () => {
    const { register } = useThemeRegistry.getState();
    for (const bad of ['', 'Blue', 'my theme', 'a"]', '-lead', 'x'.repeat(65)]) {
      expect(() => register(augment(bad))).toThrow(/Invalid theme id/);
    }
  });

  it('unregisters augment themes but never built-ins', () => {
    const { register, unregister } = useThemeRegistry.getState();
    register(augment('dithered'));
    unregister('dithered');
    expect(ids()).not.toContain('dithered');
    expect(() => unregister('mono')).toThrow(/cannot be unregistered/);
    expect(() => unregister('never-registered')).not.toThrow();
  });
});

describe('resolveThemeId', () => {
  it('keeps a registered preference', () => {
    expect(resolveThemeId('teal', BUILTIN_THEMES)).toBe('teal');
  });

  it('falls back to the default for an unknown preference', () => {
    expect(resolveThemeId('removed-augment', BUILTIN_THEMES)).toBe(DEFAULT_THEME_ID);
  });
});

describe('built-in themes and global.css', () => {
  const css = readFileSync(join(import.meta.dir, '..', '..', 'styles', 'global.css'), 'utf8');
  const styled = new Set([...css.matchAll(/\[data-theme="([a-z0-9-]+)"\]/g)].map((m) => m[1]!));

  // The default theme is the base :root block, so it has no selector of its own.
  it('every built-in theme except the default has colours in global.css', () => {
    const missing = BUILTIN_THEMES.map((t) => t.id)
      .filter((id) => id !== DEFAULT_THEME_ID && !styled.has(id));
    expect(missing).toEqual([]);
  });

  it('every themed block in global.css belongs to a registered built-in', () => {
    const builtin = new Set(BUILTIN_THEMES.map((t) => t.id));
    expect([...styled].filter((id) => !builtin.has(id))).toEqual([]);
  });
});
