import { Router, json, ok } from '../router';
import type { AuthService } from '../services/AuthService';
import type { UnlockPinInput } from '@shared/types';

// No session checks here: these routes are how a session starts. The ones that
// need a signed-in user get it from AuthService, which refuses without one.
export function registerAuthHandlers(router: Router, auth: AuthService): void {
  router.get('/auth/lock-screen', async () => json(auth.getLockScreenState()));

  router.get('/auth/current', async () => json(auth.currentUser()));

  router.post('/auth/register', async (req) => json(await auth.register(await req.json()), 201));

  router.post('/auth/login', async (req) => json(await auth.login(await req.json())));

  router.post('/auth/unlock-pin', async (req) => {
    const { userId, pin } = (await req.json()) as UnlockPinInput;
    return json(await auth.unlockWithPin(userId, pin));
  });

  router.post('/auth/pin', async (req) => json(await auth.setPin(await req.json())));

  router.post('/auth/verify-password', async (req) => {
    const { password } = (await req.json()) as { password: string };
    await auth.verifyPassword(password);
    return ok();
  });

  router.post('/auth/password', async (req) => {
    await auth.changePassword(await req.json());
    return ok();
  });

  router.post('/auth/recovery-key', async (req) => json(await auth.issueRecoveryKey(await req.json())));

  router.post('/auth/recover', async (req) => json(await auth.recover(await req.json())));

  router.post('/auth/lock', async () => {
    auth.lock();
    return ok();
  });
}
