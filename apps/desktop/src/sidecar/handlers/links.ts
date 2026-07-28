import { Router, json, ok } from '../router';
import type { LinkService } from '../services/LinkService';
import type { AuthService } from '../services/AuthService';

export function registerLinkHandlers(router: Router, links: LinkService, auth: AuthService): void {
  router.post('/links', async (req) => {
    auth.requireSession();
    const { fromId, toId } = await req.json() as { fromId: string; toId: string };
    return json(links.create(fromId, toId), 201);
  });

  router.delete('/links', async (req) => {
    auth.requireSession();
    const params = new URL(req.url).searchParams;
    const fromId = params.get('fromId') ?? '';
    const toId   = params.get('toId')   ?? '';
    links.delete(fromId, toId);
    return ok();
  });
}
