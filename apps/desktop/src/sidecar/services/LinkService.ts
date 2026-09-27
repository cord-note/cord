import { nanoid } from 'nanoid';
import { and, eq, inArray } from 'drizzle-orm';
import type { getDb } from '../db/client';
import { noteLinks, notes } from '../db/schema';
import { logOp } from './oplog';
import type { NoteLink } from '@shared/types';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export class LinkService {
  /**
   * Make the links from `noteId` match the wiki links in its saved document.
   * `note_links` is derived data: body_json is the source of truth, so links
   * to itself, to missing notes or to other vaults are never created.
   */
  syncFromDocument(tx: Tx, noteId: string, vaultId: string, targetIds: readonly string[]): void {
    const wanted = [...new Set(targetIds.filter((id) => id !== noteId))];
    const valid = new Set(wanted.length === 0 ? [] : tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(inArray(notes.id, wanted), eq(notes.vaultId, vaultId)))
      .all()
      .map((r) => r.id));

    const existing = tx.select().from(noteLinks).where(eq(noteLinks.fromNoteId, noteId)).all();
    const existingTo = new Set(existing.map((l) => l.toNoteId));

    for (const link of existing) {
      if (valid.has(link.toNoteId)) continue;
      tx.delete(noteLinks).where(eq(noteLinks.id, link.id)).run();
      logOp(tx, vaultId, 'link', link.id, 'delete', link);
    }

    for (const toNoteId of valid) {
      if (existingTo.has(toNoteId)) continue;
      const link: NoteLink = { id: nanoid(), fromNoteId: noteId, toNoteId, createdAt: Date.now() };
      tx.insert(noteLinks).values(link).run();
      logOp(tx, vaultId, 'link', link.id, 'create', link);
    }
  }
}
