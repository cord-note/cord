import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDbPath } from '../db/client';

/**
 * Stores the user's settings files as opaque text in the config directory
 * (`~/.cord`, beside the database). The renderer owns the schema and does all
 * parsing, so a hand-edited file — comments and all — round-trips exactly.
 */

export const CONFIG_FILES = ['settings', 'keybindings'] as const;
export type ConfigFileName = (typeof CONFIG_FILES)[number];

/** Anything larger is not a settings file someone meant to write. */
export const MAX_CONFIG_BYTES = 1024 * 1024;

export function resolveConfigDir(): string {
  return process.env['CORD_CONFIG_DIR'] ?? dirname(resolveDbPath());
}

export class SettingsFileService {
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

  private pathFor(name: string): string {
    if (!(CONFIG_FILES as readonly string[]).includes(name)) {
      throw new Error(`Unknown settings file "${name}"`);
    }
    return join(resolveConfigDir(), `${name}.json`);
  }
}
