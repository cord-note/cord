import { describe, it, expect, beforeEach } from 'bun:test';
import { registerSetting, settingDefinition, useSettingsRegistry } from '../registry';
import type { SettingDefinition } from '../schema';

const spell: SettingDefinition = {
  key: 'editor.spellCheck', type: 'boolean', title: 'Spell check', description: '', section: 'Editor', default: false,
};

beforeEach(() => useSettingsRegistry.setState({ definitions: [] }));

describe('SettingsRegistry', () => {
  it('registers and looks up a declaration', () => {
    registerSetting(spell);
    expect(settingDefinition('editor.spellCheck')).toBe(spell);
    expect(useSettingsRegistry.getState().definitions).toEqual([spell]);
  });

  it('refuses a duplicate key', () => {
    registerSetting(spell);
    expect(() => registerSetting({ ...spell, title: 'Again' })).toThrow(/already registered/);
  });

  it('refuses a malformed declaration', () => {
    expect(() => registerSetting({ ...spell, key: 'spellcheck' })).toThrow(/key/);
    expect(useSettingsRegistry.getState().definitions).toEqual([]);
  });

  it('returns undefined for an unknown key', () => {
    expect(settingDefinition('nope.nothing')).toBeUndefined();
  });
});
