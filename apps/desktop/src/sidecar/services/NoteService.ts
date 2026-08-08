import { nanoid } from 'nanoid';
import { and, eq, inArray, isNotNull, isNull, like, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { notes, noteLinks, blocks } from '../db/schema';
import { logOp } from './oplog';
import { BlockIndexService } from './BlockIndexService';
import { ANNOTATABLE_TYPES } from '@shared/constants';
import { parseDoc, wrapInBlocks, unwrapBlocks, emptyNotepadDoc } from '@shared/blockDoc';
import type {
  Note,
  NoteKind,
  NoteListItem,
  NoteLinks,
  CreateNoteInput,
  UpdateNoteInput,
  UnlinkedMention,
  ConversionImpact,
} from '@shared/types';

const LIST_COLUMNS = {
  id:        notes.id,
  vaultId:   notes.vaultId,
  title:     notes.title,
  kind:      notes.kind,
  isPinned:  notes.isPinned,
  createdAt: notes.createdAt,
  updatedAt: notes.updatedAt,
  deletedAt: notes.deletedAt,
} as const;

const MENTION_CONTEXT_CHARS = 40;

export class NoteService {
  constructor(private readonly blockIndex: BlockIndexService = new BlockIndexService()) {}

  list(vaultId: string): NoteListItem[] {
    const db = getDb();
    return db
      .select(LIST_COLUMNS)
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), isNull(notes.deletedAt)))
      .orderBy(notes.updatedAt)
      .all()
      .map(toListItem);
  }

  listDeleted(vaultId: string): NoteListItem[] {
    const db = getDb();
    return db
      .select(LIST_COLUMNS)
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), isNotNull(notes.deletedAt)))
      .orderBy(notes.deletedAt)
      .all()
      .map(toListItem);
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
    const kind: NoteKind = input.kind ?? 'note';

    // A notepad must never start with an empty document: `doc → block+` cannot
    // be satisfied by the '{}' column default, and there would be nowhere to type.
    const bodyJson = input.bodyJson
      ?? (kind === 'notepad' ? JSON.stringify(emptyNotepadDoc()) : '{}');

    return db.transaction((tx) => {
      tx.insert(notes).values({
        id,
        vaultId:   input.vaultId,
        title:     input.title ?? '',
        bodyJson,
        kind,
        isPinned:  false,
        createdAt: now,
        updatedAt: now,
      }).run();

      const row = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (!row) throw new Error(`Note not found after insert: ${id}`);
      const note = toNote(row);

      this.blockIndex.reproject(id, tx);
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
          ...(input.title    !== undefined && { title:    input.title }),
          ...(input.bodyJson !== undefined && { bodyJson: input.bodyJson }),
          ...(input.isPinned !== undefined && { isPinned: input.isPinned }),
          updatedAt: now,
        })
        .where(eq(notes.id, id))
        .run();

      const row = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (!row) throw new Error(`Note not found: ${id}`);
      const note = toNote(row);

      // Only the body changes the index — a pin or rename does not.
      if (input.bodyJson !== undefined) this.blockIndex.reproject(id, tx);
      logOp(tx, note.vaultId, 'note', id, 'update', note);
      return note;
    });
  }

  /**
   * Switch a note between kinds, rewriting its document shape.
   *
   * note → notepad wraps each top-level node in a `block`.
   * notepad → note unwraps them. Fragment tags and links are deliberately left
   * in place: they stop being surfaced, but converting back restores them.
   * `blockRef` nodes cannot exist outside a notepad and are dropped, which is
   * what `conversionImpact` warns about before this is called.
   */
  convert(id: string, kind: NoteKind): Note {
    const db = getDb();
    const now = Date.now();

    return db.transaction((tx) => {
      const row = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (!row) throw new Error(`Note not found: ${id}`);
      if (row.kind === kind) return toNote(row);

      const doc = parseDoc(row.bodyJson, row.kind as NoteKind);
      const converted = kind === 'notepad'
        ? wrapInBlocks(doc)
        : unwrapBlocks(doc, ANNOTATABLE_TYPES);

      tx.update(notes)
        .set({ kind, bodyJson: JSON.stringify(converted), updatedAt: now })
        .where(eq(notes.id, id))
        .run();

      const updated = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (!updated) throw new Error(`Note not found after convert: ${id}`);
      const note = toNote(updated);

      this.blockIndex.reproject(id, tx);
      logOp(tx, note.vaultId, 'note', id, 'update', note);
      return note;
    });
  }

  conversionImpact(id: string): ConversionImpact {
    return this.blockIndex.conversionImpact(id);
  }

  // Soft delete — sets deleted_at. Index rows stay: every query joins `notes`
  // and filters on deleted_at, and a restore would only have to rebuild them.
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

      this.blockIndex.reproject(id, tx);
      logOp(tx, note.vaultId, 'note', id, 'update', note);
      return note;
    });
  }

  // Hard delete allowed only for already-soft-deleted notes (trash purge).
  permanentDelete(id: string): void {
    const db = getDb();
    const row = db.select().from(notes).where(eq(notes.id, id)).get();
    if (!row?.deletedAt) throw new Error(`Note must be soft-deleted before permanent delete: ${id}`);

    db.transaction((tx) => {
      this.blockIndex.deleteForNote(id, tx);
      tx.delete(notes).where(eq(notes.id, id)).run();
    });
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

  /**
   * Title and body search.
   *
   * Body text comes from the `blocks` index rather than a derived markdown
   * column, so there is one searchable text surface for both note kinds — and
   * the same table M4's FTS5 search will index.
   */
  search(vaultId: string, query: string): NoteListItem[] {
    const db = getDb();
    const pattern = `%${query}%`;

    const matchedByBody = db
      .selectDistinct({ noteId: blocks.noteId })
      .from(blocks)
      .where(and(eq(blocks.vaultId, vaultId), like(blocks.text, pattern)))
      .all()
      .map((r) => r.noteId);

    return db
      .select(LIST_COLUMNS)
      .from(notes)
      .where(
        and(
          eq(notes.vaultId, vaultId),
          isNull(notes.deletedAt),
          matchedByBody.length > 0
            ? or(like(notes.title, pattern), inArray(notes.id, matchedByBody))
            : like(notes.title, pattern),
        ),
      )
      .all()
      .map(toListItem);
  }

  /**
   * Notes whose text names this note without linking to it.
   *
   * Each hit carries the block it was found in, so the UI can scroll straight
   * to it instead of just opening the note.
   */
  findUnlinkedMentions(noteId: string, vaultId: string): UnlinkedMention[] {
    const db = getDb();
    const target = db.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!target || !target.title) return [];

    const rows = db
      .select({
        noteId:    blocks.noteId,
        blockId:   blocks.id,
        text:      blocks.text,
        noteTitle: notes.title,
      })
      .from(blocks)
      .innerJoin(notes, eq(notes.id, blocks.noteId))
      .where(
        and(
          eq(blocks.vaultId, vaultId),
          isNull(notes.deletedAt),
          like(blocks.text, `%${target.title}%`),
        ),
      )
      .all();

    const seen = new Set<string>();
    const out: UnlinkedMention[] = [];

    for (const row of rows) {
      if (row.noteId === noteId || seen.has(row.noteId)) continue;
      seen.add(row.noteId);

      const idx = row.text.toLowerCase().indexOf(target.title.toLowerCase());
      const start = Math.max(0, idx - MENTION_CONTEXT_CHARS);
      out.push({
        noteId:    row.noteId,
        noteTitle: row.noteTitle,
        blockId:   row.blockId,
        excerpt:   row.text.slice(start, idx + target.title.length + MENTION_CONTEXT_CHARS),
      });
    }

    return out;
  }
}

function toNote(row: typeof notes.$inferSelect): Note {
  return {
    id:        row.id,
    vaultId:   row.vaultId,
    title:     row.title,
    bodyJson:  row.bodyJson,
    kind:      row.kind as NoteKind,
    isPinned:  row.isPinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toListItem(row: {
  id: string; vaultId: string; title: string; kind: string;
  isPinned: boolean; createdAt: number; updatedAt: number; deletedAt: number | null;
}): NoteListItem {
  return { ...row, kind: row.kind as NoteKind };
}

function toNoteLink(row: typeof noteLinks.$inferSelect) {
  return {
    id:         row.id,
    fromNoteId: row.fromNoteId,
    toNoteId:   row.toNoteId,
    createdAt:  row.createdAt,
  };
}
