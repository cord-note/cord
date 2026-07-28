import { Router, json, ok } from '../router';
import type { TagService } from '../services/TagService';
import type { AuthService } from '../services/AuthService';

export function registerTagHandlers(router: Router, tags: TagService, auth: AuthService): void {
  router.get('/tags', async (req) => {
    auth.requireSession();
    const vaultId = new URL(req.url).searchParams.get('vaultId') ?? '';
    return json(tags.list(vaultId));
  });

  router.post('/tags', async (req) => {
    auth.requireSession();
    const data = await req.json();
    return json(tags.create(data), 201);
  });

  router.delete('/tags/:tagId', async (_req, { tagId }) => {
    auth.requireSession();
    tags.delete(tagId!);
    return ok();
  });

  router.get('/tags/note-map', async (req) => {
    auth.requireSession();
    const vaultId = new URL(req.url).searchParams.get('vaultId') ?? '';
    return json(tags.getNoteMap(vaultId));
  });

  router.get('/notes/:noteId/tags', async (_req, { noteId }) => {
    auth.requireSession();
    return json(tags.getForNote(noteId!));
  });

  router.post('/notes/:noteId/tags/:tagId', async (_req, { noteId, tagId }) => {
    auth.requireSession();
    tags.attach(noteId!, tagId!);
    return ok();
  });

  router.delete('/notes/:noteId/tags/:tagId', async (_req, { noteId, tagId }) => {
    auth.requireSession();
    tags.detach(noteId!, tagId!);
    return ok();
  });
}
