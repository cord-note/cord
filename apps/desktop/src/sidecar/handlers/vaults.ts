import { Router, json, ok } from '../router';
import type { VaultService } from '../services/VaultService';
import type { AuthService } from '../services/AuthService';

export function registerVaultHandlers(router: Router, vaults: VaultService, auth: AuthService): void {
  router.get('/vaults', async (_req) => {
    const { userId } = auth.requireSession();
    return json(vaults.list(userId));
  });

  router.post('/vaults', async (req) => {
    const { userId } = auth.requireSession();
    const data = await req.json();
    return json(vaults.create({ ...data, userId }), 201);
  });

  router.get('/vaults/:id', async (_req, { id }) => {
    auth.requireSession();
    const vault = vaults.getById(id!);
    return vault ? json(vault) : json({ error: 'not found' }, 404);
  });

  router.patch('/vaults/:id', async (req, { id }) => {
    auth.requireSession();
    const data = await req.json();
    return json(vaults.update(id!, data));
  });

  router.post('/vaults/:id/archive', async (_req, { id }) => {
    auth.requireSession();
    vaults.archive(id!);
    return ok();
  });
}
