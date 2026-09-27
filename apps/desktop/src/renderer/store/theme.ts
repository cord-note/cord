import { create } from 'zustand';
import { DEFAULT_THEME_ID, resolveThemeId, useThemeRegistry } from '../registry/ThemeRegistry';

export type ColorScheme = 'dark' | 'light' | 'system';

interface ThemeStore {
  // The user's choice, persisted as-is even while that theme is unavailable.
  theme:       string;
  // What is actually applied: `theme` if registered, otherwise the default.
  activeTheme: string;
  colorScheme: ColorScheme;
  setTheme:       (id: string)     => void;
  setColorScheme: (s: ColorScheme) => void;
  init:        () => void;
}

export function resolveScheme(scheme: ColorScheme): 'dark' | 'light' {
  if (scheme !== 'system') return scheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(themeId: string, scheme: ColorScheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);
  root.setAttribute('data-scheme', resolveScheme(scheme));
}

function resolve(preferred: string): string {
  return resolveThemeId(preferred, useThemeRegistry.getState().themes);
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme:       DEFAULT_THEME_ID,
  activeTheme: DEFAULT_THEME_ID,
  colorScheme: 'dark',

  setTheme: (theme) => {
    const activeTheme = resolve(theme);
    set({ theme, activeTheme });
    localStorage.setItem('cord-theme', theme);
    apply(activeTheme, get().colorScheme);
  },

  setColorScheme: (colorScheme) => {
    set({ colorScheme });
    localStorage.setItem('cord-scheme', colorScheme);
    apply(get().activeTheme, colorScheme);

    if (colorScheme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.onchange = () => apply(get().activeTheme, get().colorScheme);
    }
  },

  init: () => {
    const theme       = localStorage.getItem('cord-theme') ?? DEFAULT_THEME_ID;
    const colorScheme = (localStorage.getItem('cord-scheme') as ColorScheme) ?? 'dark';
    const activeTheme = resolve(theme);
    set({ theme, activeTheme, colorScheme });
    apply(activeTheme, colorScheme);

    if (colorScheme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.onchange = () => apply(get().activeTheme, get().colorScheme);
    }
  },
}));

// Augment themes register after init. When the preferred theme arrives, switch
// to it; when the active one is unregistered, fall back to the default.
useThemeRegistry.subscribe((registry) => {
  const { theme, activeTheme, colorScheme } = useThemeStore.getState();
  const next = resolveThemeId(theme, registry.themes);
  if (next === activeTheme) return;
  useThemeStore.setState({ activeTheme: next });
  apply(next, colorScheme);
});
