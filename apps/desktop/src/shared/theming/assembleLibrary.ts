import { BUILTIN_THEMES } from './builtinThemes';
import { loadScenes } from './loadScenes';
import { sanitizeThemeCss } from './sanitizeThemeCss';
import type { LibraryTheme, RawTheme, RawThemeScan, ThemeLibraryScan } from '@shared/types';

// Turns the files cord-core read off disk into the library the app shows: the
// same result ThemeLibraryService.scan built from the disk directly.

const BUILTIN_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));

interface Manifest { name?: unknown; description?: unknown; author?: unknown; source?: unknown; scenes?: unknown }

export function assembleLibrary(raw: RawThemeScan): ThemeLibraryScan {
  const themes: LibraryTheme[] = [];
  const problems = [...raw.problems];
  const seen = new Map<string, string>();
  for (const t of raw.themes) {
    const loaded = assembleTheme(t);
    if ('error' in loaded) { problems.push({ path: t.cssPath, message: loaded.error }); continue; }
    const other = seen.get(loaded.id);
    if (other) {
      problems.push({ path: t.cssPath, message: `Theme id "${loaded.id}" is already used by ${other}` });
      continue;
    }
    seen.set(loaded.id, t.cssPath);
    themes.push(loaded);
  }
  themes.sort((a, b) => a.label.localeCompare(b.label));
  return { dir: raw.dir, themes, problems };
}

export function assembleTheme(t: RawTheme): LibraryTheme | { error: string } {
  const { id, css, dropped } = sanitizeThemeCss(t.css, { resolveAsset: (ref) => t.assets[ref] ?? null });
  if (!id) return { error: dropped[0] ?? 'No theme id' };
  if (BUILTIN_IDS.has(id)) return { error: `"${id}" is the id of a built-in theme` };

  const manifest = t.manifest as Manifest;
  const { scenes, problems } = t.folder ? loadScenes(id, manifest.scenes, t.sceneFiles) : { scenes: [], problems: [] };
  const fallbackName = t.folder ? lastSegment(t.folder) : lastSegment(t.cssPath).replace(/\.[^.]*$/, '');
  return {
    id,
    label: clip(manifest.name, 60) ?? titleCase(fallbackName),
    description: clip(manifest.description, 140) ?? '',
    author: clip(manifest.author, 60) ?? null,
    source: typeof manifest.source === 'string' && manifest.source.startsWith('https://') ? manifest.source : null,
    path: t.folder ?? t.cssPath,
    css,
    dropped: [...dropped, ...problems],
    scenes,
  };
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, max);
}

function titleCase(name: string): string {
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
