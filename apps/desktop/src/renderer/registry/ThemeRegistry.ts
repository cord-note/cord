import { create } from 'zustand';

import { BUILTIN_THEMES, DEFAULT_THEME_ID, type ThemeRegistration } from '@shared/theming/builtinThemes';

export { BUILTIN_THEMES, DEFAULT_THEME_ID };
export type { ThemeRegistration, ThemeSource } from '@shared/theming/builtinThemes';

// Lowercase slug: safe inside an attribute selector without escaping.
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface ThemeRegistryStore {
  themes: ThemeRegistration[];
  register:   (reg: ThemeRegistration) => void;
  unregister: (id: string) => void;
}

export const useThemeRegistry = create<ThemeRegistryStore>((set, get) => ({
  themes: [...BUILTIN_THEMES],

  // Re-registering an library theme replaces it, so reloading a library is
  // idempotent. Built-in themes can never be replaced.
  register: (reg) => {
    if (!THEME_ID.test(reg.id)) {
      throw new Error(`Invalid theme id "${reg.id}": use lowercase letters, digits and dashes`);
    }
    const existing = get().themes.find((t) => t.id === reg.id);
    if (existing?.source === 'builtin') {
      throw new Error(`Theme id "${reg.id}" belongs to a built-in theme`);
    }
    set((s) => ({
      themes: existing
        ? s.themes.map((t) => (t.id === reg.id ? reg : t))
        : [...s.themes, reg],
    }));
  },

  unregister: (id) => {
    const existing = get().themes.find((t) => t.id === id);
    if (!existing) return;
    if (existing.source === 'builtin') {
      throw new Error(`Built-in theme "${id}" cannot be unregistered`);
    }
    set((s) => ({ themes: s.themes.filter((t) => t.id !== id) }));
  },
}));

// The theme to actually show for a stored preference. An library theme can be
// preferred before the library has loaded — or after it was removed — so an
// unknown id falls back to the default rather than leaving the app unstyled.
export function resolveThemeId(preferred: string, themes: readonly ThemeRegistration[]): string {
  return themes.some((t) => t.id === preferred) ? preferred : DEFAULT_THEME_ID;
}
