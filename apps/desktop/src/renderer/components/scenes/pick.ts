import type { LoginScene } from '@shared/types';

// Which scene the lock screen shows, and which scenes have misbehaved.

const LAST_KEY = 'cord-login-scene-last';
const BLOCKED_KEY = 'cord-login-scenes-blocked';

/** Changes when a theme edits its scene, so a fixed scene gets another chance. */
export function sceneKey(scene: LoginScene): string {
  let h = 0;
  for (let i = 0; i < scene.source.length; i++) h = (Math.imul(h, 31) + scene.source.charCodeAt(i)) | 0;
  return `${scene.id}:${(h >>> 0).toString(36)}`;
}

/** Theme scenes that were too slow or crashed the GPU, kept across restarts. */
export function loadBlocked(): Set<string> {
  try {
    const raw = localStorage.getItem(BLOCKED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveBlocked(blocked: ReadonlySet<string>): void {
  try {
    localStorage.setItem(BLOCKED_KEY, JSON.stringify([...blocked]));
  } catch {
    // Storage blocked: the scene is skipped for this session only.
  }
}

/** A random scene, avoiding the one shown last time when there is a choice. */
export function pickScene(scenes: readonly LoginScene[], random: () => number = Math.random): LoginScene | null {
  if (scenes.length === 0) return null;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_KEY); } catch { /* no storage: any scene will do */ }
  const pool = scenes.length > 1 ? scenes.filter((s) => s.id !== last) : scenes;
  const chosen = pool[Math.floor(random() * pool.length)] ?? scenes[0]!;
  try { localStorage.setItem(LAST_KEY, chosen.id); } catch { /* as above */ }
  return chosen;
}
