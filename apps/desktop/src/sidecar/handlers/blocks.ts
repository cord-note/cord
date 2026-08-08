import { Router, json } from '../router';
import type { BlockIndexService } from '../services/BlockIndexService';
import type { AuthService } from '../services/AuthService';

export function registerBlockHandlers(
  router: Router,
  blocks: BlockIndexService,
  auth: AuthService,
): void {
  router.get('/notes/:id/blocks', async (_req, { id }) => {
    auth.requireSession();
    return json(blocks.listForNote(id!));
  });

  // An unresolved ref is an expected state, not a failure — the source block
  // may have been edited away or its note trashed. Returning 200 with null
  // keeps that out of the renderer's error path, so the node can render its
  // "unresolved" state instead of the invoke rejecting.
  router.get('/blocks/:id/resolve', async (_req, { id }) => {
    auth.requireSession();
    return json(blocks.resolveRef(id!));
  });

  router.post('/notes/:id/reproject', async (_req, { id }) => {
    auth.requireSession();
    blocks.reproject(id!);
    return json(blocks.listForNote(id!));
  });
}
