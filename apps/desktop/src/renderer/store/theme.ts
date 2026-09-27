import { create } from 'zustand';
import { DEFAULT_THEME_ID, resolveThemeId, useThemeRegistry } from '../registry/ThemeRegistry';
import { getSetting, setSetting, useSettings } from '../settings';

export type ColorScheme = 'dark' | 'light' | 'system';

interface ThemeStore {
  /** The saved choice (the `appearance.theme` setting), even while unavailable. */
  theme:       string;
  /** What is actually applied: `theme` if registered, otherwise the default. */
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

function apply(themeId: string, scheme: ColorScheme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);
  root.setAttribute('data-scheme', resolveScheme(scheme));
}

let systemQuery: MediaQueryList | null = null;

function watchSystemScheme(scheme: ColorScheme): void {
  if (systemQuery) systemQuery.onchange = null;
  systemQuery = null;
  if (scheme !== 'system') return;
  systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemQuery.onchange = () => apply(useThemeStore.getState().activeTheme, 'system');
}

let applied = false;

/** Bring the store and the document in line with the settings and registry. */
function sync(): void {
  const theme = getSetting('appearance.theme');
  const colorScheme = getSetting('appearance.colorScheme');
  const activeTheme = resolveThemeId(theme, useThemeRegistry.getState().themes);
  const current = useThemeStore.getState();
  if (applied && current.theme === theme && current.activeTheme === activeTheme && current.colorScheme === colorScheme) {
    return;
  }
  applied = true;
  useThemeStore.setState({ theme, activeTheme, colorScheme });
  apply(activeTheme, colorScheme);
  watchSystemScheme(colorScheme);
}

export const useThemeStore = create<ThemeStore>(() => ({
  theme:       DEFAULT_THEME_ID,
  activeTheme: DEFAULT_THEME_ID,
  colorScheme: 'dark',

  setTheme:       (id) => setSetting('appearance.theme', id),
  setColorScheme: (scheme) => setSetting('appearance.colorScheme', scheme),

  init: () => {
    applied = false;
    sync();
  },
}));

// Settings change when the file loads or the user picks a theme; the registry
// changes when augments register their themes after startup.
useSettings.subscribe(sync);
useThemeRegistry.subscribe(sync);
