import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { dirname, isAbsolute, join } from 'path';
import { tmpdir } from 'os';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { schema } from './schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database | null = null;

/**
 * Where the database lives. The single source of truth for the path.
 *
 * The Tauri layer opens this same file directly for search, and learns the
 * path from the `SIDECAR_DB=` line this process prints rather than
 * recomputing it — so this function must stay the only place the default is
 * expressed.
 */
export function resolveDbPath(): string {
  return process.env['CORD_DB_PATH'] ?? join(resolveDataDir(), 'cord.db');
}

type Env = Record<string, string | undefined>;

function homeOf(env: Env): string {
  return env['HOME'] ?? env['USERPROFILE'] ?? '.';
}

/**
 * Cord's data directory: the database, the attachments beside it, and each
 * user's config under `users/`.
 *
 * Linux follows the XDG base directory specification. A package installed by
 * apt, dnf or pacman is held to it, and a dotdir in `$HOME` is the kind of
 * thing users of three different distros would each have to be told about.
 * Windows and macOS keep `~/.cord`: nothing about either platform is improved
 * by moving it, and moving it costs every existing install a migration for no
 * reason.
 *
 * Takes the platform and environment rather than reading them, so the rule can
 * be asserted for every platform from any one of them.
 */
export function dataDirFor(platform: string, env: Env): string {
  if (platform !== 'linux') return join(homeOf(env), '.cord');

  // The spec says a relative XDG_DATA_HOME must be ignored, which also covers
  // the empty string a shell leaves behind when the variable is set but unset.
  const xdg = env['XDG_DATA_HOME'];
  if (xdg && isAbsolute(xdg)) return join(xdg, 'cord');

  return join(homeOf(env), '.local', 'share', 'cord');
}

export function resolveDataDir(): string {
  return dataDirFor(process.platform, process.env);
}

/** Where Cord kept everything before the XDG move. Still current off Linux. */
export function legacyDataDir(env: Env): string {
  return join(homeOf(env), '.cord');
}

/** The two filesystem calls the migration makes, injectable so both of their failure paths can be tested. */
export interface MigrationIo {
  rename: (from: string, to: string) => void;
  copy: (from: string, to: string) => void;
}

const REAL_IO: MigrationIo = {
  rename: renameSync,
  copy: (from, to) => cpSync(from, to, { recursive: true }),
};

/**
 * Move a pre-XDG `~/.cord` to where Cord now looks, once.
 *
 * A failure here is deliberately fatal to the sidecar. The alternative is
 * opening an empty database at the new path while the notes sit untouched at
 * the old one, which to the person using Cord is indistinguishable from having
 * lost everything. A startup error they can report is the better failure.
 */
export function migrateLegacyDataDir(
  legacy: string,
  target: string,
  io: MigrationIo = REAL_IO,
): void {
  if (legacy === target) return;
  if (!existsSync(legacy)) return;
  // Both present means an older and a newer Cord have both run, or a backup was
  // restored. Merging would have to pick a winner for every file; refusing does
  // not, and leaves the person able to look at both.
  if (existsSync(target)) return;

  mkdirSync(dirname(target), { recursive: true });

  try {
    io.rename(legacy, target);
    return;
  } catch {
    // $HOME and $XDG_DATA_HOME need not share a filesystem, and rename cannot
    // cross one. Fall through to copying.
  }

  // Staged beside the target and moved into place, because a copy that fails
  // half-way would otherwise leave a partial directory that the next boot reads
  // as a finished migration.
  const staging = `${target}.migrating`;
  rmSync(staging, { recursive: true, force: true });
  try {
    io.copy(legacy, staging);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  io.rename(staging, target);

  // The originals stay where they are. Nothing in Cord hard-deletes a user's
  // notes, and least of all a migration running before anyone has seen a window.
}

/**
 * Where attachment files live: an `attachments` folder beside the database.
 * The Tauri layer derives the same folder from the reported database path.
 */
export function resolveAttachmentsDir(): string {
  const override = process.env['CORD_ATTACHMENTS_DIR'];
  if (override) return override;
  const dbPath = resolveDbPath();
  return join(dbPath === ':memory:' ? tmpdir() : dirname(dbPath), 'attachments');
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  // Before anything opens the file. CORD_DB_PATH means a test or an explicit
  // choice of location, and neither wants a directory moved underneath it.
  if (!process.env['CORD_DB_PATH']) {
    migrateLegacyDataDir(legacyDataDir(process.env), resolveDataDir());
  }

  const dbPath = resolveDbPath();

  if (dbPath !== ':memory:') {
    mkdirSync(join(dbPath, '..'), { recursive: true });
  }

  const sqlite = new Database(dbPath, { create: true });
  sqlite.run('PRAGMA journal_mode = WAL');
  sqlite.run('PRAGMA foreign_keys = ON');
  sqlite.run('PRAGMA synchronous = NORMAL');

  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

export function getRawSqlite(): Database {
  // Gives access to the underlying bun:sqlite connection for migrations
  // and raw pragma calls. Not for use in domain services.
  //
  // This MUST return the same connection getDb() uses. Opening a second
  // Database here would point at an entirely separate database under
  // CORD_DB_PATH=:memory:, so migrations would land in a throwaway handle.
  getDb(); // ensure the connection is initialised
  if (!_sqlite) throw new Error('sqlite connection not initialised');
  return _sqlite;
}

// Test helper: drop the cached connection so the next getDb() opens a fresh
// database. Lets each test start from a clean schema under :memory:.
export function resetDb(): void {
  _sqlite?.close();
  _sqlite = null;
  _db = null;
}
