import { Router, json, ok } from '../router';
import type { SettingsFileService } from '../services/SettingsFileService';

// The files belong to the signed-in user: SettingsFileService resolves the
// user and refuses when nobody is signed in. The lock screen paints from the
// renderer's per-user boot cache instead of reading files.
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
