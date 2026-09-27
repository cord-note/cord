import { useKeybindingStore } from '../store/keybindings';
import { useThemeStore } from '../store/theme';
import { useSettings } from './index';

/**
 * Startup: paint the first frame from the boot cache, then load the real
 * files. Re-read them whenever the window regains focus, since there is no
 * filesystem watcher and the user may have edited them in another editor.
 */
export function bootSettings(): void {
  useSettings.getState().applyBootCache();
  useThemeStore.getState().init();
  void useSettings.getState().load();
  void useKeybindingStore.getState().load();

  window.addEventListener('focus', () => {
    void useSettings.getState().reload();
    void useKeybindingStore.getState().reload();
  });
}
