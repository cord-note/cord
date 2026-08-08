import { Router, json, ok } from '../router';
import type { NoteService } from '../services/NoteService';
import type { AuthService } from '../services/AuthService';

export function registerNoteHandlers(router: Router, notes: NoteService, auth: AuthService): void {
  router.get('/notes', async (req) => {
    auth.requireSession();
    const vaultId = new URL(req.url).searchParams.get('vaultId') ?? '';
    return json(notes.list(vaultId));
  });

  router.get('/notes/deleted', async (req) => {
    auth.requireSession();
    const vaultId = new URL(req.url).searchParams.get('vaultId') ?? '';
    return json(notes.listDeleted(vaultId));
  });

  router.get('/notes/search', async (req) => {
    auth.requireSession();
    const params = new URL(req.url).searchParams;
    const vaultId = params.get('vaultId') ?? '';
    const query   = params.get('q')       ?? '';
    return json(notes.search(vaultId, query));
  });

  router.get('/notes/:id', async (_req, { id }) => {
    auth.requireSession();
    const note = notes.get(id!);
    return note ? json(note) : json({ error: 'not found' }, 404);
  });

  router.post('/notes', async (req) => {
    auth.requireSession();
    const data = await req.json();
    return json(notes.create(data), 201);
  });

  router.patch('/notes/:id', async (req, { id }) => {
    auth.requireSession();
    const data = await req.json();
    return json(notes.update(id!, data));
  });

  router.post('/notes/:id/delete', async (_req, { id }) => {
    auth.requireSession();
    notes.delete(id!);
    return ok();
  });

  router.post('/notes/:id/restore', async (_req, { id }) => {
    auth.requireSession();
    return json(notes.restore(id!));
  });

  router.post('/notes/:id/permanent-delete', async (_req, { id }) => {
    auth.requireSession();
    notes.permanentDelete(id!);
    return ok();
  });

  router.get('/notes/:id/links', async (_req, { id }) => {
    auth.requireSession();
    return json(notes.getLinks(id!));
  });

  router.post('/notes/:id/convert', async (req, { id }) => {
    auth.requireSession();
    const { kind } = await req.json();
    if (kind !== 'note' && kind !== 'notepad') {
      return json({ error: `invalid kind: ${kind}` }, 400);
    }
    return json(notes.convert(id!, kind));
  });

  router.get('/notes/:id/conversion-impact', async (_req, { id }) => {
    auth.requireSession();
    return json(notes.conversionImpact(id!));
  });

  router.get('/notes/:id/unlinked-mentions', async (req, { id }) => {
    auth.requireSession();
    const vaultId = new URL(req.url).searchParams.get('vaultId') ?? '';
    return json(notes.findUnlinkedMentions(id!, vaultId));
  });
}
