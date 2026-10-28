import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { BUILTIN_THEMES } from '@shared/theming/builtinThemes';
import type { LibraryTheme, ThemeImportResult, ThemeLibraryScan } from '@shared/types';
import { sanitizeThemeCss } from '../themes/sanitizeThemeCss';
import { downloadArchive, parseRepoUrl, type FetchLike } from '../themes/repoSource';
import { loadScenes } from '../themes/loadScenes';
import { resolveConfigDir } from './SettingsFileService';

// Theme files on disk. Themes are per-device preferences, like settings files,
// so nothing here touches the database or the operation log.
//
// A theme is either a folder holding theme.css (plus an optional theme.json and
// any fonts, images or lock-screen scenes it uses), or a single loose .css file.

const MAX_CSS_BYTES   = 1024 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES   = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
/** How deep an import looks for themes inside the chosen folder or zip. */
const IMPORT_DEPTH = 3;

const ASSET_TYPES: Record<string, string> = {
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

const BUILTIN_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));

interface Candidate {
  /** theme.css, or the loose .css file. */
  cssPath: string;
  /** The theme's folder; null for a loose .css file. */
  folder: string | null;
}

interface Manifest { name?: string; description?: string; author?: string; source?: string; scenes?: unknown }

export class ThemeLibraryService {
  /** @param fetcher injectable for tests; the sidecar uses the global fetch. */
  constructor(private readonly fetcher: FetchLike = (url, init) => fetch(url, init)) {}

  defaultDir(): string {
    return join(resolveConfigDir(), 'themes');
  }

  /** Reads every theme in `dir` (the default library when empty). */
  scan(dir: string): ThemeLibraryScan {
    const root = dir.trim() ? resolve(dir) : this.defaultDir();
    if (!dir.trim()) mkdirSync(root, { recursive: true });
    if (!isDir(root)) {
      return { dir: root, themes: [], problems: [{ path: root, message: 'The theme folder does not exist' }] };
    }

    const themes: LibraryTheme[] = [];
    const problems: ThemeLibraryScan['problems'] = [];
    const seen = new Map<string, string>();

    for (const c of findCandidates(root, 1)) {
      const loaded = loadTheme(c);
      if ('error' in loaded) { problems.push({ path: c.cssPath, message: loaded.error }); continue; }
      const other = seen.get(loaded.id);
      if (other) {
        problems.push({ path: c.cssPath, message: `Theme id "${loaded.id}" is already used by ${other}` });
        continue;
      }
      seen.set(loaded.id, c.cssPath);
      themes.push(loaded);
    }
    themes.sort((a, b) => a.label.localeCompare(b.label));
    return { dir: root, themes, problems };
  }

  /** Copies the themes found in a folder, .zip or .css file into the library. */
  importFrom(source: string, dir: string): ThemeImportResult {
    const library = this.libraryDir(dir);
    const src = resolve(source);
    if (!existsSync(src)) throw new Error(`Nothing found at ${src}`);

    if (isDir(src)) return this.importTree(src, library, null);
    const ext = extname(src).toLowerCase();
    if (ext === '.css') return this.copyCandidates([{ cssPath: src, folder: null }], library, null);
    if (ext !== '.zip') throw new Error('Choose a folder, a .zip or a .css file');
    if (statSync(src).size > MAX_ZIP_BYTES) throw new Error('The zip is too large');
    return this.withZip(new Uint8Array(readFileSync(src)), (root) => this.importTree(root, library, null));
  }

  /** Downloads a repo (or .zip link) and imports the themes in it, remembering the link. */
  async importFromUrl(link: string, dir: string): Promise<ThemeImportResult> {
    const library = this.libraryDir(dir);
    const { archiveUrl, subPath } = parseRepoUrl(link);
    const url = typeof archiveUrl === 'string' ? archiveUrl : await archiveUrl(this.fetcher);
    const zip = await downloadArchive(url, this.fetcher, MAX_ZIP_BYTES);

    return this.withZip(zip, (root) => {
      // Host archives wrap the repo in one top folder (repo-branch/).
      const entries = readdirSync(root).filter((n) => !n.startsWith('.') && n !== '__MACOSX');
      const top = entries.length === 1 && isDir(join(root, entries[0]!)) ? join(root, entries[0]!) : root;
      const searchRoot = subPath ? resolve(top, subPath) : top;
      if ((searchRoot !== top && !searchRoot.startsWith(top + sep)) || !isDir(searchRoot)) throw new Error(`No folder "${subPath}" in the repo`);
      return this.importTree(searchRoot, library, link.trim());
    });
  }

  private libraryDir(dir: string): string {
    const library = dir.trim() ? resolve(dir) : this.defaultDir();
    mkdirSync(library, { recursive: true });
    return library;
  }

  private importTree(root: string, library: string, sourceUrl: string | null): ThemeImportResult {
    const candidates = existsSync(join(root, 'theme.css'))
      ? [{ cssPath: join(root, 'theme.css'), folder: root }]
      : findCandidates(root, IMPORT_DEPTH);
    if (candidates.length === 0) throw new Error('No themes found: a theme is a theme.css file or a folder holding one');
    const result = this.copyCandidates(candidates, library, sourceUrl);
    // Paths inside a temp extraction mean nothing to the user; show them from the pack's root.
    for (const p of result.problems) p.path = relative(root, p.path) || basename(p.path);
    return result;
  }

  /** Unpacks into a temp folder for `use`, then removes only that temp folder. */
  private withZip<T>(zip: Uint8Array, use: (root: string) => T): T {
    const tempDir = mkdtempSync(join(tmpdir(), 'cord-theme-import-'));
    try {
      extractZip(zip, tempDir);
      return use(tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private copyCandidates(candidates: Candidate[], library: string, sourceUrl: string | null): ThemeImportResult {
    const result: ThemeImportResult = { imported: [], problems: [] };
    for (const c of candidates) {
      const loaded = loadTheme(c);
      if ('error' in loaded) { result.problems.push({ path: displayPath(c), message: loaded.error }); continue; }

      const target = join(library, loaded.id);
      if (resolve(target) === resolve(c.folder ?? '')) {
        result.problems.push({ path: displayPath(c), message: 'Already in the library' });
        continue;
      }
      // Re-importing a theme updates it in place; files are added or replaced, never deleted.
      mkdirSync(target, { recursive: true });
      if (c.folder) {
        cpSync(c.folder, target, { recursive: true, force: true });
      } else {
        writeFileSync(join(target, 'theme.css'), readFileSync(c.cssPath));
        if (!existsSync(join(target, 'theme.json'))) {
          writeFileSync(join(target, 'theme.json'), `${JSON.stringify({ name: loaded.label }, null, 2)}\n`);
        }
      }
      if (sourceUrl) {
        // Remembered so the gallery can offer to update the theme from where it came.
        const manifestPath = join(target, 'theme.json');
        const manifest = { ...readManifest(manifestPath), source: sourceUrl };
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      }
      result.imported.push({ id: loaded.id, label: loaded.label });
    }
    return result;
  }
}

// ── Reading themes ─────────────────────────────────────────────────────────

function findCandidates(dir: string, depth: number): Candidate[] {
  const found: Candidate[] = [];
  let entries: string[];
  try { entries = readdirSync(dir).sort(); } catch { return found; }

  for (const name of entries) {
    if (name.startsWith('.') || name === '__MACOSX') continue;
    const path = join(dir, name);
    if (isDir(path)) {
      if (existsSync(join(path, 'theme.css'))) found.push({ cssPath: join(path, 'theme.css'), folder: path });
      else if (depth > 1) found.push(...findCandidates(path, depth - 1));
    } else if (extname(name).toLowerCase() === '.css') {
      found.push({ cssPath: path, folder: null });
    }
  }
  return found;
}

function loadTheme(c: Candidate): LibraryTheme | { error: string } {
  let size: number;
  try { size = statSync(c.cssPath).size; } catch { return { error: 'Could not read the file' }; }
  if (size > MAX_CSS_BYTES) return { error: `Larger than ${MAX_CSS_BYTES / 1024} KB` };

  const baseDir = c.folder ?? dirname(c.cssPath);
  const { id, css, dropped } = sanitizeThemeCss(readFileSync(c.cssPath, 'utf8'), {
    resolveAsset: (ref) => inlineAsset(baseDir, ref),
  });
  if (!id) return { error: dropped[0] ?? 'No theme id' };
  if (BUILTIN_IDS.has(id)) return { error: `"${id}" is the id of a built-in theme` };

  const manifest = c.folder ? readManifest(join(c.folder, 'theme.json')) : {};
  const { scenes, problems } = c.folder ? loadScenes(id, c.folder, manifest.scenes) : { scenes: [], problems: [] };
  const fallbackName = c.folder ? basename(c.folder) : basename(c.cssPath, extname(c.cssPath));
  return {
    id,
    label: clip(manifest.name, 60) ?? titleCase(fallbackName),
    description: clip(manifest.description, 140) ?? '',
    author: clip(manifest.author, 60) ?? null,
    source: typeof manifest.source === 'string' && manifest.source.startsWith('https://') ? manifest.source : null,
    path: c.folder ?? c.cssPath,
    css,
    dropped: [...dropped, ...problems],
    scenes,
  };
}

function readManifest(path: string): Manifest {
  if (!existsSync(path)) return {};
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof data === 'object' && data !== null ? (data as Manifest) : {};
  } catch {
    return {};
  }
}

/** A file beside the theme as a data: URI; null if it escapes the folder, is missing, or isn't a font/image. */
function inlineAsset(baseDir: string, ref: string): string | null {
  const clean = decodeURIComponent(ref.split(/[?#]/)[0] ?? '');
  const path = resolve(baseDir, clean);
  const rel = relative(baseDir, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  const type = ASSET_TYPES[extname(path).toLowerCase()];
  if (!type || !existsSync(path)) return null;
  const { size } = statSync(path);
  if (size > MAX_ASSET_BYTES) return null;
  return `data:${type};base64,${readFileSync(path).toString('base64')}`;
}

function extractZip(zip: Uint8Array, into: string): void {
  const files = unzipSync(zip);
  const names = Object.keys(files);
  if (names.length > MAX_ZIP_ENTRIES) throw new Error('The zip has too many files');

  let total = 0;
  for (const name of names) {
    if (name.endsWith('/')) continue;
    const data = files[name]!;
    total += data.length;
    if (total > MAX_ZIP_BYTES) throw new Error('The zip unpacks to more than 50 MB');
    // Zip-slip: an entry may never land outside the extraction folder.
    const target = resolve(into, name);
    if (!target.startsWith(resolve(into) + sep)) throw new Error(`Unsafe path in zip: ${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

function isDir(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, max);
}

function titleCase(name: string): string {
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayPath(c: Candidate): string {
  return c.folder ?? c.cssPath;
}
