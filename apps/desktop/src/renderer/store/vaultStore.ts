import { create } from 'zustand';
import type { Vault } from '@shared/types';

interface VaultState {
  vaults: Vault[];
  activeVaultId: string | null;
  setVaults: (vaults: Vault[]) => void;
  setActiveVault: (id: string | null) => void;
  upsertVault: (vault: Vault) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  vaults:        [],
  activeVaultId: null,

  setVaults: (vaults) => set({ vaults }),

  setActiveVault: (id) => set({ activeVaultId: id }),

  upsertVault: (vault) =>
    set((state) => {
      const exists = state.vaults.some((v) => v.id === vault.id);
      return {
        vaults: exists
          ? state.vaults.map((v) => (v.id === vault.id ? vault : v))
          : [...state.vaults, vault],
      };
    }),
}));
