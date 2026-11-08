import type { LoginScene } from '@shared/types';

// What the `appearance.loginScene` setting means for the lock screen.

/** A random scene from every installed scene. */
export const RANDOM = 'random';
/** A random scene from the pool in `appearance.loginScenePool`. */
export const POOL = 'pool';

/** The pool setting is scene ids separated by commas. */
export function parsePool(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export function formatPool(ids: readonly string[]): string {
  return [...new Set(ids)].join(',');
}

/**
 * The scenes the lock screen picks from. A chosen scene that is no longer
 * installed, or a pool with none left, falls back to every scene, so the lock
 * screen never goes blank because a theme was removed.
 */
export function chooseScenes(all: readonly LoginScene[], mode: string, pool: string): readonly LoginScene[] {
  if (mode === RANDOM) return all;
  if (mode === POOL) {
    const wanted = new Set(parsePool(pool));
    const picked = all.filter((s) => wanted.has(s.id));
    return picked.length > 0 ? picked : all;
  }
  const one = all.find((s) => s.id === mode);
  return one ? [one] : all;
}
