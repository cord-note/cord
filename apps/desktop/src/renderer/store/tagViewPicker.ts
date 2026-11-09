import { create } from 'zustand';

interface PickerStore {
  resolve: ((tagId: string | null) => void) | null;
  /** Opens the picker; resolves with the chosen tag id, or null. */
  request: () => Promise<string | null>;
  answer: (tagId: string | null) => void;
}

export const useTagViewPicker = create<PickerStore>((set, get) => ({
  resolve: null,
  request: () => new Promise((resolve) => {
    get().resolve?.(null); // Only one picker at a time.
    set({ resolve });
  }),
  answer: (tagId) => {
    get().resolve?.(tagId);
    set({ resolve: null });
  },
}));
