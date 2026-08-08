import { eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { blocks, notes, fragments, fragmentLinks, fragmentTags } from '../db/schema';
import { parseDoc, extractBlocks, findBlockContent } from '@shared/blockDoc';
import type { Block, BlockRefTarget, ConversionImpact, NoteKind } from '@shared/types';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Maintains the `blocks` index — a derived projection of `notes.body_json`.
 *
 * Nothing here is authored data. Rows are replaced wholesale on every save,
 * which is why reprojection may hard-delete them: losing the index costs one
 * reproject, and it can always be rebuilt from body_json. Authored per-block
 * data (fragment tags and links) lives in `fragments` and is never touched by
 * this service.
 *
 * No operation_log entries are written for the same reason — body_json is
 * logged, and a sync receiver reprojects locally from it.
 */
export class BlockIndexService {
  /**
   * Rebuild the index for one note.
   *
   * Runs inside the caller's transaction when given one, so a note save and its
   * reprojection commit together — a half-updated index is never visible.
   */
  reproject(noteId: string, tx?: Tx): void {
    const db = tx ?? getDb();

    const note = db
      .select({ vaultId: notes.vaultId, bodyJson: notes.bodyJson, kind: notes.kind })
      .from(notes)
      .where(eq(notes.id, noteId))
      .get();
    if (!note) return;

    const now = Date.now();
    const doc = parseDoc(note.bodyJson, note.kind as NoteKind);
    const extracted = extractBlocks(doc, noteId);

    // Preserve created_at for rows that survive this rebuild, so a block's age
    // is not reset every time the note is saved.
    const previous = db
      .select({ id: blocks.id, createdAt: blocks.createdAt })
      .from(blocks)
      .where(eq(blocks.noteId, noteId))
      .all();
    const createdBefore = new Map(previous.map((r) => [r.id, r.createdAt]));

    db.delete(blocks).where(eq(blocks.noteId, noteId)).run();

    if (extracted.length === 0) return;

    db.insert(blocks)
      .values(
        extracted.map((b) => ({
          id:         b.id,
          noteId,
          vaultId:    note.vaultId,
          type:       b.type,
          sort:       b.sort,
          level:      b.level,
          text:       b.text,
          refBlockId: b.refBlockId,
          createdAt:  createdBefore.get(b.id) ?? now,
          updatedAt:  now,
        })),
      )
      .run();
  }

  /** Drop a note's rows outright — trash purge only. */
  deleteForNote(noteId: string, tx?: Tx): void {
    const db = tx ?? getDb();
    db.delete(blocks).where(eq(blocks.noteId, noteId)).run();
  }

  listForNote(noteId: string): Block[] {
    const db = getDb();
    return db
      .select()
      .from(blocks)
      .where(eq(blocks.noteId, noteId))
      .orderBy(blocks.sort)
      .all();
  }

  /**
   * Resolve a blockRef to its source content.
   *
   * Content is read out of the source note's body_json rather than stored on the
   * index row, so there is exactly one copy of every block's content and a
   * transclusion can never show something stale.
   */
  resolveRef(refBlockId: string): BlockRefTarget | null {
    const db = getDb();

    const row = db
      .select({ noteId: blocks.noteId, type: blocks.type })
      .from(blocks)
      .where(eq(blocks.id, refBlockId))
      .get();
    if (!row) return null;

    const note = db
      .select({ title: notes.title, bodyJson: notes.bodyJson, kind: notes.kind, deletedAt: notes.deletedAt })
      .from(notes)
      .where(eq(notes.id, row.noteId))
      .get();
    // A ref into the trash resolves to nothing — the target is not addressable
    // while deleted, and restoring the note makes the ref live again.
    if (!note || note.deletedAt !== null) return null;

    const content = findBlockContent(parseDoc(note.bodyJson, note.kind as NoteKind), refBlockId);
    if (!content) return null;

    return {
      blockId:     refBlockId,
      noteId:      row.noteId,
      noteTitle:   note.title,
      type:        row.type,
      contentJson: JSON.stringify(content),
    };
  }

  /** Rebuild every note in a vault. Migration back-fill and repair. */
  rebuildForVault(vaultId: string): number {
    const db = getDb();
    const ids = db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.vaultId, vaultId))
      .all();
    for (const { id } of ids) this.reproject(id);
    return ids.length;
  }

  /** Rebuild every note in the database. Repair only — see backfillMissing. */
  rebuildAll(): number {
    const db = getDb();
    const ids = db.select({ id: notes.id }).from(notes).all();
    for (const { id } of ids) this.reproject(id);
    return ids.length;
  }

  /**
   * Index only notes that have no rows yet — the upgrade path for notes written
   * before this index existed. Runs at boot, so it must stay proportional to
   * what is actually missing rather than to the size of the vault.
   */
  backfillMissing(): number {
    const db = getDb();
    const missing = db
      .select({ id: notes.id })
      .from(notes)
      .leftJoin(blocks, eq(blocks.noteId, notes.id))
      .where(isNull(blocks.id))
      .all();

    let indexed = 0;
    for (const { id } of missing) {
      // This runs during boot, before the server starts listening. A single note
      // with an unexpected document shape must degrade to "not searchable" rather
      // than stop the sidecar from ever emitting its port — which surfaces to the
      // user as the app refusing to launch at all, with no clue which note is at
      // fault.
      try {
        this.reproject(id);
        indexed++;
      } catch (err) {
        console.error(`[blocks] could not index note ${id}:`, err);
      }
    }
    return indexed;
  }

  /**
   * What a notepad → note conversion would cost, counted before it happens.
   *
   * Fragment rows are never deleted by conversion, so these tags and links stop
   * being surfaced rather than being destroyed — converting back restores them.
   * Inbound refs, by contrast, genuinely break.
   */
  conversionImpact(noteId: string): ConversionImpact {
    const db = getDb();

    const blockIds = db
      .select({ id: blocks.id })
      .from(blocks)
      .where(eq(blocks.noteId, noteId))
      .all()
      .map((r) => r.id);

    if (blockIds.length === 0) {
      return { blockTagCount: 0, blockLinkCount: 0, inboundRefCount: 0 };
    }

    const owned = db
      .select({ id: fragments.id })
      .from(fragments)
      .where(inArray(fragments.id, blockIds))
      .all()
      .map((r) => r.id);

    const blockTagCount = owned.length === 0 ? 0 : db
      .select({ id: fragmentTags.fragmentId })
      .from(fragmentTags)
      .where(inArray(fragmentTags.fragmentId, owned))
      .all().length;

    const blockLinkCount = owned.length === 0 ? 0 : db
      .select({ id: fragmentLinks.id })
      .from(fragmentLinks)
      .where(inArray(fragmentLinks.fromFragmentId, owned))
      .all().length;

    const inboundRefCount = db
      .select({ id: blocks.id })
      .from(blocks)
      .where(inArray(blocks.refBlockId, blockIds))
      .all().length;

    return { blockTagCount, blockLinkCount, inboundRefCount };
  }
}
