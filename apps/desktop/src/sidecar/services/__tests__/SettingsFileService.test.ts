import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CONFIG_BYTES, SettingsFileService } from '../SettingsFileService';

// Settings files are stored as opaque text: the renderer owns parsing, so a
// hand-edited file — comments and all — must round-trip byte for byte. Each
// user has their own folder; the signed-in user decides which one is used.

describe('SettingsFileService', () => {
  let dir: string;
  let base: string;
  let service: SettingsFileService;
  const userDir = (id: string): string => join(base, 'users', id);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cord-config-'));
    base = join(dir, 'nested');
    process.env['CORD_CONFIG_DIR'] = base;
    service = new SettingsFileService(() => 'u1');
  });

  afterEach(() => {
    delete process.env['CORD_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a missing file as null', () => {
    expect(service.read('settings')).toBeNull();
  });

  it('writes text verbatim into the user folder and reads it back', () => {
    const text = '{\n  // bigger text\n  "editor.fontSize": 17,\n}\n';
    service.write('settings', text);
    expect(readFileSync(join(userDir('u1'), 'settings.json'), 'utf8')).toBe(text);
    expect(service.read('settings')).toBe(text);
  });

  it('replaces an existing file and leaves no temp file behind', () => {
    service.write('keybindings', '{"a":1}');
    service.write('keybindings', '{"a":2}');
    expect(service.read('keybindings')).toBe('{"a":2}');
    expect(readdirSync(userDir('u1'))).toEqual(['keybindings.json']);
  });

  it('keeps each user’s files apart', () => {
    service.write('settings', '{"who":"u1"}');
    const other = new SettingsFileService(() => 'u2');
    expect(other.read('settings')).toBeNull();
    other.write('settings', '{"who":"u2"}');
    expect(service.read('settings')).toBe('{"who":"u1"}');
  });

  it('refuses when nobody is signed in', () => {
    const signedOut = new SettingsFileService(() => { throw new Error('Not authenticated'); });
    expect(() => signedOut.read('settings')).toThrow('Not authenticated');
  });

  it('gives an existing user a copy of the shared files, once', () => {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'settings.json'), '{"shared":1}');
    expect(service.read('settings')).toBe('{"shared":1}');
    expect(service.read('keybindings')).toBeNull();
    writeFileSync(join(base, 'settings.json'), '{"shared":2}');
    expect(service.read('settings')).toBe('{"shared":1}');
  });

  it('starts a newly registered user from defaults', () => {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'settings.json'), '{"shared":1}');
    service.createUserDir('u1');
    expect(service.read('settings')).toBeNull();
  });

  it('rejects user ids that are not plain ids', () => {
    expect(() => new SettingsFileService(() => '../escape').read('settings')).toThrow('Invalid user id');
  });

  it('rejects unknown file names', () => {
    expect(() => service.read('../cord')).toThrow(/Unknown settings file/);
    expect(() => service.write('secrets', '{}')).toThrow(/Unknown settings file/);
  });

  it('rejects oversized text without touching the file', () => {
    service.write('settings', '{}');
    expect(() => service.write('settings', 'x'.repeat(MAX_CONFIG_BYTES + 1))).toThrow(/exceeds/);
    expect(service.read('settings')).toBe('{}');
  });

  it('rejects non-string text', () => {
    expect(() => service.write('settings', 42 as unknown as string)).toThrow(/must be a string/);
  });
});
