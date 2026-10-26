import { Router, json } from '../router';
import type { ThemeLibraryService } from '../services/ThemeLibraryService';
import type { AuthService } from '../services/AuthService';

// The library folder is a per-user setting, so the renderer sends it with each
// call; an empty string means the default folder.
export function registerThemeHandlers(router: Router, themes: ThemeLibraryService, auth: AuthService): void {
  router.get('/themes/default-dir', async () => {
    auth.requireSession();
    return json({ dir: themes.defaultDir() });
  });

  router.post('/themes/scan', async (req) => {
    auth.requireSession();
    const { dir } = (await req.json()) as { dir: string };
    return json(themes.scan(dir ?? ''));
  });

  router.post('/themes/import', async (req) => {
    auth.requireSession();
    const { source, dir } = (await req.json()) as { source: string; dir: string };
    return json(themes.importFrom(source, dir ?? ''));
  });

  router.post('/themes/import-url', async (req) => {
    auth.requireSession();
    const { url, dir } = (await req.json()) as { url: string; dir: string };
    return json(await themes.importFromUrl(url, dir ?? ''));
  });
}
