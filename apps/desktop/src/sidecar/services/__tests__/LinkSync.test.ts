import { describe, it, expect, beforeEach } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { freshDb, seedUser, seedVault } from './helpers';
import { getDb } from '../../db/client';
import { noteLinks, operationLog } from '../../db/schema';
import { NoteService } from '../NoteService';
import { BlockIndexService } from '../BlockIndexService';
import { LinkService } from '../LinkService';

// CORD_DB_PATH=:memory: — run with `bun test`, not Vitest.
//
// note_links is derived from the saved document, like the blocks index: the
// wiki links in body_json are the source of truth, and every save makes the
// table match them.

const USER_ID = 'link-sync-user';
const VAULT_ID = 'vault-links-01';

const mentioning = (...ids: string[]): string => JSON.stringify({
  type: 'doc',
  content: [{
    type: 'paragraph',
    attrs: { blockId: 'p1' },
    content: ids.flatMap((id) => [
      { type: 'mention', attrs: { id, label: id, displayText: null } },
      { type: 'text', text: ' ' },
    ]),
  }],
});

const targetsOf = (noteId: string): string[] =>
  getDb().select().from(noteLinks).where(eq(noteLinks.fromNoteId, noteId)).all().map((l) => l.toNoteId).sort();

const linkOps = (operation: 'create' | 'delete'): number =>
  getDb().select().from(operationLog)
    .where(and(eq(operationLog.entityType, 'link'), eq(operationLog.operation, operation)))
    .all().length;

describe('note_links derived from the document', () => {
  let notes: NoteService;
  let b: string;
  let c: string;

  beforeEach(() => {
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    notes = new NoteService(new BlockIndexService(), new LinkService());
    b = notes.create({ vaultId: VAULT_ID, title: 'B' }).id;
    c = notes.create({ vaultId: VAULT_ID, title: 'C' }).id;
  });

  it('creates a link for every wiki link in a new note, each logged', () => {
    const a = notes.create({ vaultId: VAULT_ID, bodyJson: mentioning(b, c) });
    expect(targetsOf(a.id)).toEqual([b, c].sort());
    expect(linkOps('create')).toBe(2);
  });

  it('deletes links whose wiki link was removed and keeps the rest untouched', () => {
    const a = notes.create({ vaultId: VAULT_ID, bodyJson: mentioning(b, c) });
    notes.update(a.id, { bodyJson: mentioning(c) });
    expect(targetsOf(a.id)).toEqual([c]);
    expect(linkOps('delete')).toBe(1);
    // The surviving link is neither recreated nor logged again.
    expect(linkOps('create')).toBe(2);
  });

  it('ignores links to itself, to missing notes and to other vaults', () => {
    seedVault('vault-other', USER_ID);
    const elsewhere = notes.create({ vaultId: 'vault-other', title: 'Far' }).id;
    const a = notes.create({ vaultId: VAULT_ID, title: 'A' });
    notes.update(a.id, { bodyJson: mentioning(a.id, 'no-such-note', elsewhere) });
    expect(targetsOf(a.id)).toEqual([]);
    expect(linkOps('create')).toBe(0);
  });

  it('leaves links alone when only the title changes', () => {
    const a = notes.create({ vaultId: VAULT_ID, bodyJson: mentioning(b) });
    // A link row the document does not mention would be removed by a sync;
    // a title-only update must not run one.
    getDb().insert(noteLinks).values({ id: 'manual', fromNoteId: a.id, toNoteId: c, createdAt: Date.now() }).run();
    notes.update(a.id, { title: 'Renamed' });
    expect(targetsOf(a.id)).toEqual([b, c].sort());
  });

  it('re-syncs links from the body when a note is restored', () => {
    const a = notes.create({ vaultId: VAULT_ID, bodyJson: mentioning(b) });
    notes.delete(a.id);
    getDb().delete(noteLinks).where(eq(noteLinks.fromNoteId, a.id)).run();
    notes.restore(a.id);
    expect(targetsOf(a.id)).toEqual([b]);
  });
});
