import { describe, it, expect } from 'bun:test';
import { buildSettingsNav, type SettingsPageRef } from '../layout';
import { filterSettings } from '../search';
import type { SettingDefinition } from '../schema';

const def = (key: string, section: string, title = key): SettingDefinition =>
  ({ key, section, title, type: 'boolean', default: false } as unknown as SettingDefinition);

const Noop = () => null;
const pages: SettingsPageRef[] = [
  { id: 'keyboard', label: 'Keyboard', component: Noop },
  { id: 'vault',    label: 'Vault',    component: Noop },
  { id: 'tags',     label: 'Tags',     component: Noop },
  { id: 'account',  label: 'Account',  component: Noop },
];

const defs = [
  def('appearance.theme', 'Appearance'),
  def('editor.spellCheck', 'Editor'),
  def('notes.defaultKind', 'Notes'),
  def('general.holdToConfirm', 'General'),
  def('vaults.distinctColors', 'Vaults', 'Use distinct vault colors'),
  def('security.idleLockMinutes', 'Security'),
];

function nav(query = '', extraDefs: SettingDefinition[] = [], extraPages: SettingsPageRef[] = []) {
  const all = [...defs, ...extraDefs];
  return buildSettingsNav(all, filterSettings(all, query, new Set()), [...pages, ...extraPages], query);
}

describe('buildSettingsNav', () => {
  it('groups chapters into App, This vault and Account', () => {
    const groups = nav();
    expect(groups.map((g) => g.label)).toEqual(['App', 'This vault', 'Account']);
    expect(groups[0]!.chapters.map((c) => c.label)).toEqual(['Appearance', 'Editor', 'General', 'Keyboard']);
    expect(groups[1]!.chapters.map((c) => c.label)).toEqual(['Vault', 'Tags']);
  });

  it('merges Notes into General and Security into Account', () => {
    const groups = nav();
    const general = groups[0]!.chapters.find((c) => c.label === 'General')!;
    expect(general.settings.map((s) => s.key)).toEqual(['notes.defaultKind', 'general.holdToConfirm']);
    const account = groups[2]!.chapters[0]!;
    expect(account.page).toBeDefined();
    expect(account.settings.map((s) => s.key)).toEqual(['security.idleLockMinutes']);
  });

  it('does not list the Vaults section on its own', () => {
    const labels = nav().flatMap((g) => g.chapters.map((c) => c.label));
    expect(labels).not.toContain('Vaults');
  });

  it('shows the Vault page when searching for its embedded setting', () => {
    const groups = nav('distinct');
    expect(groups.flatMap((g) => g.chapters.map((c) => c.label))).toEqual(['Vault']);
  });

  it('puts unknown sections and pages under Other', () => {
    const groups = nav('', [def('sync.enabled', 'Sync')], [{ id: 'export', label: 'Export', component: Noop }]);
    const other = groups[groups.length - 1]!;
    expect(other.label).toBe('Other');
    expect(other.chapters.map((c) => c.label)).toEqual(['Sync', 'Export']);
  });
});
