import { create } from 'zustand';

/** Bumped after any field or value write, so every view of the data reloads. */
export const useFieldsVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
