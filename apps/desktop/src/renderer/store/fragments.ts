import { create } from 'zustand';
import type { FragmentAnnotationMap, CreateFragmentLinkInput, FragmentLink } from '@shared/types';
import { api } from '@renderer/ipc';

interface FragmentStore {
  annotations:     FragmentAnnotationMap;
  pendingScroll:   string | null;

  loadForNote:     (noteId: string) => Promise<void>;
  attachTag:       (blockId: string, noteId: string, vaultId: string, tagId: string) => Promise<void>;
  detachTag:       (blockId: string, tagId: string) => Promise<void>;
  createLink:      (input: CreateFragmentLinkInput) => Promise<FragmentLink>;
  deleteLink:      (linkId: string) => Promise<void>;
  setPendingScroll:(id: string | null) => void;
  reset:           () => void;
}

export const useFragmentStore = create<FragmentStore>((set, get) => ({
  annotations:   {},
  pendingScroll: null,

  reset: () => set({ annotations: {}, pendingScroll: null }),

  loadForNote: async (noteId) => {
    const annotations = await api.fragments.getForNote(noteId);
    set({ annotations });
  },

  attachTag: async (blockId, noteId, vaultId, tagId) => {
    await api.fragments.attachTag(blockId, noteId, vaultId, tagId);
    const annotations = await api.fragments.getForNote(noteId);
    set({ annotations });
  },

  detachTag: async (blockId, tagId) => {
    await api.fragments.detachTag(blockId, tagId);
    set((s) => {
      const annotations = { ...s.annotations };
      if (annotations[blockId]) {
        annotations[blockId] = {
          ...annotations[blockId],
          tags: annotations[blockId].tags.filter((t) => t.id !== tagId),
        };
      }
      return { annotations };
    });
  },

  createLink: async (input) => {
    return await api.fragments.createLink(input);
  },

  deleteLink: async (linkId) => {
    await api.fragments.deleteLink(linkId);
  },

  setPendingScroll: (id) => set({ pendingScroll: id }),
}));
