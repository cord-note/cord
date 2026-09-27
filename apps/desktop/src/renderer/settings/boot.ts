import { useKeybindingStore } from '../store/keybindings';
import { useThemeStore } from '../store/theme';
import { lastCacheUser, setSettingsCacheUser, useSettings } from './index';
import { hasActiveSettingsUser } from './session';

/**
 * Startup. Settings belong to a user, so no file is read until someone
 * unlocks (settings/session.ts). The first frame is painted from the boot
 * cache of whoever was shown last, so the lock screen opens in their theme.
 * Once unlocked, the files are re-read whenever the window regains focus,
 * since there is no filesystem watcher and the user may have edited them in
 * another editor.
 */
export function bootSettings(): void {
  setSettingsCacheUser(lastCacheUser());
  useSettings.getState().applyBootCache();
  useThemeStore.getState().init();

  window.addEventListener('focus', () => {
    if (!hasActiveSettingsUser()) return;
    void useSettings.getState().reload();
    void useKeybindingStore.getState().reload();
  });
}
