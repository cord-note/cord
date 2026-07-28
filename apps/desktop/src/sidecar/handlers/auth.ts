import { Router, json, ok } from '../router';
import type { AuthService } from '../services/AuthService';

export function registerAuthHandlers(router: Router, auth: AuthService): void {
  router.get('/auth/has-users', async () => {
    return json({ hasUsers: auth.hasUsers() });
  });

  router.post('/auth/register', async (req) => {
    const data = await req.json();
    const user = await auth.register(data);
    return json(user, 201);
  });

  router.post('/auth/login', async (req) => {
    const data = await req.json();
    const user = await auth.login(data);
    return json(user);
  });

  router.post('/auth/logout', async () => {
    auth.logout();
    return ok();
  });

  router.get('/auth/session', async () => {
    return json(auth.getSession());
  });
}
