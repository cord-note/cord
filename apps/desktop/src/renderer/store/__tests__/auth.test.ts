import { describe, it, expect, beforeEach, afterAll, mock, spyOn } from 'bun:test';
import type { AuthUser, LockScreenState, PinUnlockResult } from '@shared/types';
import * as session from '../../settings/session';

// The lock screen is a small state machine: which user is chosen, which view
// shows, and when the workspace opens. Settings are swapped per user, and a
// user's pending edits are flushed before their session ends.

const calls: string[] = [];
const alice: AuthUser = { id: 'a', username: 'alice', createdAt: 1, hasPin: true, hasRecoveryKey: true };
let lockScreen: LockScreenState;
let unlockResult: PinUnlockResult;
let current: AuthUser | null;

mock.module('@renderer/ipc', () => ({
  api: {
    auth: {
      current: async () => current,
      lockScreen: async () => lockScreen,
      unlockPin: async () => { calls.push('unlockPin'); return unlockResult; },
      login: async () => { calls.push('login'); return alice; },
      register: async () => ({ ...alice, id: 'n', username: 'new', hasPin: false, hasRecoveryKey: false }),
      setPin: async () => { calls.push('setPin'); return { ...alice, id: 'n', username: 'new', hasRecoveryKey: false }; },
      issueRecoveryKey: async () => ({ recoveryKey: 'KEY' }),
      recover: async () => ({ ...alice, hasPin: false, hasRecoveryKey: false }),
      lock: async () => { calls.push('lock'); return { ok: true }; },
    },
  },
}));

// Spies, not mock.module: a module mock leaks into every later test file in
// the run (Bun 1.3), which would replace the real session in session.test.ts.
const spies = [
  spyOn(session, 'previewUserSettings').mockImplementation(async (id) => { calls.push(`preview:${id}`); }),
  spyOn(session, 'loadUserSettings').mockImplementation(async (id) => { calls.push(`load:${id}`); }),
  spyOn(session, 'flushUserSettings').mockImplementation(async () => { calls.push('flush'); }),
];
afterAll(() => { for (const spy of spies) spy.mockRestore(); });

const { useAuthStore } = await import('../auth');

function lockScreenWith(users: LockScreenState['users'], lastUserId: string | null): LockScreenState {
  return { users, lastUserId };
}

beforeEach(() => {
  calls.length = 0;
  current = null;
  lockScreen = lockScreenWith(
    [
      { id: 'a', username: 'alice', hasPin: true, pinLocked: false },
      { id: 'b', username: 'bob', hasPin: false, pinLocked: false },
    ],
    'a',
  );
  useAuthStore.setState({ user: null, pendingUser: null, recoveryKey: null, notice: null, checking: true });
});

describe('auth store', () => {
  it('preselects the last user and asks for their PIN', async () => {
    await useAuthStore.getState().check();
    expect(useAuthStore.getState()).toMatchObject({ checking: false, selectedUserId: 'a', view: 'pin' });
    expect(calls).toEqual(['preview:a']);
  });

  it('asks for the password when the user has no PIN, and registration when nobody exists', async () => {
    await useAuthStore.getState().check();
    await useAuthStore.getState().selectUser('b');
    expect(useAuthStore.getState().view).toBe('password');

    lockScreen = lockScreenWith([], null);
    await useAuthStore.getState().check();
    expect(useAuthStore.getState()).toMatchObject({ selectedUserId: null, view: 'register' });
  });

  it('opens the workspace after the right PIN', async () => {
    await useAuthStore.getState().check();
    unlockResult = { ok: true, user: alice };
    await useAuthStore.getState().unlockWithPin('1234');
    expect(useAuthStore.getState().user).toEqual(alice);
    expect(calls).toContain('load:a');
  });

  it('moves to the password after the last wrong PIN', async () => {
    await useAuthStore.getState().check();
    unlockResult = { ok: false, triesLeft: 2 };
    expect(await useAuthStore.getState().unlockWithPin('0000')).toEqual({ ok: false, triesLeft: 2 });
    expect(useAuthStore.getState().view).toBe('pin');

    unlockResult = { ok: false, triesLeft: 0 };
    await useAuthStore.getState().unlockWithPin('0000');
    expect(useAuthStore.getState()).toMatchObject({ view: 'password', user: null });
    expect(useAuthStore.getState().notice).toContain('Too many wrong PINs');
  });

  it('walks a new user through PIN and recovery key before the workspace', async () => {
    await useAuthStore.getState().check();
    await useAuthStore.getState().register('new', 'password');
    expect(useAuthStore.getState()).toMatchObject({ view: 'setPin', user: null });

    await useAuthStore.getState().setPin('1234');
    expect(useAuthStore.getState()).toMatchObject({ view: 'recoveryKey', recoveryKey: 'KEY', user: null });

    await useAuthStore.getState().finishSetup();
    expect(useAuthStore.getState()).toMatchObject({ recoveryKey: null, user: { id: 'n' } });
    expect(calls).toContain('load:n');
  });

  it('continues setup with a new PIN after a recovery-key reset', async () => {
    await useAuthStore.getState().check();
    await useAuthStore.getState().recover('alice', 'KEY', 'new password');
    expect(useAuthStore.getState()).toMatchObject({ view: 'setPin', user: null });
  });

  it('flushes settings before locking, then returns to the same user’s PIN', async () => {
    await useAuthStore.getState().check();
    unlockResult = { ok: true, user: alice };
    await useAuthStore.getState().unlockWithPin('1234');
    calls.length = 0;

    await useAuthStore.getState().lock();

    expect(calls.slice(0, 2)).toEqual(['flush', 'lock']);
    expect(useAuthStore.getState()).toMatchObject({ user: null, selectedUserId: 'a', view: 'pin' });
  });

  it('resumes an existing session (webview reload during development)', async () => {
    current = alice;
    await useAuthStore.getState().check();
    expect(useAuthStore.getState().user).toEqual(alice);
    expect(calls).toContain('load:a');
  });
});
