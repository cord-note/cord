import { nanoid } from 'nanoid';
import { and, eq, isNotNull, isNull, like, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { notes, noteLinks } from '../db/schema';
import { logOp } from './oplog';
import type {
  Note,
  NoteListItem,
  NoteLinks,
  CreateNoteInput,
  UpdateNoteInput,
  UnlinkedMention,
} from '@shared/types';

export class NoteService {
  list(vaultId: string): NoteListItem[] {
    const db = getDb();
    return db
      .select({
        id:        notes.id,
        vaultId:   notes.vaultId,
        title:     notes.title,
        isPinned:  notes.isPinned,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
        deletedAt: notes.deletedAt,
      })
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), isNull(notes.deletedAt)))
      .orderBy(notes.updatedAt)
      .all();
  }

  listDeleted(vaultId: string): NoteListItem[] {
    const db = getDb();
    return db
      .select({
        id:        notes.id,
        vaultId:   notes.vaultId,
        title:     notes.title,
        isPinned:  notes.isPinned,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
        deletedAt: notes.deletedAt,
      })
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), isNotNull(notes.deletedAt)))
      .orderBy(notes.deletedAt)
      .all();
  }

  get(id: string): Note | null {
    const db = getDb();
    const row = db.select().from(notes).where(eq(notes.id, id)).get();
    return row ? toNote(row) : null;
  }

  create(input: CreateNoteInput): Note {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();

    return db.transaction((tx) => {
      tx.insert(notes).values({
        id,
        vaultId:      input.vaultId,
        title:        input.title        ?? '',
        bodyJson:     input.bodyJson     ?? '{}',
        bodyMarkdown: input.bodyMarkdown ?? '',
        isPinned:     false,
        createdAt:    now,
        updatedAt:    now,
      }).run();

      const row = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (!row) throw new Error(`Note not found after insert: ${id}`);
      const note = toNote(row);

      logOp(tx, input.vaultId, 'note', id, 'create', note);
      return note;
    });
  }

  update(id: string, input: UpdateNoteInput): Note {
    const db = getDb();
    const now = Date.now();

    return db.transaction((tx) => {
      tx.update(notes)
        .set({
          ...(input.title        !== undefined && { title:        input.title }),
          ...(input.bodyJson     !== undefined && { bodyJson:     input.bodyJson }),
          ...(input.bodyMarkdown !== undefined && { bodyMarkdown: input.bodyMarkdown }),
          ...(input.isPinned     !== undefined && { isPinned:     input.isPinned }),
          updatedAt: now,
        })
        .where(eq(notes.id, id))
        .run();

      const row = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (!row) throw new Error(`Note not found: ${id}`);
      const note = toNote(row);

      logOp(tx, note.vaultId, 'note', id, 'update', note);
      return note;
    });
  }

  // Soft delete — sets deleted_at.
  delete(id: string): void {
    const db = getDb();
    const now = Date.now();

    db.transaction((tx) => {
      const row = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (!row) throw new Error(`Note not found: ${id}`);

      tx.update(notes)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(notes.id, id))
        .run();

      logOp(tx, row.vaultId, 'note', id, 'delete', { ...toNote(row), deletedAt: now });
    });
  }

  restore(id: string): Note {
    const db = getDb();
    const now = Date.now();

    return db.transaction((tx) => {
      tx.update(notes)
        .set({ deletedAt: null, updatedAt: now })
        .where(eq(notes.id, id))
        .run();

      const row = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (!row) throw new Error(`Note not found: ${id}`);
      const note = toNote(row);

      logOp(tx, note.vaultId, 'note', id, 'update', note);
      return note;
    });
  }

  // Hard delete allowed only for already-soft-deleted notes (trash purge).
  permanentDelete(id: string): void {
    const db = getDb();
    const row = db.select().from(notes).where(eq(notes.id, id)).get();
    if (!row?.deletedAt) throw new Error(`Note must be soft-deleted before permanent delete: ${id}`);
    db.delete(notes).where(eq(notes.id, id)).run();
  }

  getLinks(id: string): NoteLinks {
    const db = getDb();
    const outbound = db
      .select()
      .from(noteLinks)
      .where(eq(noteLinks.fromNoteId, id))
      .all()
      .map(toNoteLink);
    const backlinks = db
      .select()
      .from(noteLinks)
      .where(eq(noteLinks.toNoteId, id))
      .all()
      .map(toNoteLink);
    return { outbound, backlinks };
  }

  search(vaultId: string, query: string): NoteListItem[] {
    const db = getDb();
    const pattern = `%${query}%`;
    return db
      .select({
        id:        notes.id,
        vaultId:   notes.vaultId,
        title:     notes.title,
        isPinned:  notes.isPinned,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
        deletedAt: notes.deletedAt,
      })
      .from(notes)
      .where(
        and(
          eq(notes.vaultId, vaultId),
          isNull(notes.deletedAt),
          or(like(notes.title, pattern), like(notes.bodyMarkdown, pattern)),
        ),
      )
      .all();
  }

  findUnlinkedMentions(noteId: string, vaultId: string): UnlinkedMention[] {
    const db = getDb();
    const target = db.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!target || !target.title) return [];

    const pattern = `%${target.title}%`;
    const candidates = db
      .select({ id: notes.id, title: notes.title, bodyMarkdown: notes.bodyMarkdown })
      .from(notes)
      .where(
        and(
          eq(notes.vaultId, vaultId),
          isNull(notes.deletedAt),
          like(notes.bodyMarkdown, pattern),
        ),
      )
      .all();

    return candidates
      .filter((c) => c.id !== noteId)
      .map((c) => {
        const idx = c.bodyMarkdown.toLowerCase().indexOf(target.title.toLowerCase());
        const start = Math.max(0, idx - 40);
        const excerpt = c.bodyMarkdown.slice(start, idx + target.title.length + 40);
        return { noteId: c.id, noteTitle: c.title, excerpt };
      });
  }
}

function toNote(row: typeof notes.$inferSelect): Note {
  return {
    id:           row.id,
    vaultId:      row.vaultId,
    title:        row.title,
    bodyJson:     row.bodyJson,
    bodyMarkdown: row.bodyMarkdown,
    isPinned:     row.isPinned,
    createdAt:    row.createdAt,
    updatedAt:    row.updatedAt,
    deletedAt:    row.deletedAt,
  };
}

function toNoteLink(row: typeof noteLinks.$inferSelect) {
  return {
    id:         row.id,
    fromNoteId: row.fromNoteId,
    toNoteId:   row.toNoteId,
    createdAt:  row.createdAt,
  };
}
