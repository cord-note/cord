import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { AgentActivity, AgentsState, UpdateAgentsInput } from '@shared/types';
import { api } from '../ipc';
import { log } from '../lib/log';

interface AgentsStore {
  state: AgentsState | null;
  activity: AgentActivity[];
  /** When the last agent call arrived, so the sidebar can flash. */
  lastCallAt: number;
  load: () => Promise<void>;
  update: (patch: Partial<UpdateAgentsInput>) => Promise<void>;
  /** Follows the server's status and agent calls; returns the stop function. */
  follow: () => () => void;
}

export const useAgentsStore = create<AgentsStore>((set, get) => ({
  state: null,
  activity: [],
  lastCallAt: 0,

  load: async () => {
    try {
      const [state, activity] = await Promise.all([api.agents.get(), api.agents.activity()]);
      set({ state, activity });
    } catch (e) {
      log('warn', 'agents', 'Loading agent settings failed', { error: String(e) });
    }
  },

  update: async (patch) => {
    const cur = get().state;
    if (!cur) return;
    const next = { allow: cur.allow, edit: cur.edit, vaults: cur.vaults, ...patch };
    set({ state: { ...cur, ...next } }); // Show the change at once.
    try {
      set({ state: await api.agents.update(next) });
    } catch (e) {
      log('error', 'agents', 'Saving agent settings failed', { error: String(e) });
      set({ state: cur });
    }
  },

  follow: () => {
    const stops: (() => void)[] = [];
    let stopped = false;
    const keep = (p: Promise<() => void>): void => {
      void p.then((un) => { if (stopped) un(); else stops.push(un); });
    };
    keep(listen<{ port: number | null }>('agents-status', (e) => {
      const cur = get().state;
      if (cur) set({ state: { ...cur, port: e.payload.port } });
    }));
    // The event has no note title, so reload the list (it resolves titles).
    keep(listen('agent-activity', () => {
      set({ lastCallAt: Date.now() });
      void api.agents.activity().then((activity) => set({ activity })).catch(() => undefined);
    }));
    void get().load();
    return () => { stopped = true; stops.forEach((un) => un()); };
  },
}));
