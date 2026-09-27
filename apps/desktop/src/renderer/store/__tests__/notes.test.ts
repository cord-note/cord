import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { Note, NoteListItem } from '@shared/types';

// The notes list carries metadata only; a note's body is fetched when it is
// opened. The editor must never be handed a note whose body was not fetched —
// it would open empty and the next save would overwrite the real content.

const body = (text: string): string =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const note = (id: string, vaultId: string, text: string): Note => ({
  id, vaultId, title: id, bodyJson: body(text), kind: 'note', isPinned: false,
  createdAt: 1, updatedAt: 1, deletedAt: null,
});

const db = new Map<string, Note>();
const listItem = ({ bodyJson: _body, ...item }: Note): NoteListItem => item;

mock.module('@renderer/ipc', () => ({
  api: {
    notes: {
      list: async (vaultId: string) => [...db.values()].filter((n) => n.vaultId === vaultId).map(listItem),
      get: async (id: string) => db.get(id) ?? null,
      update: async (id: string, input: Partial<Note>) => {
        const updated = { ...db.get(id)!, ...input };
        db.set(id, updated);
        return updated;
      },
    },
  },
}));

const { useNoteStore } = await import('../notes');

/** What the editor would be given right now, or null while it must wait. */
function editorNote(): Note | null {
  const { notes, activeNoteId, activeNoteLoading } = useNoteStore.getState();
  if (activeNoteLoading) return null;
  return notes.find((n) => n.id === activeNoteId) ?? null;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('notes store across vault switches', () => {
  beforeEach(() => {
    db.clear();
    db.set('a', note('a', 'v1', 'alpha content'));
    db.set('b', note('b', 'v2', 'beta content'));
    useNoteStore.getState().reset();
  });

  it('opens a note of the new vault instead of keeping one from the old vault', async () => {
    await useNoteStore.getState().loadNotes('v1');
    await settle();
    expect(editorNote()?.id).toBe('a');

    await useNoteStore.getState().loadNotes('v2');
    await settle();
    expect(useNoteStore.getState().activeNoteId).toBe('b');
    expect(editorNote()?.bodyJson).toBe(body('beta content'));
  });

  it('never hands the editor a placeholder body when switching back', async () => {
    await useNoteStore.getState().loadNotes('v1');
    await settle();
    await useNoteStore.getState().loadNotes('v2');
    await settle();
    await useNoteStore.getState().loadNotes('v1');

    // Whenever the editor may mount, it sees the stored body.
    const seen = editorNote();
    if (seen) expect(seen.bodyJson).toBe(body('alpha content'));
    await settle();
    expect(editorNote()?.bodyJson).toBe(body('alpha content'));
  });

  it('keeps a loaded body when the same vault reloads, without refetching', async () => {
    await useNoteStore.getState().loadNotes('v1');
    await settle();
    await useNoteStore.getState().updateNote('a', { bodyJson: body('edited') });

    await useNoteStore.getState().loadNotes('v1');
    expect(useNoteStore.getState().activeNoteLoading).toBe(false);
    expect(editorNote()?.bodyJson).toBe(body('edited'));
  });

  it('keeps the active note when the vault is left and it is still in the list', async () => {
    await useNoteStore.getState().loadNotes('v1');
    await settle();
    db.set('a2', note('a2', 'v1', 'second'));
    await useNoteStore.getState().setActiveNote('a2');
    await useNoteStore.getState().loadNotes('v1');
    await settle();
    expect(useNoteStore.getState().activeNoteId).toBe('a2');
    expect(editorNote()?.bodyJson).toBe(body('second'));
  });
});
