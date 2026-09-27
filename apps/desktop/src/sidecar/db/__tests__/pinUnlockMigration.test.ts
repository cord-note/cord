import { describe, it, expect, beforeEach } from 'bun:test';
import { getRawSqlite } from '../client';
import { runMigrations } from '../migrations';
import { freshDb } from '../../services/__tests__/helpers';

// PIN unlock adds three columns to users and a machine-local app_state table.
// Additive only, and safe to run on every boot.

const columns = (table: string): string[] =>
  (getRawSqlite().query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);

describe('PIN unlock migration', () => {
  beforeEach(() => freshDb());

  it('adds the PIN and recovery-key columns to users', () => {
    expect(columns('users')).toEqual(
      expect.arrayContaining(['pin_hash', 'failed_pin_attempts', 'recovery_key_hash']),
    );
  });

  it('creates app_state', () => {
    expect(columns('app_state')).toEqual(['key', 'value', 'updated_at']);
  });

  it('starts existing users at zero failed attempts', () => {
    getRawSqlite().run(`INSERT INTO users (id, username, password_hash, created_at) VALUES ('u', 'u', 'h', 1)`);
    const row = getRawSqlite().query(`SELECT failed_pin_attempts AS n, pin_hash AS pin FROM users`).get() as { n: number; pin: string | null };
    expect(row).toEqual({ n: 0, pin: null });
  });

  it('is a no-op when run again', () => {
    expect(() => runMigrations()).not.toThrow();
  });
});
