import type { LoginScene, RawSceneFile } from '@shared/types';

// Lock-screen scenes a theme ships beside its theme.css, listed in theme.json:
//
//   "scenes": [{ "file": "scenes/lighthouse.glsl", "name": "Lighthouse", "marks": "square", "fps": 2, "cell": 4 }]
//
// A scene is GLSL that only computes a brightness per cell; the app owns the
// canvas, the uniforms and the marks. It runs on the GPU with no access to
// files, the network or the page, so the checks here keep it to that shape:
// no preprocessor, no uniforms or entry point of its own, plain ASCII, small.
// What it costs to draw is checked by the renderer, which drops a slow scene.
//
// The files themselves are read off disk elsewhere (cord-core, or the
// sidecar's sceneFiles.ts) and handed in by the path theme.json gives.

export const MAX_SCENES = 4;
export const MAX_SCENE_BYTES = 16 * 1024;

interface SceneEntry { file?: unknown; name?: unknown; marks?: unknown; fps?: unknown; cell?: unknown }

/** Reads the scenes a theme lists from files already read off disk; anything unusable is reported, not thrown. */
export function loadScenes(
  themeId: string,
  entries: unknown,
  files: Record<string, RawSceneFile>,
): { scenes: LoginScene[]; problems: string[] } {
  const scenes: LoginScene[] = [];
  const problems: string[] = [];
  if (entries === undefined) return { scenes, problems };
  if (!Array.isArray(entries)) return { scenes, problems: ['"scenes" in theme.json must be a list'] };
  if (entries.length > MAX_SCENES) problems.push(`Only the first ${MAX_SCENES} scenes are used`);

  for (const raw of entries.slice(0, MAX_SCENES) as SceneEntry[]) {
    const file = typeof raw?.file === 'string' ? raw.file : '';
    const label = file || '(no file)';
    const loaded = readScene(files, file);
    if ('error' in loaded) { problems.push(`Scene ${label}: ${loaded.error}`); continue; }

    const name = file.split(/[\\/]/).pop() ?? file;
    const slug = name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const id = `${themeId}/${slug}`;
    if (scenes.some((s) => s.id === id)) { problems.push(`Scene ${label}: another scene has the same file name`); continue; }
    scenes.push({
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : slug,
      source: loaded.source,
      marks: raw.marks === 'glyph' ? 'glyph' : 'square',
      fps: clampInt(raw.fps, 1, 8, 2),
      cell: clampInt(raw.cell, 3, 12, 4),
    });
  }
  return { scenes, problems };
}

function readScene(files: Record<string, RawSceneFile>, file: string): { source: string } | { error: string } {
  if (!file) return { error: 'no "file" given' };
  const read = files[file];
  if (!read) return { error: 'file not found' };
  if (read.error !== undefined) return { error: read.error };
  const source = read.source ?? '';
  const problem = checkSource(source);
  return problem ? { error: problem } : { source };
}

/** Why a scene's source is refused, or null when it has the expected shape. */
export function checkSource(source: string): string | null {
  if (/[^\t\n\r\x20-\x7e]/.test(source)) return 'only plain ASCII text is allowed';
  if (source.includes('#')) return 'preprocessor lines (#…) are not allowed';
  if (/\b(uniform|attribute|varying)\b/.test(source)) return 'scenes cannot declare uniforms; use the ones provided';
  if (/\bmain\s*\(/.test(source)) return 'scenes cannot define main(); define scene() instead';
  if (/\bgl_Frag(Color|Data|Coord)\b/.test(source)) return 'scenes return a brightness from scene(); they cannot write pixels';
  if (!/\bfloat\s+scene\s*\(\s*vec2\s+\w+\s*,\s*vec2\s+\w+\s*\)/.test(source)) return 'missing float scene(vec2 p, vec2 span)';
  return null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
