import { create } from 'zustand';
import type { User, AuthSession } from '@shared/types';
import { api } from '@renderer/ipc';
import { useVaultStore } from './vaults';
import { useNoteStore } from './notes';
import { useTagStore } from './tags';
import { useUIStore } from './ui';

interface AuthState {
  user:     User | null;
  session:  AuthSession | null;
  checking: boolean;
  hasUsers: boolean;

  check:    () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  login:    (username: string, password: string) => Promise<void>;
  logout:   () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user:     null,
  session:  null,
  checking: true,
  hasUsers: true,

  check: async () => {
    try {
      const [session, { hasUsers }] = await Promise.all([
        api.auth.session(),
        api.auth.hasUsers(),
      ]);
      if (session) {
        set({ session, user: { id: session.userId, username: session.username, createdAt: session.loggedInAt }, hasUsers, checking: false });
      } else {
        set({ session: null, user: null, hasUsers, checking: false });
      }
    } catch {
      set({ checking: false, user: null, session: null });
    }
  },

  register: async (username, password) => {
    const user = await api.auth.register({ username, password });
    const session = await api.auth.session();
    set({ user, session, hasUsers: true });
  },

  login: async (username, password) => {
    const user = await api.auth.login({ username, password });
    const session = await api.auth.session();
    set({ user, session });
  },

  logout: async () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await api.auth.logout();
    useVaultStore.getState().reset();
    useNoteStore.getState().reset();
    useTagStore.getState().reset();
    useUIStore.getState().closeCommands();
    set({ user: null, session: null });
  },
}));
