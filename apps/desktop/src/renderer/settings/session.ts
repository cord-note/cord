import { flushKeybindings, unloadKeybindings, useKeybindingStore } from '../store/keybindings';
import { setSettingsCacheUser, useSettings } from './index';

/**
 * Which user's settings the app is showing. Files are read only for a
 * signed-in user; the lock screen shows a user's boot cache instead.
 */

let activeUserId: string | null = null;

/** True while a signed-in user's files are loaded. Reloading before that is refused by the sidecar. */
export function hasActiveSettingsUser(): boolean {
  return activeUserId !== null;
}

/** Lock screen: show `userId`'s last-known look from their boot cache. Reads no files. */
export async function previewUserSettings(userId: string | null): Promise<void> {
  await release();
  setSettingsCacheUser(userId);
  useSettings.getState().applyBootCache();
}

/** After unlock: read the user's settings.json and keybindings.json. */
export async function loadUserSettings(userId: string): Promise<void> {
  await previewUserSettings(userId);
  activeUserId = userId;
  await Promise.all([useSettings.getState().load(), useKeybindingStore.getState().load()]);
}

/** Before the session ends: write anything pending into this user's files, and stop reading them. */
export async function flushUserSettings(): Promise<void> {
  activeUserId = null;
  await Promise.all([useSettings.getState().flush(), flushKeybindings()]);
}

async function release(): Promise<void> {
  activeUserId = null;
  // Write everything first, then reset: resetting one store while the other
  // still waits on a write would show the default theme for that long.
  await Promise.all([useSettings.getState().flush(), flushKeybindings()]);
  await Promise.all([useSettings.getState().unload(), unloadKeybindings()]);
}
