import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { fragments, fragmentTags, fragmentLinks, tags } from '../db/schema';
import { logOp } from './oplog';
import type {
  FragmentAnnotationMap,
  FragmentLink,
  CreateFragmentLinkInput,
} from '@shared/types';

export class FragmentService {
  getForNote(noteId: string): FragmentAnnotationMap {
    const db = getDb();
    const result: FragmentAnnotationMap = {};

    const frags = db
      .select()
      .from(fragments)
      .where(eq(fragments.noteId, noteId))
      .all();

    for (const frag of frags) {
      const fragTags = db
        .select({ tag: tags })
        .from(fragmentTags)
        .innerJoin(tags, eq(fragmentTags.tagId, tags.id))
        .where(eq(fragmentTags.fragmentId, frag.id))
        .all()
        .map((r) => r.tag);

      const links = db
        .select()
        .from(fragmentLinks)
        .where(eq(fragmentLinks.fromFragmentId, frag.id))
        .all()
        .map(toFragmentLink);

      const backlinks = db
        .select()
        .from(fragmentLinks)
        .where(eq(fragmentLinks.toFragmentId, frag.id))
        .all()
        .map(toFragmentLink);

      result[frag.id] = { tags: fragTags, links, backlinks };
    }

    return result;
  }

  attachTag(blockId: string, noteId: string, vaultId: string, tagId: string): void {
    const db = getDb();

    db.transaction((tx) => {
      // Ensure the fragment row exists (upsert pattern).
      const existing = tx.select().from(fragments).where(eq(fragments.id, blockId)).get();
      if (!existing) {
        tx.insert(fragments).values({ id: blockId, noteId, vaultId, createdAt: Date.now() }).run();
      }

      tx.insert(fragmentTags)
        .values({ fragmentId: blockId, tagId, createdAt: Date.now() })
        .onConflictDoNothing()
        .run();

      logOp(tx, vaultId, 'fragment', blockId, 'update', { blockId, tagId, action: 'attachTag' });
    });
  }

  detachTag(blockId: string, tagId: string): void {
    const db = getDb();
    const frag = db.select().from(fragments).where(eq(fragments.id, blockId)).get();
    if (!frag) return;

    db.transaction((tx) => {
      tx.delete(fragmentTags)
        .where(and(eq(fragmentTags.fragmentId, blockId), eq(fragmentTags.tagId, tagId)))
        .run();
      logOp(tx, frag.vaultId, 'fragment', blockId, 'update', { blockId, tagId, action: 'detachTag' });
    });
  }

  createLink(input: CreateFragmentLinkInput): FragmentLink {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();

    return db.transaction((tx) => {
      // Register source fragment if not yet tracked.
      const existing = tx.select().from(fragments).where(eq(fragments.id, input.fromFragmentId)).get();
      if (!existing) {
        tx.insert(fragments).values({
          id: input.fromFragmentId, noteId: input.fromNoteId, vaultId: input.vaultId, createdAt: now,
        }).run();
      }

      // Register target fragment if given.
      if (input.toFragmentId && input.toFragmentNoteId) {
        const targetExists = tx.select().from(fragments).where(eq(fragments.id, input.toFragmentId)).get();
        if (!targetExists) {
          tx.insert(fragments).values({
            id: input.toFragmentId, noteId: input.toFragmentNoteId, vaultId: input.vaultId, createdAt: now,
          }).run();
        }
      }

      tx.insert(fragmentLinks).values({
        id,
        fromFragmentId: input.fromFragmentId,
        toNoteId:       input.toNoteId       ?? null,
        toFragmentId:   input.toFragmentId   ?? null,
        vaultId:        input.vaultId,
        createdAt:      now,
      }).run();

      const link: FragmentLink = {
        id,
        fromFragmentId: input.fromFragmentId,
        toNoteId:       input.toNoteId       ?? null,
        toFragmentId:   input.toFragmentId   ?? null,
        vaultId:        input.vaultId,
        createdAt:      now,
      };

      logOp(tx, input.vaultId, 'fragment', id, 'create', link);
      return link;
    });
  }

  deleteLink(linkId: string): void {
    const db = getDb();
    const link = db.select().from(fragmentLinks).where(eq(fragmentLinks.id, linkId)).get();
    if (!link) return;

    db.transaction((tx) => {
      tx.delete(fragmentLinks).where(eq(fragmentLinks.id, linkId)).run();
      logOp(tx, link.vaultId, 'fragment', linkId, 'delete', link);
    });
  }
}

function toFragmentLink(row: typeof fragmentLinks.$inferSelect): FragmentLink {
  return {
    id:             row.id,
    fromFragmentId: row.fromFragmentId,
    toNoteId:       row.toNoteId,
    toFragmentId:   row.toFragmentId,
    vaultId:        row.vaultId,
    createdAt:      row.createdAt,
  };
}
