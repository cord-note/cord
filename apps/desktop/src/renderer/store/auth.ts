import { create } from 'zustand';
import type { AuthUser, LockScreenState, PinUnlockResult } from '@shared/types';
import { api } from '@renderer/ipc';
import { log } from '../lib/log';
import { flushUserSettings, loadUserSettings, previewUserSettings } from '../settings/session';
import { useVaultStore } from './vaults';
import { useNoteStore } from './notes';
import { useTagStore } from './tags';
import { useUIStore } from './ui';

/**
 * What the lock screen shows. `setPin` and `recoveryKey` are setup steps
 * taken after signing in and before the workspace opens.
 */
export type AuthView = 'pin' | 'password' | 'forgotPin' | 'register' | 'recover' | 'setPin' | 'recoveryKey';

interface AuthState {
  /** Signed in and set up: the workspace is showing. */
  user: AuthUser | null;
  checking: boolean;
  lockScreen: LockScreenState;
  selectedUserId: string | null;
  view: AuthView;
  /** Signed in, still finishing setup. */
  pendingUser: AuthUser | null;
  /** Shown once on the recovery-key step, then dropped. */
  recoveryKey: string | null;
  /** Why the view changed on its own, e.g. after too many wrong PINs. */
  notice: string | null;

  check: () => Promise<void>;
  selectUser: (userId: string | null) => Promise<void>;
  setView: (view: AuthView) => void;
  unlockWithPin: (pin: string) => Promise<PinUnlockResult>;
  login: (username: string, password: string) => Promise<void>;
  /** Forgot PIN: prove it with the password and choose a new PIN in one go. */
  forgotPin: (username: string, password: string, pin: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  recover: (username: string, recoveryKey: string, newPassword: string) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  finishSetup: () => Promise<void>;
  lock: () => Promise<void>;
}

const EMPTY_LOCK_SCREEN: LockScreenState = { users: [], lastUserId: null };

/** The view a chosen user starts on. */
function entryView(lockScreen: LockScreenState, userId: string | null): AuthView {
  const user = lockScreen.users.find((u) => u.id === userId);
  if (!user) return 'register';
  return user.hasPin && !user.pinLocked ? 'pin' : 'password';
}

export const useAuthStore = create<AuthState>((set, get) => {
  /** Signed in: finish any setup step still owed, then open the workspace. */
  async function signedIn(user: AuthUser): Promise<void> {
    if (!user.hasPin) {
      set({ pendingUser: user, view: 'setPin', notice: null });
      return;
    }
    if (!user.hasRecoveryKey) {
      const { recoveryKey } = await api.auth.issueRecoveryKey({});
      set({ pendingUser: { ...user, hasRecoveryKey: true }, recoveryKey, view: 'recoveryKey', notice: null });
      return;
    }
    await loadUserSettings(user.id);
    set({ user, pendingUser: null, recoveryKey: null, notice: null });
  }

  return {
    user:           null,
    checking:       true,
    lockScreen:     EMPTY_LOCK_SCREEN,
    selectedUserId: null,
    view:           'register',
    pendingUser:    null,
    recoveryKey:    null,
    notice:         null,

    check: async () => {
      try {
        const [current, lockScreen] = await Promise.all([api.auth.current(), api.auth.lockScreen()]);
        set({ lockScreen });
        if (current) {
          set({ selectedUserId: current.id });
          await signedIn(current);
        } else {
          await get().selectUser(lockScreen.lastUserId ?? lockScreen.users[0]?.id ?? null);
        }
      } catch (err) {
        log('error', 'auth', 'Could not load the lock screen', err);
      } finally {
        set({ checking: false });
      }
    },

    selectUser: async (userId) => {
      set({ selectedUserId: userId, view: entryView(get().lockScreen, userId), notice: null });
      await previewUserSettings(userId);
    },

    setView: (view) => set({ view, notice: null }),

    unlockWithPin: async (pin) => {
      const userId = get().selectedUserId;
      if (!userId) throw new Error('Choose a user first');
      const result = await api.auth.unlockPin({ userId, pin });
      if (result.ok) {
        await signedIn(result.user);
      } else if (result.triesLeft === 0) {
        set({
          lockScreen: await api.auth.lockScreen(),
          view: 'password',
          notice: 'Too many wrong PINs. Enter your password.',
        });
      }
      return result;
    },

    login: async (username, password) => {
      await signedIn(await api.auth.login({ username, password }));
    },

    forgotPin: async (username, password, pin) => {
      await api.auth.login({ username, password });
      await signedIn(await api.auth.setPin({ pin, password }));
    },

    register: async (username, password) => {
      await signedIn(await api.auth.register({ username, password }));
    },

    recover: async (username, recoveryKey, newPassword) => {
      await signedIn(await api.auth.recover({ username, recoveryKey, newPassword }));
    },

    setPin: async (pin) => {
      await signedIn(await api.auth.setPin({ pin }));
    },

    finishSetup: async () => {
      const pending = get().pendingUser;
      if (pending) await signedIn(pending);
    },

    lock: async () => {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // Pending settings edits go to this user's files before the session ends.
      await flushUserSettings();
      await api.auth.lock();
      useVaultStore.getState().reset();
      useNoteStore.getState().reset();
      useTagStore.getState().reset();
      useUIStore.getState().closeCommands();

      const lockScreen = await api.auth.lockScreen();
      set({ user: null, pendingUser: null, recoveryKey: null, lockScreen });
      await get().selectUser(lockScreen.lastUserId ?? lockScreen.users[0]?.id ?? null);
    },
  };
});
