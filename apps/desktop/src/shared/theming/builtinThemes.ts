// Where a theme came from. Built-in themes ship in global.css; library themes
// are loaded from the theme library folder with their own stylesheet.
export type ThemeSource = 'builtin' | 'library';

export interface ThemeRegistration {
  // Written into data-theme and matched by [data-theme="<id>"] selectors.
  id: string;
  label: string;
  description: string;
  source: ThemeSource;
  author?: string;
}

export const DEFAULT_THEME_ID = 'mono';

// Colours for every built-in theme live in renderer/styles/global.css, keyed by id.
export const BUILTIN_THEMES: readonly ThemeRegistration[] = [
  { id: 'mono',      label: 'Monochrome', description: 'Classic black & white',   source: 'builtin' },
  { id: 'blue',      label: 'Blue',       description: 'Deep navy + sky blue',    source: 'builtin' },
  { id: 'olive',     label: 'Olive',      description: 'Forest green + amber',    source: 'builtin' },
  { id: 'teal',      label: 'Teal',       description: 'Deep sea + coral',        source: 'builtin' },
  { id: 'midnight',  label: 'Midnight',   description: 'Dark navy + rose',        source: 'builtin' },
  { id: 'rosewood',  label: 'Rosewood',   description: 'Warm brown + dusty rose', source: 'builtin' },
  { id: 'parchment', label: 'Parchment',  description: 'Warm paper + caramel',    source: 'builtin' },
];
