import { create } from 'zustand';
import type {
  Note, NoteListItem, NoteLink,
  CreateNoteInput, UpdateNoteInput,
  Tag, UnlinkedMention,
} from '@shared/types';
import { api } from '@renderer/ipc';
import { useTagStore } from './tags';

interface NoteStore {
  notes:            Note[];
  activeNoteId:     string | null;
  // True while the active note's body is being fetched. This cannot be
  // inferred from bodyJson — a brand-new note's real body is '{}' (the column
  // default), so treating that value as "not loaded yet" hangs forever.
  activeNoteLoading: boolean;
  trashedNotes:     Note[];
  backlinks:        NoteLink[];
  outboundLinks:    NoteLink[];
  activeNoteTags:   Tag[];
  searchQuery:      string;
  searchResults:    Note[] | null;
  unlinkedMentions: UnlinkedMention[];

  reset:                () => void;
  loadNotes:            (vaultId: string) => Promise<void>;
  loadTrashed:          (vaultId: string) => Promise<void>;
  setActiveNote:        (id: string | null) => Promise<void>;
  createNote:           (input: CreateNoteInput) => Promise<Note>;
  updateNote:           (id: string, input: UpdateNoteInput) => Promise<Note>;
  deleteNote:           (id: string) => Promise<void>;
  restoreNote:          (id: string) => Promise<Note>;
  permanentDeleteNote:  (id: string) => Promise<void>;
  loadLinks:            (noteId: string) => Promise<void>;
  loadNoteTags:         (noteId: string) => Promise<void>;
  attachTag:            (noteId: string, tagId: string) => Promise<void>;
  detachTag:            (noteId: string, tagId: string) => Promise<void>;
  setSearchQuery:       (q: string) => void;
  searchNotes:          (vaultId: string, query: string) => Promise<void>;
  clearSearch:          () => void;
  loadUnlinkedMentions: (noteId: string, vaultId: string) => Promise<void>;
}

function toNote(item: NoteListItem): Note {
  return { ...item, bodyJson: '{}', bodyMarkdown: '' };
}

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes:             [],
  activeNoteId:      null,
  activeNoteLoading: false,
  trashedNotes:     [],
  backlinks:        [],
  outboundLinks:    [],
  activeNoteTags:   [],
  searchQuery:      '',
  searchResults:    null,
  unlinkedMentions: [],

  reset: () => set({
    notes: [], activeNoteId: null, activeNoteLoading: false, trashedNotes: [],
    backlinks: [], outboundLinks: [], activeNoteTags: [],
    searchQuery: '', searchResults: null, unlinkedMentions: [],
  }),

  loadNotes: async (vaultId) => {
    const items = await api.notes.list(vaultId);
    const notes = items.map(toNote);
    set({ notes });
    const first = notes[0];
    if (first && !get().activeNoteId) {
      get().setActiveNote(first.id);
    }
  },

  loadTrashed: async (vaultId) => {
    const items = await api.notes.listDeleted(vaultId);
    set({ trashedNotes: items.map(toNote) });
  },

  setActiveNote: async (id) => {
    if (!id) {
      set({
        activeNoteId: null, activeNoteLoading: false,
        backlinks: [], outboundLinks: [], activeNoteTags: [],
      });
      return;
    }
    set({
      activeNoteId: id, activeNoteLoading: true,
      backlinks: [], outboundLinks: [], activeNoteTags: [],
    });

    try {
      const fullNote = await api.notes.get(id);
      // A newer selection superseded this one — it now owns the loading flag.
      if (get().activeNoteId !== id) return;
      if (fullNote) {
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id
              ? { ...n, bodyJson: fullNote.bodyJson, bodyMarkdown: fullNote.bodyMarkdown }
              : n,
          ),
        }));
      }
      set({ activeNoteLoading: false });
    } catch {
      // Never strand the editor on a spinner if the fetch fails.
      if (get().activeNoteId === id) set({ activeNoteLoading: false });
    }
  },

  createNote: async (input) => {
    // The create response carries the full row, so there is no body to fetch.
    const note = await api.notes.create(input);
    set((s) => ({
      notes: [note, ...s.notes],
      activeNoteId: note.id,
      activeNoteLoading: false,
    }));
    return note;
  },

  updateNote: async (id, input) => {
    const note = await api.notes.update(id, input);
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, ...note } : n)),
    }));
    return note;
  },

  deleteNote: async (id) => {
    await api.notes.delete(id);
    const { activeNoteId, notes } = get();
    const remaining = notes.filter((n) => n.id !== id);
    const newActiveId = activeNoteId === id ? (remaining[0]?.id ?? null) : activeNoteId;
    set({ notes: remaining, activeNoteId: newActiveId });
    if (newActiveId && newActiveId !== activeNoteId) {
      get().setActiveNote(newActiveId);
    }
  },

  restoreNote: async (id) => {
    const note = await api.notes.restore(id);
    set((s) => ({ trashedNotes: s.trashedNotes.filter((n) => n.id !== id) }));
    return note;
  },

  permanentDeleteNote: async (id) => {
    await api.notes.permanentDelete(id);
    set((s) => ({
      trashedNotes: s.trashedNotes.filter((n) => n.id !== id),
    }));
  },

  loadLinks: async (noteId) => {
    const links = await api.notes.getLinks(noteId);
    set({ backlinks: links.backlinks, outboundLinks: links.outbound });
  },

  loadNoteTags: async (noteId) => {
    const activeNoteTags = await api.tags.getForNote(noteId);
    set({ activeNoteTags });
  },

  attachTag: async (noteId, tagId) => {
    await api.tags.attach(noteId, tagId);
    const vaultId = get().notes.find((n) => n.id === noteId)?.vaultId;
    if (vaultId) await useTagStore.getState().reloadNoteTagMap(vaultId);
    const activeNoteTags = await api.tags.getForNote(noteId);
    set({ activeNoteTags });
  },

  detachTag: async (noteId, tagId) => {
    await api.tags.detach(noteId, tagId);
    const vaultId = get().notes.find((n) => n.id === noteId)?.vaultId;
    if (vaultId) await useTagStore.getState().reloadNoteTagMap(vaultId);
    set((s) => ({ activeNoteTags: s.activeNoteTags.filter((t) => t.id !== tagId) }));
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  searchNotes: async (vaultId, query) => {
    if (!query.trim()) { set({ searchResults: null }); return; }
    const items = await api.notes.search(vaultId, query);
    set({ searchResults: items.map(toNote) });
  },

  clearSearch: () => set({ searchQuery: '', searchResults: null }),

  loadUnlinkedMentions: async (noteId, vaultId) => {
    try {
      const unlinkedMentions = await api.notes.unlinkedMentions(noteId, vaultId);
      set({ unlinkedMentions });
    } catch {
      set({ unlinkedMentions: [] });
    }
  },
}));
