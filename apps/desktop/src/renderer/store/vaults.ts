import { create } from 'zustand';
import type { Vault, CreateVaultInput } from '@shared/types';
import { api } from '@renderer/ipc';

/**
 * Vault display order lives in localStorage rather than the database.
 * The schema is frozen (see CLAUDE.md), and `vaults` has no sort column, so
 * ordering is a per-device preference for now. If it ever needs to sync,
 * this is the seam to replace with a `sortOrder` column.
 */
const ORDER_KEY = 'cord-vault-order';

function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // Corrupt entry — fall back to server order rather than breaking startup.
    return [];
  }
}

function writeOrder(ids: string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    // Storage full or blocked; order simply won't persist this session.
  }
}

/**
 * Sorts vaults by the stored order. Vaults with no stored position (created on
 * another device, or since the last reorder) keep their server order and sort
 * to the end — `Array.prototype.sort` is stable, so equal ranks don't shuffle.
 */
function applyOrder(vaults: Vault[]): Vault[] {
  const order = readOrder();
  if (order.length === 0) return vaults;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...vaults].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

interface VaultStore {
  vaults: Vault[];
  activeVaultId: string | null;

  setActiveVault: (id: string) => void;
  loadVaults:     () => Promise<void>;
  createVault:    (input: CreateVaultInput) => Promise<Vault>;
  archiveVault:   (id: string) => Promise<void>;
  reorderVaults:  (ids: string[]) => void;
  reset:          () => void;
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaults: [],
  activeVaultId: null,

  setActiveVault: (id) => set({ activeVaultId: id }),

  loadVaults: async () => {
    const vaults = applyOrder(await api.vaults.list());
    set({ vaults });
    const first = vaults[0];
    if (!get().activeVaultId && first) {
      set({ activeVaultId: first.id });
    }
  },

  createVault: async (input) => {
    const vault = await api.vaults.create(input);
    set((s) => {
      const vaults = [...s.vaults, vault];
      // Pin the new vault to the end explicitly, so a later reorder of the
      // others doesn't move it around unexpectedly.
      writeOrder(vaults.map((v) => v.id));
      return { vaults, activeVaultId: vault.id };
    });
    return vault;
  },

  reorderVaults: (ids) => {
    set((s) => {
      const byId = new Map(s.vaults.map((v) => [v.id, v]));
      const next = ids.map((id) => byId.get(id)).filter((v): v is Vault => v !== undefined);
      // Guard against a partial list dropping vaults from the UI.
      if (next.length !== s.vaults.length) return s;
      writeOrder(ids);
      return { vaults: next };
    });
  },

  reset: () => set({ vaults: [], activeVaultId: null }),

  archiveVault: async (id) => {
    await api.vaults.archive(id);
    set((s) => {
      const vaults = s.vaults.filter((v) => v.id !== id);
      const activeVaultId = s.activeVaultId === id ? (vaults[0]?.id ?? null) : s.activeVaultId;
      writeOrder(vaults.map((v) => v.id));
      return { vaults, activeVaultId };
    });
  },
}));
