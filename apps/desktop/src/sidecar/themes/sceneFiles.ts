import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { MAX_SCENES, MAX_SCENE_BYTES } from '@shared/theming/loadScenes';
import type { RawSceneFile } from '@shared/types';

/** The scene files theme.json lists, read off disk (cord-core's themes::read_scene_files does the same). */
export function readSceneFiles(folder: string, entries: unknown): Record<string, RawSceneFile> {
  const out: Record<string, RawSceneFile> = {};
  if (!Array.isArray(entries)) return out;
  for (const raw of entries.slice(0, MAX_SCENES) as { file?: unknown }[]) {
    const file = typeof raw?.file === 'string' ? raw.file : '';
    if (file) out[file] = readOne(folder, file);
  }
  return out;
}

function readOne(folder: string, file: string): RawSceneFile {
  if (extname(file).toLowerCase() !== '.glsl') return { error: 'must be a .glsl file' };
  const path = resolve(folder, file);
  const rel = relative(folder, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return { error: 'must be inside the theme folder' };
  if (!existsSync(path)) return { error: 'file not found' };
  if (statSync(path).size > MAX_SCENE_BYTES) return { error: `larger than ${MAX_SCENE_BYTES / 1024} KB` };
  return { source: readFileSync(path, 'utf8') };
}
