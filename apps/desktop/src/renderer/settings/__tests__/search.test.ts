import { describe, it, expect } from 'bun:test';
import { filterSettings, modifiedKeys } from '../search';
import type { SettingDefinition } from '../schema';

const defs: SettingDefinition[] = [
  { key: 'editor.fontSize', type: 'number', title: 'Font size', description: 'Text size in the editor.', section: 'Editor', default: 15, min: 12, max: 20, step: 1, keywords: ['zoom'] },
  { key: 'editor.spellCheck', type: 'boolean', title: 'Spell check', description: 'Underline misspelled words.', section: 'Editor', default: false },
  { key: 'appearance.theme', type: 'string', title: 'Theme', description: 'Colour palette.', section: 'Appearance', default: 'mono' },
];

const keys = (d: SettingDefinition[]) => d.map((x) => x.key);

describe('filterSettings', () => {
  it('returns everything for an empty query', () => {
    expect(keys(filterSettings(defs, '  ', new Set()))).toEqual(keys(defs));
  });

  it('matches title, description, key, section and keywords, case-insensitively', () => {
    expect(keys(filterSettings(defs, 'SPELL', new Set()))).toEqual(['editor.spellCheck']);
    expect(keys(filterSettings(defs, 'misspelled', new Set()))).toEqual(['editor.spellCheck']);
    expect(keys(filterSettings(defs, 'appearance.theme', new Set()))).toEqual(['appearance.theme']);
    expect(keys(filterSettings(defs, 'zoom', new Set()))).toEqual(['editor.fontSize']);
    expect(keys(filterSettings(defs, 'editor', new Set()))).toEqual(['editor.fontSize', 'editor.spellCheck']);
  });

  it('requires every word to match', () => {
    expect(keys(filterSettings(defs, 'editor size', new Set()))).toEqual(['editor.fontSize']);
  });

  it('@modified filters to changed settings, alone or with words', () => {
    const changed = new Set(['editor.fontSize', 'appearance.theme']);
    expect(keys(filterSettings(defs, '@modified', changed))).toEqual(['editor.fontSize', 'appearance.theme']);
    expect(keys(filterSettings(defs, '@modified theme', changed))).toEqual(['appearance.theme']);
  });
});

describe('modifiedKeys', () => {
  it('lists settings whose value differs from the default', () => {
    expect([...modifiedKeys(defs, { 'editor.fontSize': 17, 'editor.spellCheck': false, 'appearance.theme': 'mono' })])
      .toEqual(['editor.fontSize']);
  });
});
