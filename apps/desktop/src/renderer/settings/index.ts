import { ipcConfigIO } from './ipcConfigIO';
import { clearLegacySettings, readLegacySettings } from './migration';
import { settingDefinition, useSettingsRegistry } from './registry';
import type { SettingKey, SettingValues } from './schema';
import { createSettingsStore } from './store';

export type { SettingKey, SettingValues } from './schema';
export { registerSetting, settingDefinition, useSettingsRegistry } from './registry';

const CACHE_KEY = 'cord-settings-cache';

/** The app's settings. File-backed through the sidecar. */
export const useSettings = createSettingsStore({
  io: ipcConfigIO,
  definitions: () => useSettingsRegistry.getState().definitions,
  cache: {
    read: () => localStorage.getItem(CACHE_KEY),
    write: (text) => localStorage.setItem(CACHE_KEY, text),
  },
  migrate: () => readLegacySettings(localStorage, useSettingsRegistry.getState().definitions),
  onMigrated: () => clearLegacySettings(localStorage),
});

// A module that registers late gets its values resolved from the file too.
useSettingsRegistry.subscribe(() => useSettings.getState().refreshDefinitions());

export function useSetting<K extends SettingKey>(key: K): SettingValues[K] {
  return useSettings((s) => s.values[key]) as SettingValues[K];
}

export function getSetting<K extends SettingKey>(key: K): SettingValues[K] {
  return useSettings.getState().values[key] as SettingValues[K];
}

export function setSetting<K extends SettingKey>(key: K, value: SettingValues[K]): void {
  useSettings.getState().set(key, value);
}

export function resetSetting(key: SettingKey): void {
  useSettings.getState().reset(key);
}

/**
 * `n` clamped to a number setting's range and rounded to its step — for
 * values that come from a drag rather than from the setting's own control.
 */
export function snapToSetting(key: SettingKey, n: number): number {
  const def = settingDefinition(key);
  if (def?.type !== 'number') return n;
  const clamped = Math.min(def.max, Math.max(def.min, n));
  return def.min + Math.round((clamped - def.min) / def.step) * def.step;
}
