import { create } from 'zustand';
import type {
  Note, NoteListItem, NoteLink, NoteKind,
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
  convertNote:          (id: string, kind: NoteKind) => Promise<Note>;
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
  return { ...item, bodyJson: '{}' };
}

/**
 * Ids of notes whose `bodyJson` is the stored body rather than toNote's
 * placeholder. The list carries metadata only, so a note's body exists here
 * only once it was fetched or returned by a write. The editor must never be
 * given a placeholder: it would open empty, and its next save would overwrite
 * the real content.
 */
const loadedBodies = new Set<string>();

/** Whether note `id` holds its stored body, so the editor may open it. */
export function isNoteBodyLoaded(id: string): boolean {
  return loadedBodies.has(id);
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

  reset: () => { loadedBodies.clear(); set({
    notes: [], activeNoteId: null, activeNoteLoading: false, trashedNotes: [],
    backlinks: [], outboundLinks: [], activeNoteTags: [],
    searchQuery: '', searchResults: null, unlinkedMentions: [],
  }); },

  loadNotes: async (vaultId) => {
    const items = await api.notes.list(vaultId);
    const previous = new Map(get().notes.map((n) => [n.id, n]));
    // Keep bodies already fetched; everything else is a placeholder, and only
    // the bodies actually carried over count as loaded.
    const kept = new Set<string>();
    const notes = items.map((item) => {
      const known = previous.get(item.id);
      if (!known || !loadedBodies.has(item.id)) return toNote(item);
      kept.add(item.id);
      return { ...toNote(item), bodyJson: known.bodyJson };
    });
    loadedBodies.clear();
    for (const id of kept) loadedBodies.add(id);
    const listed = new Set(notes.map((n) => n.id));

    // The open note stays open if it belongs to this vault; otherwise the
    // vault's first note opens. A note switched to from another vault is
    // never left selected with nothing shown, and never shown unfetched.
    const current = get().activeNoteId;
    const target = current && listed.has(current) ? current : (notes[0]?.id ?? null);
    if (target && target === current && loadedBodies.has(target)) {
      set({ notes });
      return;
    }
    // One update, so no render sees the new list without the loading flag.
    set({ notes, activeNoteId: target, activeNoteLoading: target !== null });
    await get().setActiveNote(target);
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
        loadedBodies.add(id);
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id
              ? { ...n, bodyJson: fullNote.bodyJson, kind: fullNote.kind }
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
    loadedBodies.add(note.id);
    set((s) => ({
      notes: [note, ...s.notes],
      activeNoteId: note.id,
      activeNoteLoading: false,
    }));
    return note;
  },

  updateNote: async (id, input) => {
    const note = await api.notes.update(id, input);
    loadedBodies.add(id);
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, ...note } : n)),
    }));
    return note;
  },

  convertNote: async (id, kind) => {
    const note = await api.notes.convert(id, kind);
    loadedBodies.add(id);
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
    loadedBodies.delete(id);
    if (newActiveId && newActiveId !== activeNoteId) {
      // Loading in the same update: the next note's body is not fetched yet.
      set({ notes: remaining, activeNoteId: newActiveId, activeNoteLoading: true });
      await get().setActiveNote(newActiveId);
    } else {
      set({ notes: remaining, activeNoteId: newActiveId });
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
