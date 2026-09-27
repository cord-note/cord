import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CONFIG_BYTES, SettingsFileService } from '../SettingsFileService';

// Settings files are stored as opaque text: the renderer owns parsing, so a
// hand-edited file — comments and all — must round-trip byte for byte.

describe('SettingsFileService', () => {
  let dir: string;
  let service: SettingsFileService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cord-config-'));
    process.env['CORD_CONFIG_DIR'] = join(dir, 'nested');
    service = new SettingsFileService();
  });

  afterEach(() => {
    delete process.env['CORD_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a missing file as null', () => {
    expect(service.read('settings')).toBeNull();
  });

  it('writes text verbatim, creating the directory, and reads it back', () => {
    const text = '{\n  // bigger text\n  "editor.fontSize": 17,\n}\n';
    service.write('settings', text);
    expect(readFileSync(join(dir, 'nested', 'settings.json'), 'utf8')).toBe(text);
    expect(service.read('settings')).toBe(text);
  });

  it('replaces an existing file and leaves no temp file behind', () => {
    service.write('keybindings', '{"a":1}');
    service.write('keybindings', '{"a":2}');
    expect(service.read('keybindings')).toBe('{"a":2}');
    expect(readdirSync(join(dir, 'nested'))).toEqual(['keybindings.json']);
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
