import { describe, it, expect, afterEach } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';
import {
  dataDirFor,
  legacyDataDir,
  migrateLegacyDataDir,
  resolveDbPath,
  type MigrationIo,
} from '../client';

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

  it('puts cord.db in the data directory', () => {
    delete process.env['CORD_DB_PATH'];
    expect(resolveDbPath()).toBe(join(dataDirFor(process.platform, process.env), 'cord.db'));
  });
});

// Linux follows the XDG base directory spec because a package installed by apt,
// dnf or pacman is held to it. Windows and macOS keep ~/.cord: neither is
// improved by moving, and moving costs every existing install a migration.
describe('dataDirFor', () => {
  it('uses XDG_DATA_HOME on Linux', () => {
    expect(dataDirFor('linux', { HOME: '/home/a', XDG_DATA_HOME: '/mnt/data' }))
      .toBe(join('/mnt/data', 'cord'));
  });

  it('falls back to ~/.local/share on Linux', () => {
    expect(dataDirFor('linux', { HOME: '/home/a' }))
      .toBe(join('/home/a', '.local', 'share', 'cord'));
  });

  // The spec says a relative or empty XDG_DATA_HOME must be ignored. Honouring
  // one would put the database wherever the sidecar happened to be started.
  it('ignores an XDG_DATA_HOME that is not absolute', () => {
    const expected = join('/home/a', '.local', 'share', 'cord');
    expect(dataDirFor('linux', { HOME: '/home/a', XDG_DATA_HOME: '' })).toBe(expected);
    expect(dataDirFor('linux', { HOME: '/home/a', XDG_DATA_HOME: 'data' })).toBe(expected);
  });

  it('keeps ~/.cord on macOS and Windows', () => {
    expect(dataDirFor('darwin', { HOME: '/Users/a', XDG_DATA_HOME: '/mnt/data' }))
      .toBe(join('/Users/a', '.cord'));
    expect(dataDirFor('win32', { USERPROFILE: 'C:\\Users\\a' }))
      .toBe(join('C:\\Users\\a', '.cord'));
  });

  it('is the legacy directory on macOS and Windows, and is not on Linux', () => {
    const mac = { HOME: '/Users/a' };
    expect(dataDirFor('darwin', mac)).toBe(legacyDataDir(mac));

    const linux = { HOME: '/home/a' };
    expect(dataDirFor('linux', linux)).not.toBe(legacyDataDir(linux));
    expect(legacyDataDir(linux)).toBe(join('/home/a', '.cord'));
  });
});

describe('migrateLegacyDataDir', () => {
  const made: string[] = [];

  function sandbox(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cord-migrate-'));
    made.push(dir);
    return dir;
  }

  /** A legacy ~/.cord with a database, an attachment and a user's settings. */
  function legacyWith(root: string): string {
    const legacy = join(root, '.cord');
    mkdirSync(join(legacy, 'attachments'), { recursive: true });
    mkdirSync(join(legacy, 'users', 'u1'), { recursive: true });
    writeFileSync(join(legacy, 'cord.db'), 'notes');
    writeFileSync(join(legacy, 'attachments', 'a1.png'), 'image');
    writeFileSync(join(legacy, 'users', 'u1', 'settings.json'), '{"a":1}');
    return legacy;
  }

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('moves the whole directory, contents intact', () => {
    const root = sandbox();
    const legacy = legacyWith(root);
    const target = join(root, '.local', 'share', 'cord');

    migrateLegacyDataDir(legacy, target);

    expect(readFileSync(join(target, 'cord.db'), 'utf8')).toBe('notes');
    expect(readFileSync(join(target, 'attachments', 'a1.png'), 'utf8')).toBe('image');
    expect(readFileSync(join(target, 'users', 'u1', 'settings.json'), 'utf8')).toBe('{"a":1}');
    expect(existsSync(legacy)).toBe(false);
  });

  it('does nothing when there is no legacy directory', () => {
    const root = sandbox();
    const target = join(root, '.local', 'share', 'cord');

    migrateLegacyDataDir(join(root, '.cord'), target);

    expect(existsSync(target)).toBe(false);
  });

  // Both existing means someone has run a newer and an older Cord, or restored
  // a backup. Merging would have to pick a winner per file; refusing does not.
  it('leaves both alone when the target already exists', () => {
    const root = sandbox();
    const legacy = legacyWith(root);
    const target = join(root, '.local', 'share', 'cord');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'cord.db'), 'newer');

    migrateLegacyDataDir(legacy, target);

    expect(readFileSync(join(target, 'cord.db'), 'utf8')).toBe('newer');
    expect(readFileSync(join(legacy, 'cord.db'), 'utf8')).toBe('notes');
  });

  it('is a no-op where the two paths are the same', () => {
    const root = sandbox();
    const legacy = legacyWith(root);

    migrateLegacyDataDir(legacy, legacy);

    expect(readFileSync(join(legacy, 'cord.db'), 'utf8')).toBe('notes');
  });

  it('is safe to run twice', () => {
    const root = sandbox();
    const legacy = legacyWith(root);
    const target = join(root, '.local', 'share', 'cord');

    migrateLegacyDataDir(legacy, target);
    migrateLegacyDataDir(legacy, target);

    expect(readFileSync(join(target, 'cord.db'), 'utf8')).toBe('notes');
  });

  /** A filesystem where $HOME and the target are on different devices. */
  function crossDevice(legacy: string): MigrationIo {
    return {
      rename: (from, to) => {
        if (from === legacy) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
        renameSync(from, to);
      },
      copy: (from, to) => cpSync(from, to, { recursive: true }),
    };
  }

  it('copies rather than renames when the two live on different filesystems', () => {
    const root = sandbox();
    const legacy = legacyWith(root);
    const target = join(root, '.local', 'share', 'cord');

    migrateLegacyDataDir(legacy, target, crossDevice(legacy));

    expect(readFileSync(join(target, 'cord.db'), 'utf8')).toBe('notes');
    expect(readFileSync(join(target, 'users', 'u1', 'settings.json'), 'utf8')).toBe('{"a":1}');
    // The originals stay put: nothing in Cord hard-deletes a user's notes.
    expect(readFileSync(join(legacy, 'cord.db'), 'utf8')).toBe('notes');
    expect(existsSync(`${target}.migrating`)).toBe(false);
  });

  // A half-finished copy left at the target would look like a finished
  // migration on the next boot, and the notes that had not been copied yet
  // would be gone as far as the app could tell.
  it('leaves nothing at the target when the copy fails part-way', () => {
    const root = sandbox();
    const legacy = legacyWith(root);
    const target = join(root, '.local', 'share', 'cord');
    const io = crossDevice(legacy);

    const failing: MigrationIo = {
      rename: io.rename,
      copy: (from, to) => {
        // Half the work, then the disk fills up.
        mkdirSync(to, { recursive: true });
        writeFileSync(join(to, 'cord.db'), 'partial');
        throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      },
    };

    expect(() => migrateLegacyDataDir(legacy, target, failing)).toThrow('ENOSPC');

    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.migrating`)).toBe(false);
    expect(readFileSync(join(legacy, 'cord.db'), 'utf8')).toBe('notes');
  });
});
