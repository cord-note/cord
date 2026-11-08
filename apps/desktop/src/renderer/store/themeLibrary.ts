import { create } from 'zustand';
import type { LibraryTheme, LoginScene, ThemeFileProblem, ThemeImportResult } from '@shared/types';
import { api } from '../ipc';
import { log } from '../lib/log';
import { useThemeRegistry, type ThemeRegistration } from '../registry/ThemeRegistry';
import { getSetting, lastCacheUser, useSettings } from '../settings';
import { useThemeStore } from './theme';

// Library themes: read from the theme folder by cord-core and filtered
// to the public theme API in the renderer), injected as one <style> each and registered so the
// gallery and data-theme can use them. Every library theme's CSS is loaded at
// once because the gallery previews them all; the filter guarantees each rule
// is scoped to its own [data-theme], so only the chosen one takes effect.

const STYLE_ATTR = 'data-cord-library-theme';
/** The chosen library theme, so the lock screen and first frame paint in it. */
const cacheKey = (userId: string): string => `cord-theme-cache:${userId}`;
/** Every library theme's lock-screen scenes, so the lock screen can show any of them before unlock. */
const scenesKey = (userId: string): string => `cord-login-scenes:${userId}`;

/** The lock-screen scenes one library theme brings. */
export interface ThemeScenes {
  themeId: string;
  label: string;
  scenes: LoginScene[];
}

interface ThemeLibraryStore {
  /** The folder last read. */
  dir: string;
  defaultDir: string;
  themes: LibraryTheme[];
  problems: ThemeFileProblem[];
  scanning: boolean;
  error: string | null;
  /** Scenes from every library theme: from the last scan, or the boot cache before one. */
  sceneGroups: ThemeScenes[];
  scan:       () => Promise<void>;
  importFrom: (source: string) => Promise<ThemeImportResult>;
  importUrl:  (url: string) => Promise<ThemeImportResult>;
}

export const useThemeLibrary = create<ThemeLibraryStore>((set, get) => ({
  dir: '',
  defaultDir: '',
  themes: [],
  problems: [],
  scanning: false,
  error: null,
  sceneGroups: [],

  scan: async () => {
    set({ scanning: true });
    try {
      const [scan, { dir: defaultDir }] = await Promise.all([
        api.themes.scan(getSetting('appearance.themeLibrary')),
        api.themes.defaultDir(),
      ]);
      apply(scan.themes);
      const sceneGroups = scan.themes
        .filter((t) => t.scenes.length > 0)
        .map((t) => ({ themeId: t.id, label: t.label, scenes: t.scenes }));
      set({ dir: scan.dir, defaultDir, themes: scan.themes, problems: scan.problems, error: null, sceneGroups });
      writeCache();
      writeScenesCache(sceneGroups);
    } catch (err) {
      set({ error: String(err).replace(/^Error:\s*/, '') });
      log('error', 'themes', 'Reading the theme library failed', err);
    } finally {
      set({ scanning: false });
    }
  },

  importFrom: async (source) => {
    const result = await api.themes.import(source, getSetting('appearance.themeLibrary'));
    await get().scan();
    return result;
  },

  importUrl: async (url) => {
    const result = await api.themes.importUrl(url, getSetting('appearance.themeLibrary'));
    await get().scan();
    return result;
  },
}));

function registrationOf(t: { id: string; label: string; description: string; author: string | null }): ThemeRegistration {
  return {
    id: t.id,
    label: t.label,
    description: t.description,
    source: 'library',
    ...(t.author ? { author: t.author } : {}),
  };
}

/** Makes the registry and the injected styles match `themes` exactly. */
function apply(themes: readonly LibraryTheme[]): void {
  const wanted = new Map(themes.map((t) => [t.id, t]));
  const registry = useThemeRegistry.getState();

  for (const el of document.querySelectorAll<HTMLStyleElement>(`style[${STYLE_ATTR}]`)) {
    const id = el.getAttribute(STYLE_ATTR) ?? '';
    if (!wanted.has(id)) el.remove();
  }
  for (const t of registry.themes) {
    if (t.source === 'library' && !wanted.has(t.id)) registry.unregister(t.id);
  }
  for (const t of themes) {
    inject(t.id, t.css);
    try {
      registry.register(registrationOf(t));
    } catch (err) {
      log('warn', 'themes', `Skipping theme "${t.id}"`, err);
    }
  }
}

function inject(id: string, css: string): void {
  let el = document.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}="${id}"]`);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute(STYLE_ATTR, id);
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

interface CachedTheme {
  theme: Pick<LibraryTheme, 'id' | 'label' | 'description' | 'author' | 'css'>;
}

/** Keeps the chosen library theme in the boot cache; clears it for a built-in. */
function writeCache(): void {
  const userId = lastCacheUser();
  if (!userId) return;
  const chosen = useThemeLibrary.getState().themes.find((t) => t.id === useThemeStore.getState().activeTheme);
  try {
    if (!chosen) { localStorage.removeItem(cacheKey(userId)); return; }
    const entry: CachedTheme = {
      theme: { id: chosen.id, label: chosen.label, description: chosen.description, author: chosen.author, css: chosen.css },
    };
    localStorage.setItem(cacheKey(userId), JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the lock screen paints the default theme instead.
  }
}

function writeScenesCache(groups: readonly ThemeScenes[]): void {
  const userId = lastCacheUser();
  if (!userId) return;
  try {
    localStorage.setItem(scenesKey(userId), JSON.stringify(groups));
  } catch {
    // Storage full or blocked: the lock screen shows built-in scenes until unlock.
  }
}

function readScenesCache(userId: string): ThemeScenes[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(scenesKey(userId)) ?? '[]');
    return Array.isArray(data) ? (data as ThemeScenes[]).filter((g) => Array.isArray(g?.scenes)) : [];
  } catch {
    return [];
  }
}

/** At startup, before unlock: bring back the last chosen library theme and every theme's scenes. */
export function restoreCachedLibraryTheme(): void {
  const userId = lastCacheUser();
  if (!userId) return;
  useThemeLibrary.setState({ sceneGroups: readScenesCache(userId) });
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return;
    const { theme } = JSON.parse(raw) as CachedTheme;
    inject(theme.id, theme.css);
    useThemeRegistry.getState().register(registrationOf(theme));
  } catch {
    // Unreadable cache: the real scan after unlock replaces it.
  }
}

// Read the library once settings load (unlock), and again when its folder changes.
useSettings.subscribe((s, prev) => {
  const dirChanged = s.values['appearance.themeLibrary'] !== prev.values['appearance.themeLibrary'];
  if (s.loaded && (!prev.loaded || dirChanged)) void useThemeLibrary.getState().scan();
});

// Picking a theme updates the boot cache.
useThemeStore.subscribe((s, prev) => {
  if (s.activeTheme !== prev.activeTheme) writeCache();
});
