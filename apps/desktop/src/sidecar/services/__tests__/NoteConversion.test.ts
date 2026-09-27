import { describe, it, expect, beforeEach } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { freshDb, seedUser, seedVault } from './helpers';
import { NoteService } from '../NoteService';
import { BlockIndexService } from '../BlockIndexService';
import { getDb } from '../../db/client';
import { operationLog } from '../../db/schema';

// CORD_DB_PATH=:memory: — run with `bun test`, not Vitest.

const VAULT_ID = 'vault-convert-01';
const USER_ID = 'convert-test-user';

const para = (text: string, blockId?: string) => ({
  type: 'paragraph',
  ...(blockId ? { attrs: { blockId } } : {}),
  content: [{ type: 'text', text }],
});

const docJson = (...content: Record<string, unknown>[]): string => JSON.stringify({ type: 'doc', content });

const updateOps = (noteId: string): number =>
  getDb().select().from(operationLog)
    .where(and(eq(operationLog.entityId, noteId), eq(operationLog.operation, 'update')))
    .all().length;

describe('switching note kind', () => {
  let notes: NoteService;
  let index: BlockIndexService;

  beforeEach(() => {
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    index = new BlockIndexService();
    notes = new NoteService(index);
  });

  it('changes only the kind, keeping the body byte-identical', () => {
    // Both kinds share one document format, so switching is lossless.
    const body = docJson(
      { type: 'heading', attrs: { level: 1, blockId: 'h1' }, content: [{ type: 'text', text: 'Title' }] },
      para('body', 'p1'),
    );
    const note = notes.create({ vaultId: VAULT_ID, bodyJson: body });

    const asNotepad = notes.convert(note.id, 'notepad');
    expect(asNotepad.kind).toBe('notepad');
    expect(asNotepad.bodyJson).toBe(body);

    const back = notes.convert(note.id, 'note');
    expect(back.kind).toBe('note');
    expect(back.bodyJson).toBe(body);
  });

  it('keeps block ids in the index, so fragment tags stay attached', () => {
    const note = notes.create({ vaultId: VAULT_ID, bodyJson: docJson(para('one', 'p1'), para('two', 'p2')) });
    notes.convert(note.id, 'notepad');
    expect(index.listForNote(note.id).map((r) => r.id)).toEqual(['p1', 'p2']);
    notes.convert(note.id, 'note');
    expect(index.listForNote(note.id).map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('logs one update per switch', () => {
    const note = notes.create({ vaultId: VAULT_ID, bodyJson: docJson(para('x', 'p1')) });
    notes.convert(note.id, 'notepad');
    expect(updateOps(note.id)).toBe(1);
    notes.convert(note.id, 'note');
    expect(updateOps(note.id)).toBe(2);
  });

  it('is a no-op when the kind already matches', () => {
    const note = notes.create({ vaultId: VAULT_ID, bodyJson: docJson(para('x')) });
    const result = notes.convert(note.id, 'note');
    expect(result.bodyJson).toBe(note.bodyJson);
    expect(updateOps(note.id)).toBe(0);
  });

  it('throws for an unknown note', () => {
    expect(() => notes.convert('no-such-note', 'notepad')).toThrow();
  });
});

describe('search and mentions over the block index', () => {
  let notes: NoteService;

  beforeEach(() => {
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    notes = new NoteService(new BlockIndexService());
  });

  it('finds a note by its body text', () => {
    const note = notes.create({
      vaultId: VAULT_ID, title: 'Untitled-ish',
      bodyJson: docJson(para('the quick brown fox', 'p1')),
    });
    const results = notes.search(VAULT_ID, 'quick brown');
    expect(results.map((r) => r.id)).toEqual([note.id]);
  });

  it('finds a note by the label of a wiki link in it', () => {
    const note = notes.create({
      vaultId: VAULT_ID,
      bodyJson: docJson({
        type: 'paragraph', attrs: { blockId: 'p1' },
        content: [{ type: 'text', text: 'see ' }, { type: 'mention', attrs: { id: 'x', label: 'Zanzibar', displayText: null } }],
      }),
    });
    expect(notes.search(VAULT_ID, 'Zanzibar').map((r) => r.id)).toEqual([note.id]);
  });

  it('finds a note by title when the body does not match', () => {
    const note = notes.create({ vaultId: VAULT_ID, title: 'Groceries' });
    expect(notes.search(VAULT_ID, 'Groc').map((r) => r.id)).toEqual([note.id]);
  });

  it('returns each matching note once, however many blocks matched', () => {
    const note = notes.create({
      vaultId: VAULT_ID, kind: 'notepad',
      bodyJson: docJson(para('repeat', 'b1'), para('repeat again', 'b2')),
    });
    expect(notes.search(VAULT_ID, 'repeat').filter((r) => r.id === note.id)).toHaveLength(1);
  });

  it('excludes trashed notes', () => {
    const note = notes.create({ vaultId: VAULT_ID, bodyJson: docJson(para('findable', 'p1')) });
    notes.delete(note.id);
    expect(notes.search(VAULT_ID, 'findable')).toHaveLength(0);
  });

  it('does not leak across vaults', () => {
    seedVault('vault-other', USER_ID);
    notes.create({ vaultId: 'vault-other', bodyJson: docJson(para('secret', 'p1')) });
    expect(notes.search(VAULT_ID, 'secret')).toHaveLength(0);
  });

  it('reports unlinked mentions with the block they were found in', () => {
    const target = notes.create({ vaultId: VAULT_ID, title: 'Photosynthesis' });
    const mentioning = notes.create({
      vaultId: VAULT_ID, title: 'Biology', kind: 'notepad',
      bodyJson: docJson(para('unrelated opening', 'b1'), para('Photosynthesis converts light.', 'b2')),
    });

    const mentions = notes.findUnlinkedMentions(target.id, VAULT_ID);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.noteId).toBe(mentioning.id);
    // The block anchor is what lets the UI scroll to the hit rather than just
    // opening the note.
    expect(mentions[0]!.blockId).toBe('b2');
    expect(mentions[0]!.excerpt).toContain('Photosynthesis');
  });

  it('never reports the note as mentioning itself', () => {
    const note = notes.create({
      vaultId: VAULT_ID, title: 'Recursion',
      bodyJson: docJson(para('Recursion is fun', 'p1')),
    });
    expect(notes.findUnlinkedMentions(note.id, VAULT_ID)).toHaveLength(0);
  });

  it('returns nothing for an untitled note', () => {
    const note = notes.create({ vaultId: VAULT_ID });
    expect(notes.findUnlinkedMentions(note.id, VAULT_ID)).toHaveLength(0);
  });
});
