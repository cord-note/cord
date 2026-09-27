import { describe, it, expect, beforeEach } from 'bun:test';

// Augment themes register after startup, so the saved theme can be one that
// is not available yet. The store must show the default meanwhile, keep the
// saved choice, and switch as soon as the theme registers — without the saved
// preference ever being overwritten by the fallback.

const attrs = new Map<string, string>();
const storage = new Map<string, string>();

Object.assign(globalThis, {
  document: { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } },
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  },
  window: { matchMedia: () => ({ matches: true, onchange: null }) },
});

const { useThemeStore } = await import('../theme');
const { useThemeRegistry, BUILTIN_THEMES } = await import('../../registry/ThemeRegistry');

const augment = { id: 'dithered', label: 'Dithered', description: '', source: 'augment' as const };

beforeEach(() => {
  attrs.clear();
  storage.clear();
  useThemeRegistry.setState({ themes: [...BUILTIN_THEMES] });
});

describe('theme store', () => {
  it('applies a saved built-in theme on init', () => {
    storage.set('cord-theme', 'olive');
    useThemeStore.getState().init();
    expect(attrs.get('data-theme')).toBe('olive');
  });

  it('shows the default while a saved augment theme has not registered, then switches', () => {
    storage.set('cord-theme', 'dithered');
    useThemeStore.getState().init();
    expect(attrs.get('data-theme')).toBe('mono');
    expect(useThemeStore.getState().theme).toBe('dithered');

    useThemeRegistry.getState().register(augment);
    expect(attrs.get('data-theme')).toBe('dithered');
    expect(useThemeStore.getState().activeTheme).toBe('dithered');
  });

  it('falls back when the active augment theme is unregistered, keeping the preference', () => {
    useThemeRegistry.getState().register(augment);
    useThemeStore.getState().setTheme('dithered');
    expect(attrs.get('data-theme')).toBe('dithered');

    useThemeRegistry.getState().unregister('dithered');
    expect(attrs.get('data-theme')).toBe('mono');
    expect(storage.get('cord-theme')).toBe('dithered');
  });

  it('defaults to mono with nothing saved', () => {
    useThemeStore.getState().init();
    expect(attrs.get('data-theme')).toBe('mono');
    expect(attrs.get('data-scheme')).toBe('dark');
  });
});
