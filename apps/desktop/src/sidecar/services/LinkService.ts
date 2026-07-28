import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { noteLinks, notes } from '../db/schema';
import { logOp } from './oplog';
import type { NoteLink } from '@shared/types';

export class LinkService {
  create(fromNoteId: string, toNoteId: string): NoteLink {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();

    const fromNote = db.select({ vaultId: notes.vaultId }).from(notes).where(eq(notes.id, fromNoteId)).get();
    if (!fromNote) throw new Error(`Note not found: ${fromNoteId}`);

    return db.transaction((tx) => {
      tx.insert(noteLinks).values({ id, fromNoteId, toNoteId, createdAt: now }).run();

      const link: NoteLink = { id, fromNoteId, toNoteId, createdAt: now };
      logOp(tx, fromNote.vaultId, 'link', id, 'create', link);
      return link;
    });
  }

  delete(fromNoteId: string, toNoteId: string): void {
    const db = getDb();
    const fromNote = db.select({ vaultId: notes.vaultId }).from(notes).where(eq(notes.id, fromNoteId)).get();
    if (!fromNote) throw new Error(`Note not found: ${fromNoteId}`);

    const link = db
      .select()
      .from(noteLinks)
      .where(and(eq(noteLinks.fromNoteId, fromNoteId), eq(noteLinks.toNoteId, toNoteId)))
      .get();

    if (!link) return; // idempotent

    db.transaction((tx) => {
      tx.delete(noteLinks)
        .where(and(eq(noteLinks.fromNoteId, fromNoteId), eq(noteLinks.toNoteId, toNoteId)))
        .run();
      logOp(tx, fromNote.vaultId, 'link', link.id, 'delete', link);
    });
  }
}
