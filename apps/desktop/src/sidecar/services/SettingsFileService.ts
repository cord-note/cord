import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDbPath } from '../db/client';

/**
 * Stores each user's settings files as opaque text in
 * `<config dir>/users/<userId>/` (config dir = the directory holding the
 * database — see resolveDataDir, which is XDG-compliant on Linux). The
 * renderer owns the schema and does all parsing, so a hand-edited file —
 * comments and all — round-trips exactly.
 */

export const CONFIG_FILES = ['settings', 'keybindings'] as const;
export type ConfigFileName = (typeof CONFIG_FILES)[number];

/** Anything larger is not a settings file someone meant to write. */
export const MAX_CONFIG_BYTES = 1024 * 1024;

/** nanoid's alphabet. Anything else could climb out of the users folder. */
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function resolveConfigDir(): string {
  return process.env['CORD_CONFIG_DIR'] ?? dirname(resolveDbPath());
}

export function userConfigDir(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error('Invalid user id');
  return join(resolveConfigDir(), 'users', userId);
}

export class SettingsFileService {
  /** @param currentUserId the signed-in user's id; throws when nobody is signed in. */
  constructor(private readonly currentUserId: () => string) {}

  read(name: string): string | null {
    const path = this.pathFor(name);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }

  write(name: string, text: string): void {
    const path = this.pathFor(name);
    if (typeof text !== 'string') throw new Error('Settings text must be a string');
    if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) {
      throw new Error(`Settings file exceeds ${MAX_CONFIG_BYTES} bytes`);
    }
    mkdirSync(dirname(path), { recursive: true });
    // Write beside the target and rename over it, so a crash mid-write never
    // leaves a truncated settings file.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, path);
  }

  /** A new user's folder, created empty so they start from the defaults. */
  createUserDir(userId: string): void {
    mkdirSync(userConfigDir(userId), { recursive: true });
  }

  private pathFor(name: string): string {
    if (!(CONFIG_FILES as readonly string[]).includes(name)) {
      throw new Error(`Unknown settings file "${name}"`);
    }
    const userId = this.currentUserId();
    this.seedUserDir(userId);
    return join(userConfigDir(userId), `${name}.json`);
  }

  /**
   * Users who existed before settings were per user have no folder yet. They
   * get a copy of the shared files so nobody loses their setup. The shared
   * files stay where they are and are never read again.
   */
  private seedUserDir(userId: string): void {
    const dir = userConfigDir(userId);
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
    for (const name of CONFIG_FILES) {
      const shared = join(resolveConfigDir(), `${name}.json`);
      if (existsSync(shared)) copyFileSync(shared, join(dir, `${name}.json`));
    }
  }
}
