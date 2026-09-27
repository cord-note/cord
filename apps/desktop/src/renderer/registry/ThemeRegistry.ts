import { create } from 'zustand';

// Where a theme came from. Built-in themes ship in global.css; augment themes
// arrive at runtime with their own [data-theme="<id>"] stylesheet.
export type ThemeSource = 'builtin' | 'augment';

export interface ThemeRegistration {
  // Written into data-theme and matched by [data-theme="<id>"] selectors.
  id: string;
  label: string;
  description: string;
  source: ThemeSource;
}

export const DEFAULT_THEME_ID = 'mono';

// Colours for every built-in theme live in styles/global.css, keyed by id.
export const BUILTIN_THEMES: readonly ThemeRegistration[] = [
  { id: 'mono',      label: 'Monochrome', description: 'Classic black & white',   source: 'builtin' },
  { id: 'blue',      label: 'Blue',       description: 'Deep navy + sky blue',    source: 'builtin' },
  { id: 'olive',     label: 'Olive',      description: 'Forest green + amber',    source: 'builtin' },
  { id: 'teal',      label: 'Teal',       description: 'Deep sea + coral',        source: 'builtin' },
  { id: 'midnight',  label: 'Midnight',   description: 'Dark navy + rose',        source: 'builtin' },
  { id: 'rosewood',  label: 'Rosewood',   description: 'Warm brown + dusty rose', source: 'builtin' },
  { id: 'parchment', label: 'Parchment',  description: 'Warm paper + caramel',    source: 'builtin' },
];

// Lowercase slug: safe inside an attribute selector without escaping.
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface ThemeRegistryStore {
  themes: ThemeRegistration[];
  register:   (reg: ThemeRegistration) => void;
  unregister: (id: string) => void;
}

export const useThemeRegistry = create<ThemeRegistryStore>((set, get) => ({
  themes: [...BUILTIN_THEMES],

  // Re-registering an augment theme replaces it, so reloading an augment is
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

// The theme to actually show for a stored preference. An augment theme can be
// preferred before its augment has loaded — or after it was removed — so an
// unknown id falls back to the default rather than leaving the app unstyled.
export function resolveThemeId(preferred: string, themes: readonly ThemeRegistration[]): string {
  return themes.some((t) => t.id === preferred) ? preferred : DEFAULT_THEME_ID;
}
