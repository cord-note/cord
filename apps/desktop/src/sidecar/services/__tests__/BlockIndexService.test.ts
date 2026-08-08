import { describe, it, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser, seedVault } from './helpers';
import { getDb } from '../../db/client';
import { blocks, fragments, fragmentTags, fragmentLinks, tags, notes as notesTable } from '../../db/schema';
import { BlockIndexService } from '../BlockIndexService';
import { NoteService } from '../NoteService';

// CORD_DB_PATH=:memory: — run with `bun test`, not Vitest.
//
// The index is derived and rebuilt by wholesale delete-and-insert, which is only
// safe because authored data lives elsewhere. The test that matters most here is
// the one asserting a reproject cannot touch `fragments`.

const VAULT_ID = 'vault-block-01';
const USER_ID = 'block-test-user';

const para = (text: string, blockId?: string) => ({
  type: 'paragraph',
  ...(blockId ? { attrs: { blockId } } : {}),
  content: [{ type: 'text', text }],
});

const notepad = (...inner: Record<string, unknown>[]) =>
  JSON.stringify({
    type: 'doc',
    content: inner.map((node, i) => ({
      type: 'notepadBlock',
      attrs: { blockId: `b${i + 1}` },
      content: [node],
    })),
  });

describe('BlockIndexService', () => {
  let index: BlockIndexService;
  let notes: NoteService;

  beforeEach(() => {
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    index = new BlockIndexService();
    notes = new NoteService(index);
  });

  describe('reproject', () => {
    it('indexes a notepad one row per block, in document order', () => {
      const note = notes.create({
        vaultId: VAULT_ID,
        kind: 'notepad',
        bodyJson: notepad(
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section' }] },
          para('body text'),
          { type: 'horizontalRule' },
        ),
      });

      const rows = index.listForNote(note.id);
      expect(rows.map((r) => [r.sort, r.type])).toEqual([
        [0, 'heading'],
        [1, 'paragraph'],
        [2, 'horizontalRule'],
      ]);
      expect(rows[0]!.level).toBe(2);
      expect(rows[1]!.text).toBe('body text');
      expect(rows[2]!.text).toBe('');
    });

    it('indexes plain notes too — it is the only searchable text surface', () => {
      const note = notes.create({
        vaultId: VAULT_ID,
        bodyJson: JSON.stringify({ type: 'doc', content: [para('plain note body', 'p1')] }),
      });
      const rows = index.listForNote(note.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 'p1', text: 'plain note body' });
    });

    it('runs on create without a separate call', () => {
      const note = notes.create({ vaultId: VAULT_ID, bodyJson: JSON.stringify({ type: 'doc', content: [para('x', 'p1')] }) });
      expect(index.listForNote(note.id)).toHaveLength(1);
    });

    it('is idempotent', () => {
      const note = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('one'), para('two')) });
      const first = index.listForNote(note.id);
      index.reproject(note.id);
      index.reproject(note.id);
      const after = index.listForNote(note.id);
      expect(after.map((r) => r.id)).toEqual(first.map((r) => r.id));
      expect(after).toHaveLength(2);
    });

    it('drops rows for blocks that no longer exist', () => {
      const note = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('one'), para('two')) });
      expect(index.listForNote(note.id)).toHaveLength(2);

      notes.update(note.id, { bodyJson: notepad(para('one')) });
      expect(index.listForNote(note.id).map((r) => r.id)).toEqual(['b1']);
    });

    it('preserves created_at across a rebuild', () => {
      const note = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('one')) });
      const before = index.listForNote(note.id)[0]!;

      index.reproject(note.id);
      const after = index.listForNote(note.id)[0]!;
      // A block's age should survive editing the note it lives in.
      expect(after.createdAt).toBe(before.createdAt);
    });

    it('never touches authored fragment data', () => {
      const note = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('tagged')) });
      const db = getDb();
      const now = Date.now();

      db.insert(tags).values({ id: 'tag-1', vaultId: VAULT_ID, name: 'idea', createdAt: now }).run();
      db.insert(fragments).values({ id: 'b1', noteId: note.id, vaultId: VAULT_ID, createdAt: now }).run();
      db.insert(fragmentTags).values({ fragmentId: 'b1', tagId: 'tag-1', createdAt: now }).run();

      index.reproject(note.id);

      // This is the invariant that makes delete-and-insert acceptable at all.
      expect(db.select().from(fragments).where(eq(fragments.id, 'b1')).all()).toHaveLength(1);
      expect(db.select().from(fragmentTags).all()).toHaveLength(1);
    });

    it('does nothing for an unknown note', () => {
      expect(() => index.reproject('no-such-note')).not.toThrow();
    });

    it('indexes a note whose nodes share a blockId', () => {
      // Pre-existing real-world data: the old BlockId extension assigned ids only
      // when missing, so splitting a paragraph left duplicates behind. The primary
      // key on blocks.id makes this fatal if not handled.
      const note = notes.create({
        vaultId: VAULT_ID,
        bodyJson: JSON.stringify({
          type: 'doc',
          content: [para('first', 'dup'), para('second', 'dup')],
        }),
      });

      const rows = index.listForNote(note.id);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.id)).size).toBe(2);
      expect(rows.map((r) => r.text)).toEqual(['first', 'second']);
    });
  });

  describe('backfillMissing resilience', () => {
    it('keeps going when one note cannot be indexed', () => {
      // Runs during boot: one bad note must not stop the sidecar from starting.
      const good = notes.create({
        vaultId: VAULT_ID,
        bodyJson: JSON.stringify({ type: 'doc', content: [para('fine', 'p1')] }),
      });
      const db = getDb();
      db.delete(blocks).run();

      // A document whose top-level node has no type at all.
      db.update(notesTable)
        .set({ bodyJson: '{"type":"doc","content":[{"attrs":{}}]}' })
        .where(eq(notesTable.id, good.id))
        .run();
      const alsoGood = notes.create({
        vaultId: VAULT_ID,
        bodyJson: JSON.stringify({ type: 'doc', content: [para('indexed', 'p2')] }),
      });

      expect(() => index.backfillMissing()).not.toThrow();
      expect(index.listForNote(alsoGood.id)).toHaveLength(1);
    });
  });

  describe('resolveRef', () => {
    it('resolves to the source content, read from the source note', () => {
      const source = notes.create({
        vaultId: VAULT_ID, title: 'Source', kind: 'notepad',
        bodyJson: notepad(para('borrowed text')),
      });

      const target = index.resolveRef('b1');
      expect(target).not.toBeNull();
      expect(target!.noteId).toBe(source.id);
      expect(target!.noteTitle).toBe('Source');
      expect(target!.type).toBe('paragraph');
      expect(target!.contentJson).toContain('borrowed text');
    });

    it('reflects an edit to the source immediately', () => {
      const source = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('before')) });
      notes.update(source.id, { bodyJson: notepad(para('after')) });
      // Content is never copied into the index, so there is nothing to go stale.
      expect(index.resolveRef('b1')!.contentJson).toContain('after');
    });

    it('returns null for an unknown block', () => {
      expect(index.resolveRef('nope')).toBeNull();
    });

    it('returns null when the source note is in the trash', () => {
      const source = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('x')) });
      notes.delete(source.id);
      expect(index.resolveRef('b1')).toBeNull();
    });

    it('resolves again once the source note is restored', () => {
      const source = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('x')) });
      notes.delete(source.id);
      notes.restore(source.id);
      expect(index.resolveRef('b1')).not.toBeNull();
    });

    it('returns null when the block was edited away but the row lingers', () => {
      const source = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('x')) });
      const db = getDb();
      // Simulate an index row pointing at content no longer in the document.
      db.update(blocks).set({ id: 'ghost' }).where(eq(blocks.noteId, source.id)).run();
      expect(index.resolveRef('ghost')).toBeNull();
    });
  });

  describe('backfillMissing', () => {
    it('indexes only notes that have no rows', () => {
      const note = notes.create({ vaultId: VAULT_ID, bodyJson: JSON.stringify({ type: 'doc', content: [para('x', 'p1')] }) });
      expect(index.backfillMissing()).toBe(0);

      getDb().delete(blocks).where(eq(blocks.noteId, note.id)).run();
      expect(index.backfillMissing()).toBe(1);
      expect(index.listForNote(note.id)).toHaveLength(1);
    });
  });

  describe('conversionImpact', () => {
    it('reports zero for a notepad with no annotations', () => {
      const note = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('x')) });
      expect(index.conversionImpact(note.id)).toEqual({
        blockTagCount: 0, blockLinkCount: 0, inboundRefCount: 0,
      });
    });

    it('counts block tags, block links and inbound references', () => {
      const source = notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad(para('target')) });
      const db = getDb();
      const now = Date.now();

      db.insert(tags).values({ id: 'tag-1', vaultId: VAULT_ID, name: 'idea', createdAt: now }).run();
      db.insert(fragments).values({ id: 'b1', noteId: source.id, vaultId: VAULT_ID, createdAt: now }).run();
      db.insert(fragmentTags).values({ fragmentId: 'b1', tagId: 'tag-1', createdAt: now }).run();
      db.insert(fragmentLinks).values({
        id: 'fl-1', fromFragmentId: 'b1', toNoteId: source.id, toFragmentId: null,
        vaultId: VAULT_ID, createdAt: now,
      }).run();

      // Another notepad transcluding b1.
      notes.create({
        vaultId: VAULT_ID, kind: 'notepad',
        bodyJson: JSON.stringify({
          type: 'doc',
          content: [{
            type: 'notepadBlock', attrs: { blockId: 'ref-holder' },
            content: [{ type: 'blockRef', attrs: { refBlockId: 'b1', refNoteId: source.id } }],
          }],
        }),
      });

      expect(index.conversionImpact(source.id)).toEqual({
        blockTagCount: 1, blockLinkCount: 1, inboundRefCount: 1,
      });
    });
  });
});
