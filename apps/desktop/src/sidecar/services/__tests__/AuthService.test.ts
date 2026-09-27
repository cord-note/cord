import { describe, it, expect, beforeEach } from 'bun:test';
import { AuthService, MAX_PIN_ATTEMPTS } from '../AuthService';
import type { AuthUser } from '@shared/types';
import { freshDb } from './helpers';

// Fast hashes and no back-off: these tests are about the rules, not bcrypt.
const makeAuth = (onRegister?: (userId: string) => void): AuthService =>
  new AuthService({ hashCost: 4, recoveryFailureDelayMs: 0, onRegister });

let auth: AuthService;

beforeEach(() => {
  freshDb();
  auth = makeAuth();
  auth.lock(); // the session is process-wide; start every test signed out
});

async function userWithPin(username = 'alice', pin = '1234'): Promise<AuthUser> {
  const user = await auth.register({ username, password: 'correct horse' });
  await auth.setPin({ pin });
  auth.lock();
  return user;
}

describe('AuthService — sign-in and PIN unlock', () => {
  it('registering signs in, remembers the user and reports no PIN yet', async () => {
    const registered: string[] = [];
    auth = makeAuth((id) => registered.push(id));
    const user = await auth.register({ username: ' Alice ', password: 'correct horse' });
    expect(user).toMatchObject({ username: 'alice', hasPin: false, hasRecoveryKey: false });
    expect(auth.getSession()?.userId).toBe(user.id);
    expect(auth.currentUser()).toEqual(user);
    expect(registered).toEqual([user.id]);
    expect(auth.getLockScreenState().lastUserId).toBe(user.id);
  });

  it('lists users alphabetically for the lock screen', async () => {
    expect(auth.getLockScreenState()).toEqual({ users: [], lastUserId: null });
    const zed = await userWithPin('zed');
    const amy = await auth.register({ username: 'amy', password: 'pw-amy-123' });
    expect(auth.getLockScreenState()).toEqual({
      users: [
        { id: amy.id, username: 'amy', hasPin: false, pinLocked: false },
        { id: zed.id, username: 'zed', hasPin: true, pinLocked: false },
      ],
      lastUserId: amy.id,
    });
  });

  it('accepts only 4 to 6 digit PINs', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    for (const pin of ['123', '1234567', '12a4', ' 1234', '']) {
      await expect(auth.setPin({ pin })).rejects.toThrow('PIN must be 4 to 6 digits');
    }
    await expect(auth.setPin({ pin: '123456' })).resolves.toMatchObject({ hasPin: true });
  });

  it('needs the password to replace an existing PIN', async () => {
    const user = await auth.register({ username: 'alice', password: 'correct horse' });
    await auth.setPin({ pin: '1234' });
    await expect(auth.setPin({ pin: '5678' })).rejects.toThrow('Wrong password');
    await expect(auth.setPin({ pin: '5678', password: 'nope' })).rejects.toThrow('Wrong password');
    await auth.setPin({ pin: '5678', password: 'correct horse' });
    auth.lock();
    expect((await auth.unlockWithPin(user.id, '5678')).ok).toBe(true);
  });

  it('unlocks with the right PIN and remembers the user', async () => {
    const user = await userWithPin();
    const result = await auth.unlockWithPin(user.id, '1234');
    expect(result).toEqual({ ok: true, user: expect.objectContaining({ id: user.id, hasPin: true }) });
    expect(auth.getSession()?.userId).toBe(user.id);
    expect(auth.getLockScreenState().lastUserId).toBe(user.id);
  });

  it('counts wrong PINs and refuses the PIN at the limit', async () => {
    const user = await userWithPin();
    for (let left = MAX_PIN_ATTEMPTS - 1; left >= 0; left--) {
      expect(await auth.unlockWithPin(user.id, '0000')).toEqual({ ok: false, triesLeft: left });
    }
    expect(auth.getSession()).toBeNull();
    expect(auth.getLockScreenState().users[0]!.pinLocked).toBe(true);
    // Even the right PIN is refused now.
    await expect(auth.unlockWithPin(user.id, '1234')).rejects.toThrow('Too many wrong PINs');
  });

  it('keeps the count across restarts', async () => {
    const user = await userWithPin();
    await auth.unlockWithPin(user.id, '0000');
    const restarted = makeAuth();
    expect(await restarted.unlockWithPin(user.id, '0000')).toEqual({ ok: false, triesLeft: MAX_PIN_ATTEMPTS - 2 });
  });

  it('resets the count after the right PIN', async () => {
    const user = await userWithPin();
    await auth.unlockWithPin(user.id, '0000');
    await auth.unlockWithPin(user.id, '1234');
    auth.lock();
    expect(await auth.unlockWithPin(user.id, '0000')).toEqual({ ok: false, triesLeft: MAX_PIN_ATTEMPTS - 1 });
  });

  it('re-enables a refused PIN after a password sign-in', async () => {
    const user = await userWithPin();
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) await auth.unlockWithPin(user.id, '0000');
    await auth.login({ username: 'alice', password: 'correct horse' });
    auth.lock();
    expect((await auth.unlockWithPin(user.id, '1234')).ok).toBe(true);
  });

  it('refuses PIN unlock for a user who has no PIN', async () => {
    const user = await auth.register({ username: 'alice', password: 'correct horse' });
    auth.lock();
    await expect(auth.unlockWithPin(user.id, '1234')).rejects.toThrow('no PIN yet');
  });

  it('rejects a bad sign-in without saying which part was wrong', async () => {
    await userWithPin();
    await expect(auth.login({ username: 'alice', password: 'nope' })).rejects.toThrow('Invalid username or password');
    await expect(auth.login({ username: 'bob', password: 'nope' })).rejects.toThrow('Invalid username or password');
  });

  it('forgets the session on lock', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    auth.lock();
    expect(auth.currentUser()).toBeNull();
    expect(() => auth.requireSession()).toThrow('Not authenticated');
  });
});

describe('AuthService — password and recovery key', () => {
  const KEY_FORMAT = /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/;

  it('changes the password only with the current one', async () => {
    await auth.register({ username: 'alice', password: 'old password' });
    await expect(auth.changePassword({ currentPassword: 'nope', newPassword: 'new password' })).rejects.toThrow('Wrong password');
    await auth.changePassword({ currentPassword: 'old password', newPassword: 'new password' });
    auth.lock();
    await expect(auth.login({ username: 'alice', password: 'old password' })).rejects.toThrow();
    await expect(auth.login({ username: 'alice', password: 'new password' })).resolves.toMatchObject({ username: 'alice' });
  });

  it('issues the first key without a password and later ones only with it', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    const first = await auth.issueRecoveryKey({});
    expect(first.recoveryKey).toMatch(KEY_FORMAT);
    expect(auth.currentUser()?.hasRecoveryKey).toBe(true);
    await expect(auth.issueRecoveryKey({})).rejects.toThrow('Wrong password');
    const second = await auth.issueRecoveryKey({ password: 'correct horse' });
    expect(second.recoveryKey).not.toBe(first.recoveryKey);
  });

  it('resets the password with the key, clears the PIN and spends the key', async () => {
    await auth.register({ username: 'alice', password: 'forgotten' });
    await auth.setPin({ pin: '1234' });
    const { recoveryKey } = await auth.issueRecoveryKey({});
    auth.lock();

    const typedSloppily = recoveryKey.toLowerCase().replace(/-/g, ' ');
    const user = await auth.recover({ username: 'Alice', recoveryKey: typedSloppily, newPassword: 'remembered' });
    expect(user).toMatchObject({ hasPin: false, hasRecoveryKey: false });
    expect(auth.getSession()?.userId).toBe(user.id);

    auth.lock();
    await expect(auth.login({ username: 'alice', password: 'remembered' })).resolves.toBeDefined();
    auth.lock();
    await expect(auth.recover({ username: 'alice', recoveryKey, newPassword: 'again' }))
      .rejects.toThrow("That recovery key doesn't match.");
  });

  it('stops accepting an old key once a new one is issued', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    const { recoveryKey: old } = await auth.issueRecoveryKey({});
    await auth.issueRecoveryKey({ password: 'correct horse' });
    auth.lock();
    await expect(auth.recover({ username: 'alice', recoveryKey: old, newPassword: 'x' }))
      .rejects.toThrow("That recovery key doesn't match.");
  });

  it('answers a wrong key and an unknown user the same way', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    await auth.issueRecoveryKey({});
    auth.lock();
    const wrong = 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA';
    await expect(auth.recover({ username: 'alice', recoveryKey: wrong, newPassword: 'x' }))
      .rejects.toThrow("That recovery key doesn't match.");
    await expect(auth.recover({ username: 'nobody', recoveryKey: wrong, newPassword: 'x' }))
      .rejects.toThrow("That recovery key doesn't match.");
    expect(auth.getSession()).toBeNull();
  });
});
