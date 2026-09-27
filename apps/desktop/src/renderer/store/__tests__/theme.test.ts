import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Theme and colour mode are settings now. The theme store still owns which
// theme is actually shown: a saved augment theme shows the default until its
// augment registers, and the saved choice is never overwritten by the fallback.

const attrs = new Map<string, string>();
Object.assign(globalThis, {
  document: { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), style: { setProperty: () => {} } } },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  window: { matchMedia: () => ({ matches: true, onchange: null }), addEventListener: () => {} },
});

mock.module('@renderer/ipc', () => ({
  api: { settings: { read: async () => ({ text: null }), write: async () => ({ ok: true }) } },
}));

const { registerSetting, useSettings, setSetting, getSetting } = await import('../../settings');
const { useThemeStore } = await import('../theme');
const { useThemeRegistry, BUILTIN_THEMES } = await import('../../registry/ThemeRegistry');

registerSetting({
  key: 'appearance.theme', type: 'string', title: '', description: '', section: 'Appearance',
  default: 'mono', pattern: /^[a-z0-9][a-z0-9-]{0,63}$/,
});
registerSetting({
  key: 'appearance.colorScheme', type: 'enum', title: '', description: '', section: 'Appearance', default: 'dark',
  options: [{ value: 'dark', label: '' }, { value: 'light', label: '' }, { value: 'system', label: '' }],
});

const augment = { id: 'dithered', label: 'Dithered', description: '', source: 'augment' as const };

beforeEach(() => {
  attrs.clear();
  useThemeRegistry.setState({ themes: [...BUILTIN_THEMES] });
  useSettings.setState({ values: { 'appearance.theme': 'mono', 'appearance.colorScheme': 'dark' }, data: {}, text: '', syntaxError: false });
  useThemeStore.getState().init();
});

describe('theme store', () => {
  it('applies the theme setting', () => {
    setSetting('appearance.theme', 'olive');
    expect(attrs.get('data-theme')).toBe('olive');
    expect(useThemeStore.getState().theme).toBe('olive');
  });

  it('setTheme and setColorScheme write the settings', () => {
    useThemeStore.getState().setTheme('teal');
    useThemeStore.getState().setColorScheme('light');
    expect(getSetting('appearance.theme')).toBe('teal');
    expect(getSetting('appearance.colorScheme')).toBe('light');
    expect(attrs.get('data-scheme')).toBe('light');
  });

  it('shows the default until a saved augment theme registers, then switches', () => {
    setSetting('appearance.theme', 'dithered');
    expect(attrs.get('data-theme')).toBe('mono');
    expect(useThemeStore.getState().theme).toBe('dithered');
    useThemeRegistry.getState().register(augment);
    expect(attrs.get('data-theme')).toBe('dithered');
  });

  it('falls back when the active augment theme is unregistered, keeping the setting', () => {
    useThemeRegistry.getState().register(augment);
    setSetting('appearance.theme', 'dithered');
    useThemeRegistry.getState().unregister('dithered');
    expect(attrs.get('data-theme')).toBe('mono');
    expect(getSetting('appearance.theme')).toBe('dithered');
  });
});
