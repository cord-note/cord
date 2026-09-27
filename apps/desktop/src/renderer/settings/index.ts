import { ipcConfigIO } from './ipcConfigIO';
import { adoptLegacyCache, clearLegacySettings, readLegacySettings, userCacheKey } from './migration';
import { settingDefinition, useSettingsRegistry } from './registry';
import type { SettingKey, SettingValues } from './schema';
import { createSettingsStore } from './store';

export type { SettingKey, SettingValues } from './schema';
export { registerSetting, settingDefinition, useSettingsRegistry } from './registry';

/** Remembers whose cache painted the last frame, so the next launch paints it before the sidecar answers. */
const CACHE_USER_KEY = 'cord-settings-cache-user';

/** Whose boot cache `useSettings` reads and writes. Null when nobody is chosen. */
let cacheUserId: string | null = null;

/** Point the boot cache at `userId`. Call before the store is touched on a user switch. */
export function setSettingsCacheUser(userId: string | null): void {
  cacheUserId = userId;
  if (!userId) return;
  try {
    localStorage.setItem(CACHE_USER_KEY, userId);
    adoptLegacyCache(localStorage, userId);
  } catch {
    // Storage blocked: the lock screen paints defaults until unlock.
  }
}

export function lastCacheUser(): string | null {
  try {
    return localStorage.getItem(CACHE_USER_KEY);
  } catch {
    return null;
  }
}

/** The app's settings. File-backed through the sidecar. */
export const useSettings = createSettingsStore({
  io: ipcConfigIO,
  definitions: () => useSettingsRegistry.getState().definitions,
  cache: {
    read: () => (cacheUserId ? localStorage.getItem(userCacheKey(cacheUserId)) : null),
    write: (text) => { if (cacheUserId) localStorage.setItem(userCacheKey(cacheUserId), text); },
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
