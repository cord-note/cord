import { Router, json, ok } from '../router';
import type { FragmentService } from '../services/FragmentService';
import type { AuthService } from '../services/AuthService';

export function registerFragmentHandlers(router: Router, fragments: FragmentService, auth: AuthService): void {
  router.get('/fragments', async (req) => {
    auth.requireSession();
    const noteId = new URL(req.url).searchParams.get('noteId') ?? '';
    return json(fragments.getForNote(noteId));
  });

  router.post('/fragments/:blockId/tags/:tagId', async (req, { blockId, tagId }) => {
    auth.requireSession();
    const { noteId, vaultId } = await req.json() as { noteId: string; vaultId: string };
    fragments.attachTag(blockId!, noteId, vaultId, tagId!);
    return ok();
  });

  router.delete('/fragments/:blockId/tags/:tagId', async (_req, { blockId, tagId }) => {
    auth.requireSession();
    fragments.detachTag(blockId!, tagId!);
    return ok();
  });

  router.post('/fragment-links', async (req) => {
    auth.requireSession();
    const data = await req.json();
    return json(fragments.createLink(data), 201);
  });

  router.delete('/fragment-links/:linkId', async (_req, { linkId }) => {
    auth.requireSession();
    fragments.deleteLink(linkId!);
    return ok();
  });
}
