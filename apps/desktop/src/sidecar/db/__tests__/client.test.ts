import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'path';
import { resolveDbPath } from '../client';

// resolveDbPath is the single source of truth for where cord.db lives. Rust
// reads the path from the sidecar rather than recomputing it, so if this
// function and the Rust side ever disagree, search silently reads a different
// database than the one being written.

const ORIGINAL = process.env['CORD_DB_PATH'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['CORD_DB_PATH'];
  else process.env['CORD_DB_PATH'] = ORIGINAL;
});

describe('resolveDbPath', () => {
  it('honours CORD_DB_PATH when set', () => {
    process.env['CORD_DB_PATH'] = '/tmp/cord-test.db';
    expect(resolveDbPath()).toBe('/tmp/cord-test.db');
  });

  it('passes :memory: through unchanged', () => {
    process.env['CORD_DB_PATH'] = ':memory:';
    expect(resolveDbPath()).toBe(':memory:');
  });

  it('defaults to .cord/cord.db under the home directory', () => {
    delete process.env['CORD_DB_PATH'];
    expect(resolveDbPath().endsWith(join('.cord', 'cord.db'))).toBe(true);
  });
});
