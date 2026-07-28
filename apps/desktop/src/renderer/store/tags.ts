import { create } from 'zustand';
import type { Tag, CreateTagInput, NoteTagRow } from '@shared/types';
import { api } from '@renderer/ipc';

interface TagStore {
  tags: Tag[];
  activeTagId: string | null;
  noteTagMap: Record<string, string[]>;

  reset:            () => void;
  loadTags:         (vaultId: string) => Promise<void>;
  createTag:        (input: CreateTagInput) => Promise<Tag>;
  deleteTag:        (tagId: string) => Promise<void>;
  setActiveTag:     (id: string | null) => void;
  reloadNoteTagMap: (vaultId: string) => Promise<void>;
}

export const useTagStore = create<TagStore>((set) => ({
  tags: [],
  activeTagId: null,
  noteTagMap: {},

  reset: () => set({ tags: [], activeTagId: null, noteTagMap: {} }),

  loadTags: async (vaultId) => {
    const [tags, rows] = await Promise.all([
      api.tags.list(vaultId),
      api.tags.getNoteMap(vaultId),
    ]);
    set({ tags, noteTagMap: buildMap(rows) });
  },

  createTag: async (input) => {
    const tag = await api.tags.create(input);
    set((s) => ({ tags: [...s.tags, tag] }));
    return tag;
  },

  deleteTag: async (tagId) => {
    await api.tags.delete(tagId);
    set((s) => {
      const noteTagMap = { ...s.noteTagMap };
      for (const noteId of Object.keys(noteTagMap)) {
        noteTagMap[noteId] = (noteTagMap[noteId] ?? []).filter((id) => id !== tagId);
      }
      return {
        tags: s.tags.filter((t) => t.id !== tagId),
        activeTagId: s.activeTagId === tagId ? null : s.activeTagId,
        noteTagMap,
      };
    });
  },

  setActiveTag: (id) => set({ activeTagId: id }),

  reloadNoteTagMap: async (vaultId) => {
    const rows = await api.tags.getNoteMap(vaultId);
    set({ noteTagMap: buildMap(rows) });
  },
}));

function buildMap(rows: NoteTagRow[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const { noteId, tagId } of rows) {
    if (!map[noteId]) map[noteId] = [];
    map[noteId].push(tagId);
  }
  return map;
}
