import { describe, it, expect } from 'bun:test';
import { resolveValues, validateDefinition, validateValue, type SettingDefinition } from '../schema';

// One declaration per setting drives validation and defaults. A value that
// fails its declaration must never reach the app: it falls back to the
// default and is reported, and the file itself is left alone.

const size: SettingDefinition = {
  key: 'editor.fontSize', type: 'number', title: 'Font size', description: '', section: 'Editor',
  default: 15, min: 12, max: 20, step: 1,
};
const width: SettingDefinition = {
  key: 'editor.lineWidth', type: 'number', title: 'Line width', description: '', section: 'Editor',
  default: 720, min: 480, max: 1200, step: 40,
};
const spell: SettingDefinition = {
  key: 'editor.spellCheck', type: 'boolean', title: 'Spell check', description: '', section: 'Editor', default: false,
};
const scheme: SettingDefinition = {
  key: 'appearance.colorScheme', type: 'enum', title: 'Color mode', description: '', section: 'Appearance',
  default: 'dark', options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
};
const theme: SettingDefinition = {
  key: 'appearance.theme', type: 'string', title: 'Theme', description: '', section: 'Appearance',
  default: 'mono', pattern: /^[a-z0-9-]+$/, maxLength: 64,
};

describe('validateValue', () => {
  it('checks booleans', () => {
    expect(validateValue(spell, true)).toBeNull();
    expect(validateValue(spell, 'true')).toMatch(/true or false/);
  });

  it('checks number type, range and step', () => {
    expect(validateValue(width, 760)).toBeNull();
    expect(validateValue(width, 'x')).toMatch(/number/);
    expect(validateValue(width, Number.NaN)).toMatch(/number/);
    expect(validateValue(width, 1240)).toMatch(/480–1200/);
    expect(validateValue(width, 500)).toMatch(/steps of 40/);
  });

  it('checks enum membership', () => {
    expect(validateValue(scheme, 'light')).toBeNull();
    expect(validateValue(scheme, 'sepia')).toMatch(/"dark", "light"/);
  });

  it('checks string pattern and length', () => {
    expect(validateValue(theme, 'midnight')).toBeNull();
    expect(validateValue(theme, 'Mid Night')).toMatch(/format/);
    expect(validateValue(theme, 'a'.repeat(65))).toMatch(/64/);
    expect(validateValue(theme, 3)).toMatch(/string/);
  });
});

describe('validateDefinition', () => {
  it('accepts a good declaration', () => {
    expect(() => validateDefinition(size)).not.toThrow();
  });

  it('rejects malformed keys', () => {
    for (const key of ['fontSize', 'Editor.fontSize', 'editor.font-size', 'editor.', '.x']) {
      expect(() => validateDefinition({ ...spell, key })).toThrow(/key/);
    }
  });

  it('rejects a default that fails its own declaration', () => {
    expect(() => validateDefinition({ ...size, default: 30 })).toThrow(/default/);
  });

  it('rejects impossible number bounds and empty enums', () => {
    expect(() => validateDefinition({ ...size, min: 20, max: 12, default: 15 })).toThrow(/min/);
    expect(() => validateDefinition({ ...size, step: 0 })).toThrow(/step/);
    expect(() => validateDefinition({ ...scheme, options: [] })).toThrow(/option/);
  });
});

describe('resolveValues', () => {
  const defs = [size, spell, scheme];

  it('uses defaults for missing keys and file values for valid ones', () => {
    const { values, problems } = resolveValues(defs, { 'editor.fontSize': 17 });
    expect(values).toEqual({ 'editor.fontSize': 17, 'editor.spellCheck': false, 'appearance.colorScheme': 'dark' });
    expect(problems).toEqual([]);
  });

  it('falls back to the default for an invalid value and reports it', () => {
    const { values, problems } = resolveValues(defs, { 'editor.fontSize': 99 });
    expect(values['editor.fontSize']).toBe(15);
    expect(problems).toEqual([expect.objectContaining({ key: 'editor.fontSize', severity: 'error' })]);
  });

  it('keeps unknown keys out of the values and warns about them', () => {
    const { values, problems } = resolveValues(defs, { 'future.option': 1 });
    expect('future.option' in values).toBe(false);
    expect(problems).toEqual([expect.objectContaining({ key: 'future.option', severity: 'warning' })]);
  });
});
