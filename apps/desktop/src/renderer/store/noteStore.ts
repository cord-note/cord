import { create } from 'zustand';
import type { NoteListItem } from '@shared/types';

interface NoteState {
  notes: NoteListItem[];
  activeNoteId: string | null;
  setNotes: (notes: NoteListItem[]) => void;
  setActiveNote: (id: string | null) => void;
  upsertNote: (note: NoteListItem) => void;
  removeNote: (id: string) => void;
}

export const useNoteStore = create<NoteState>((set) => ({
  notes:        [],
  activeNoteId: null,

  setNotes: (notes) => set({ notes }),

  setActiveNote: (id) => set({ activeNoteId: id }),

  upsertNote: (note) =>
    set((state) => {
      const exists = state.notes.some((n) => n.id === note.id);
      return {
        notes: exists
          ? state.notes.map((n) => (n.id === note.id ? note : n))
          : [...state.notes, note],
      };
    }),

  removeNote: (id) =>
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) })),
}));
