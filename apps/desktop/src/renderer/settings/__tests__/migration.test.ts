import { describe, it, expect } from 'bun:test';
import { clearLegacySettings, readLegacySettings } from '../migration';
import type { SettingDefinition } from '../schema';

// Settings used to live in scattered localStorage keys. They move into the
// first settings.json once; only valid, non-default values are carried over.

const defs: SettingDefinition[] = [
  { key: 'editor.fontSize', type: 'number', title: '', description: '', section: 'Editor', default: 15, min: 12, max: 20, step: 1 },
  { key: 'editor.unlinkedMentions', type: 'boolean', title: '', description: '', section: 'Editor', default: true },
  { key: 'appearance.colorScheme', type: 'enum', title: '', description: '', section: 'Appearance', default: 'dark',
    options: [{ value: 'dark', label: '' }, { value: 'light', label: '' }, { value: 'system', label: '' }] },
  { key: 'appearance.theme', type: 'string', title: '', description: '', section: 'Appearance', default: 'mono', pattern: /^[a-z0-9-]+$/ },
];

function storage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => { map.delete(k); },
  };
}

describe('readLegacySettings', () => {
  it('carries over valid non-default values', () => {
    const s = storage({ 'cord-font-size': '17', 'cord-unlinked-mentions': 'false', 'cord-scheme': 'light', 'cord-theme': 'teal' });
    expect(readLegacySettings(s, defs)).toEqual({
      'editor.fontSize': 17,
      'editor.unlinkedMentions': false,
      'appearance.colorScheme': 'light',
      'appearance.theme': 'teal',
    });
  });

  it('drops defaults, invalid values and missing keys', () => {
    const s = storage({ 'cord-font-size': '15', 'cord-scheme': 'sepia', 'cord-theme': 'Not A Slug' });
    expect(readLegacySettings(s, defs)).toEqual({});
  });
});

describe('clearLegacySettings', () => {
  it('removes every legacy settings key and nothing else', () => {
    const s = storage({ 'cord-font-size': '17', 'cord-theme': 'teal', 'cord-vault-order': '[]' });
    clearLegacySettings(s);
    expect([...s.map.keys()]).toEqual(['cord-vault-order']);
  });
});
