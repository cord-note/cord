import { describe, it, expect } from 'bun:test';
import { createSettingsStore, type SettingsDeps } from '../store';
import type { SettingDefinition } from '../schema';

// The file is the source of truth and the user may have written it by hand.
// UI changes edit it in place; a file that doesn't parse is never overwritten;
// the boot cache only paints the first frame.

const defs: SettingDefinition[] = [
  { key: 'editor.fontSize', type: 'number', title: '', description: '', section: 'Editor', default: 15, min: 12, max: 20, step: 1 },
  { key: 'editor.spellCheck', type: 'boolean', title: '', description: '', section: 'Editor', default: false },
];

function harness(file: string | null, extra: Partial<SettingsDeps> = {}) {
  const disk = { text: file, writes: [] as string[] };
  let cache: string | null = null;
  const store = createSettingsStore({
    io: {
      read: async () => disk.text,
      write: async (_f, text) => { disk.text = text; disk.writes.push(text); },
    },
    definitions: () => defs,
    cache: { read: () => cache, write: (t) => { cache = t; } },
    writeDelayMs: 5,
    ...extra,
  });
  return { store, disk, getCache: () => cache, setCache: (c: string) => { cache = c; } };
}

describe('settings store', () => {
  it('starts from defaults', () => {
    const { store } = harness(null);
    expect(store.getState().values).toEqual({ 'editor.fontSize': 15, 'editor.spellCheck': false });
  });

  it('applies the boot cache synchronously, ignoring garbage', () => {
    const h = harness(null);
    h.setCache('{"editor.fontSize":18}');
    h.store.getState().applyBootCache();
    expect(h.store.getState().values['editor.fontSize']).toBe(18);
    h.setCache('not json');
    h.store.getState().applyBootCache();
    expect(h.store.getState().values['editor.fontSize']).toBe(18);
  });

  it('loads file values and refreshes the cache', async () => {
    const h = harness('{ "editor.fontSize": 17 }');
    await h.store.getState().load();
    expect(h.store.getState().values['editor.fontSize']).toBe(17);
    expect(h.store.getState().loaded).toBe(true);
    expect(JSON.parse(h.getCache()!)).toEqual({ 'editor.fontSize': 17 });
  });

  it('edits the text in place, preserving comments, and removes keys set to default', async () => {
    const h = harness('{\n  // mine\n  "editor.fontSize": 17\n}');
    await h.store.getState().load();
    h.store.getState().set('editor.spellCheck', true);
    await h.store.getState().flush();
    expect(h.disk.text).toContain('// mine');
    expect(h.disk.text).toContain('"editor.spellCheck": true');
    h.store.getState().set('editor.fontSize', 15);
    await h.store.getState().flush();
    expect(h.disk.text).not.toContain('editor.fontSize');
    expect(h.disk.text).toContain('// mine');
  });

  it('throws on unknown keys and invalid values', async () => {
    const { store } = harness(null);
    await store.getState().load();
    expect(() => store.getState().set('nope.nothing', 1)).toThrow(/Unknown setting/);
    expect(() => store.getState().set('editor.fontSize', 99)).toThrow(/Invalid value/);
  });

  it('holds UI edits in memory while the file has a syntax error', async () => {
    const h = harness('{ "editor.fontSize": 17, }}');
    await h.store.getState().load();
    expect(h.store.getState().syntaxError).toBe(true);
    h.store.getState().set('editor.spellCheck', true);
    await h.store.getState().flush();
    expect(h.store.getState().values['editor.spellCheck']).toBe(true);
    expect(h.disk.writes).toEqual([]);
  });

  it('reports invalid values and keeps defaults for them', async () => {
    const h = harness('{ "editor.fontSize": 99, "future.thing": 1 }');
    await h.store.getState().load();
    expect(h.store.getState().values['editor.fontSize']).toBe(15);
    expect(h.store.getState().problems.map((p) => p.severity).sort()).toEqual(['error', 'warning']);
  });

  it('runs onUserChange for set, not for load', async () => {
    const calls: unknown[] = [];
    const watched: SettingDefinition[] = [
      { ...defs[1]!, onUserChange: (v: boolean, p: boolean) => { calls.push([v, p]); } } as SettingDefinition,
    ];
    const h = harness('{ "editor.spellCheck": true }', { definitions: () => watched });
    await h.store.getState().load();
    expect(calls).toEqual([]);
    h.store.getState().set('editor.spellCheck', false);
    expect(calls).toEqual([[false, true]]);
  });

  it('seeds a missing file from migrate and reports success', async () => {
    let migrated = false;
    const h = harness(null, { migrate: () => ({ 'editor.fontSize': 18 }), onMigrated: () => { migrated = true; } });
    await h.store.getState().load();
    expect(JSON.parse(h.disk.text!)).toEqual({ 'editor.fontSize': 18 });
    expect(migrated).toBe(true);
    expect(h.store.getState().values['editor.fontSize']).toBe(18);
  });

  it('does not report migration when the write fails', async () => {
    let migrated = false;
    const store = createSettingsStore({
      io: { read: async () => null, write: async () => { throw new Error('no disk'); } },
      definitions: () => defs,
      cache: { read: () => null, write: () => {} },
      migrate: () => ({ 'editor.fontSize': 18 }),
      onMigrated: () => { migrated = true; },
    });
    await store.getState().load();
    expect(migrated).toBe(false);
    expect(store.getState().values['editor.fontSize']).toBe(18);
    expect(store.getState().saveError).toMatch(/no disk/);
  });

  it('saveText refuses syntax errors and saves valid text immediately', async () => {
    const h = harness('{}');
    await h.store.getState().load();
    const bad = await h.store.getState().saveText('{ "editor.fontSize": }');
    expect(bad[0]?.severity).toBe('error');
    expect(h.disk.writes).toEqual([]);
    await h.store.getState().saveText('{ "editor.fontSize": 19 }');
    expect(h.disk.text).toBe('{ "editor.fontSize": 19 }');
    expect(h.store.getState().values['editor.fontSize']).toBe(19);
  });

  it('reload picks up an external edit', async () => {
    const h = harness('{}');
    await h.store.getState().load();
    h.disk.text = '{ "editor.fontSize": 13 }';
    await h.store.getState().reload();
    expect(h.store.getState().values['editor.fontSize']).toBe(13);
  });
});
