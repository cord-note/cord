import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { schema } from './schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database | null = null;

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  const dbPath = process.env['CORD_DB_PATH'] ?? join(
    process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.',
    '.cord',
    'cord.db',
  );

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
