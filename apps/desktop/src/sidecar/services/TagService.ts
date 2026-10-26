import { nanoid } from 'nanoid';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { tags, noteTags, notes } from '../db/schema';
import { logOp } from './oplog';
import { DISTINCT_VAULT_COLORS } from '@shared/constants/vaultColors';
import type { Tag, CreateTagInput, UpdateTagInput, NoteTagRow } from '@shared/types';

type TagRow = typeof tags.$inferSelect;

export class TagService {
  list(vaultId: string): Tag[] {
    const db = getDb();
    return db.select().from(tags)
      .where(and(eq(tags.vaultId, vaultId), isNull(tags.deletedAt)))
      .all()
      .map(toTag);
  }

  /** Creates a tag, or returns the live one with that name, or restores a deleted one. */
  create(input: CreateTagInput): Tag {
    const db = getDb();
    const name = cleanName(input.name);
    const now = Date.now();

    return db.transaction((tx) => {
      const existing = tx.select().from(tags)
        .where(and(eq(tags.vaultId, input.vaultId), eq(tags.name, name)))
        .get();

      if (existing && existing.deletedAt === null) return toTag(existing);

      if (existing) {
        tx.update(tags)
          .set({ deletedAt: null, color: input.color ?? existing.color })
          .where(eq(tags.id, existing.id))
          .run();
        const restored = toTag({ ...existing, deletedAt: null, color: input.color ?? existing.color });
        logOp(tx, input.vaultId, 'tag', existing.id, 'update', { ...restored, action: 'restore' });
        return restored;
      }

      const live = tx.select().from(tags)
        .where(and(eq(tags.vaultId, input.vaultId), isNull(tags.deletedAt)))
        .all();

      const id = nanoid();
      const row: TagRow = {
        id,
        vaultId:   input.vaultId,
        name,
        color:     input.color ?? leastUsedColor(live),
        createdAt: now,
        deletedAt: null,
      };
      tx.insert(tags).values(row).run();

      const tag = toTag(row);
      logOp(tx, input.vaultId, 'tag', id, 'create', tag);
      return tag;
    });
  }

  update(tagId: string, input: UpdateTagInput): Tag {
    const db = getDb();
    const row = db.select().from(tags).where(eq(tags.id, tagId)).get();
    if (!row || row.deletedAt !== null) throw new Error(`Tag not found: ${tagId}`);

    const name = input.name === undefined ? row.name : cleanName(input.name);
    const color = input.color === undefined ? row.color : input.color;

    return db.transaction((tx) => {
      if (name !== row.name) {
        const clash = tx.select().from(tags)
          .where(and(eq(tags.vaultId, row.vaultId), eq(tags.name, name)))
          .get();
        if (clash && clash.deletedAt === null) {
          throw new Error(`A tag named "${name}" already exists`);
        }
        // A deleted tag still holds its name in the unique index — free it.
        if (clash) {
          const freed = `${clash.name} (deleted ${clash.id})`;
          tx.update(tags).set({ name: freed }).where(eq(tags.id, clash.id)).run();
          logOp(tx, clash.vaultId, 'tag', clash.id, 'update', { name: freed });
        }
      }

      tx.update(tags).set({ name, color }).where(eq(tags.id, tagId)).run();
      const tag = toTag({ ...row, name, color });
      logOp(tx, row.vaultId, 'tag', tagId, 'update', tag);
      return tag;
    });
  }

  /** Soft delete. Attachments stay in place but are hidden by every query. */
  delete(tagId: string): void {
    const db = getDb();
    const row = db.select().from(tags).where(eq(tags.id, tagId)).get();
    if (!row) throw new Error(`Tag not found: ${tagId}`);
    if (row.deletedAt !== null) return;

    const now = Date.now();
    db.transaction((tx) => {
      tx.update(tags).set({ deletedAt: now }).where(eq(tags.id, tagId)).run();
      logOp(tx, row.vaultId, 'tag', tagId, 'delete', toTag(row));
    });
  }

  attach(noteId: string, tagId: string): void {
    const db = getDb();
    const tag = this.requireLive(tagId);
    db.transaction((tx) => {
      tx.insert(noteTags)
        .values({ noteId, tagId, createdAt: Date.now() })
        .onConflictDoNothing()
        .run();
      logOp(tx, tag.vaultId, 'note', noteId, 'update', { noteId, tagId, action: 'attachTag' });
    });
  }

  detach(noteId: string, tagId: string): void {
    const db = getDb();
    const tag = db.select().from(tags).where(eq(tags.id, tagId)).get();
    if (!tag) return;
    db.transaction((tx) => {
      tx.delete(noteTags)
        .where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId)))
        .run();
      logOp(tx, tag.vaultId, 'note', noteId, 'update', { noteId, tagId, action: 'detachTag' });
    });
  }

  getForNote(noteId: string): Tag[] {
    const db = getDb();
    return db
      .select({ tag: tags })
      .from(noteTags)
      .innerJoin(tags, eq(noteTags.tagId, tags.id))
      .where(and(eq(noteTags.noteId, noteId), isNull(tags.deletedAt)))
      .all()
      .map((r) => toTag(r.tag));
  }

  getNoteMap(vaultId: string): NoteTagRow[] {
    const db = getDb();
    return db
      .select({ noteId: noteTags.noteId, tagId: noteTags.tagId })
      .from(noteTags)
      .innerJoin(notes, eq(noteTags.noteId, notes.id))
      .innerJoin(tags, eq(noteTags.tagId, tags.id))
      .where(and(eq(notes.vaultId, vaultId), isNull(tags.deletedAt)))
      .all();
  }

  private requireLive(tagId: string): TagRow {
    const row = getDb().select().from(tags).where(eq(tags.id, tagId)).get();
    if (!row || row.deletedAt !== null) throw new Error(`Tag not found: ${tagId}`);
    return row;
  }
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tag name cannot be empty');
  return trimmed;
}

/** The palette colour fewest live tags use; ties go to palette order. */
function leastUsedColor(live: TagRow[]): string {
  const counts = new Map<string, number>(DISTINCT_VAULT_COLORS.map((c) => [c, 0]));
  for (const t of live) {
    if (t.color && counts.has(t.color)) counts.set(t.color, (counts.get(t.color) ?? 0) + 1);
  }
  let best = DISTINCT_VAULT_COLORS[0]!;
  for (const [c, n] of counts) if (n < (counts.get(best) ?? 0)) best = c;
  return best;
}

function toTag(row: TagRow): Tag {
  return {
    id:        row.id,
    vaultId:   row.vaultId,
    name:      row.name,
    color:     row.color,
    createdAt: row.createdAt,
  };
}
