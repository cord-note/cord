import { validateValue, type SettingDefinition } from './schema';

/**
 * The one-time move from the old localStorage keys into the first
 * settings.json. Vault order (`cord-vault-order`) is UI state and stays put.
 */

const LEGACY: Record<string, { storageKey: string; parse: (raw: string) => unknown }> = {
  'editor.fontSize':         { storageKey: 'cord-font-size',             parse: Number },
  'editor.lineWidth':        { storageKey: 'cord-line-width',            parse: Number },
  'editor.spellCheck':       { storageKey: 'cord-spell-check',           parse: (r) => r === 'true' },
  'editor.unlinkedMentions': { storageKey: 'cord-unlinked-mentions',     parse: (r) => r !== 'false' },
  'vaults.distinctColors':   { storageKey: 'cord-distinct-vault-colors', parse: (r) => r === 'true' },
  'appearance.theme':        { storageKey: 'cord-theme',                 parse: (r) => r },
  'appearance.colorScheme':  { storageKey: 'cord-scheme',                parse: (r) => r },
};

/** Keybinding overrides moved into keybindings.json the same way. */
export const LEGACY_KEYBINDINGS_KEY = 'cord-keybindings';

export function readLegacySettings(
  storage: Pick<Storage, 'getItem'>,
  defs: readonly SettingDefinition[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, { storageKey, parse }] of Object.entries(LEGACY)) {
    const raw = storage.getItem(storageKey);
    const def = defs.find((d) => d.key === key);
    if (raw === null || !def) continue;
    const value = parse(raw);
    if (validateValue(def, value) === null && !Object.is(value, def.default)) out[key] = value;
  }
  return out;
}

export function clearLegacySettings(storage: Pick<Storage, 'removeItem'>): void {
  for (const { storageKey } of Object.values(LEGACY)) storage.removeItem(storageKey);
}
