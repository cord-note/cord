import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { tags, noteTags, notes } from '../db/schema';
import { logOp } from './oplog';
import type { Tag, CreateTagInput, NoteTagRow } from '@shared/types';

export class TagService {
  list(vaultId: string): Tag[] {
    const db = getDb();
    return db.select().from(tags).where(eq(tags.vaultId, vaultId)).all().map(toTag);
  }

  create(input: CreateTagInput): Tag {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();

    return db.transaction((tx) => {
      tx.insert(tags).values({
        id,
        vaultId:   input.vaultId,
        name:      input.name,
        color:     input.color ?? null,
        createdAt: now,
      }).run();

      const row = tx.select().from(tags).where(eq(tags.id, id)).get();
      if (!row) throw new Error(`Tag not found after insert: ${id}`);
      const tag = toTag(row);

      logOp(tx, input.vaultId, 'tag', id, 'create', tag);
      return tag;
    });
  }

  delete(tagId: string): void {
    const db = getDb();
    const row = db.select().from(tags).where(eq(tags.id, tagId)).get();
    if (!row) throw new Error(`Tag not found: ${tagId}`);

    db.transaction((tx) => {
      tx.delete(noteTags).where(eq(noteTags.tagId, tagId)).run();
      tx.delete(tags).where(eq(tags.id, tagId)).run();
      logOp(tx, row.vaultId, 'tag', tagId, 'delete', toTag(row));
    });
  }

  attach(noteId: string, tagId: string): void {
    const db = getDb();
    db.insert(noteTags)
      .values({ noteId, tagId, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
  }

  detach(noteId: string, tagId: string): void {
    const db = getDb();
    db.delete(noteTags)
      .where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId)))
      .run();
  }

  getForNote(noteId: string): Tag[] {
    const db = getDb();
    return db
      .select({ tag: tags })
      .from(noteTags)
      .innerJoin(tags, eq(noteTags.tagId, tags.id))
      .where(eq(noteTags.noteId, noteId))
      .all()
      .map((r) => toTag(r.tag));
  }

  getNoteMap(vaultId: string): NoteTagRow[] {
    const db = getDb();
    return db
      .select({ noteId: noteTags.noteId, tagId: noteTags.tagId })
      .from(noteTags)
      .innerJoin(notes, eq(noteTags.noteId, notes.id))
      .where(eq(notes.vaultId, vaultId))
      .all();
  }
}

function toTag(row: typeof tags.$inferSelect): Tag {
  return {
    id:        row.id,
    vaultId:   row.vaultId,
    name:      row.name,
    color:     row.color,
    createdAt: row.createdAt,
  };
}
