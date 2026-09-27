import { Router, json, ok } from '../router';
import type { SettingsFileService } from '../services/SettingsFileService';

// No session check: the theme and colour mode apply on the sign-in screen too,
// and settings are per-device, not per-account.
export function registerSettingsHandlers(router: Router, files: SettingsFileService): void {
  router.get('/settings/:file', async (_req, { file }) => {
    return json({ text: files.read(file!) });
  });

  router.post('/settings/:file', async (req, { file }) => {
    const { text } = (await req.json()) as { text: string };
    files.write(file!, text);
    return ok();
  });
}
