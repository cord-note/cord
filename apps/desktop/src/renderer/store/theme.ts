import { create } from 'zustand';

export type Theme = 'mono' | 'blue' | 'olive' | 'teal' | 'midnight' | 'rosewood' | 'parchment';
export type ColorScheme = 'dark' | 'light' | 'system';

interface ThemeStore {
  theme:       Theme;
  colorScheme: ColorScheme;
  setTheme:       (t: Theme)       => void;
  setColorScheme: (s: ColorScheme) => void;
  init:        () => void;
}

function resolveScheme(scheme: ColorScheme): 'dark' | 'light' {
  if (scheme !== 'system') return scheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme, scheme: ColorScheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-scheme', resolveScheme(scheme));
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme:       'mono',
  colorScheme: 'dark',

  setTheme: (theme) => {
    set({ theme });
    localStorage.setItem('cord-theme', theme);
    apply(theme, get().colorScheme);
  },

  setColorScheme: (colorScheme) => {
    set({ colorScheme });
    localStorage.setItem('cord-scheme', colorScheme);
    apply(get().theme, colorScheme);

    if (colorScheme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.onchange = () => apply(get().theme, get().colorScheme);
    }
  },

  init: () => {
    const theme       = (localStorage.getItem('cord-theme')  as Theme)       ?? 'mono';
    const colorScheme = (localStorage.getItem('cord-scheme') as ColorScheme) ?? 'dark';
    set({ theme, colorScheme });
    apply(theme, colorScheme);

    if (colorScheme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.onchange = () => apply(get().theme, get().colorScheme);
    }
  },
}));
