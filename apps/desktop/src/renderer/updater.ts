import { check } from '@tauri-apps/plugin-updater';

/**
 * Ask GitHub whether a newer release exists, and offer to install it.
 *
 * Tauri v2 has no automatic polling — the check is explicit, which is why this
 * is called once on mount rather than configured in tauri.conf.json.
 *
 * Every failure path is swallowed on purpose. Being offline, hitting GitHub's
 * rate limit, or running a version newer than any published release are all
 * ordinary states, and none of them should keep someone out of their notes.
 * The update is a convenience; the app working is not.
 *
 * This is deliberately the smallest thing that functions. It interrupts with a
 * blocking confirm at startup, which is the wrong moment to ask someone
 * anything — a quiet indicator in Settings would be better, and the UI registry
 * is where that belongs once the migration settles.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    const accepted = window.confirm(
      `Cord ${update.version} is available — you are on ${update.currentVersion}.\n\n` +
        'Installing will close Cord. Your notes are on disk and are not touched by an update.',
    );
    if (!accepted) return;

    await update.downloadAndInstall();
  } catch (err) {
    console.error('[updater] check failed:', err);
  }
}
