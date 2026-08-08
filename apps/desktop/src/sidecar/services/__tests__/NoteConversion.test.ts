import { describe, it, expect, beforeEach } from 'bun:test';
import { freshDb, seedUser, seedVault } from './helpers';
import { NoteService } from '../NoteService';
import { BlockIndexService } from '../BlockIndexService';
import { flattenText, parseDoc } from '@shared/blockDoc';

// CORD_DB_PATH=:memory: — run with `bun test`, not Vitest.

const VAULT_ID = 'vault-convert-01';
const USER_ID = 'convert-test-user';

const para = (text: string, blockId?: string) => ({
  type: 'paragraph',
  ...(blockId ? { attrs: { blockId } } : {}),
  content: [{ type: 'text', text }],
});

describe('note ↔ notepad conversion', () => {
  let notes: NoteService;
  let index: BlockIndexService;

  beforeEach(() => {
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    index = new BlockIndexService();
    notes = new NoteService(index);
  });

  it('creates a notepad with a document that satisfies doc → block+', () => {
    const note = notes.create({ vaultId: VAULT_ID, kind: 'notepad' });
    const doc = parseDoc(note.bodyJson, 'notepad');
    // The '{}' default cannot satisfy `block+`, so create must seed a real doc.
    expect(note.bodyJson).not.toBe('{}');
    expect(doc.content!.every((n) => n.type === 'notepadBlock')).toBe(true);
  });

  it('wraps every top-level node when converting a note to a notepad', () => {
    const note = notes.create({
      vaultId: VAULT_ID,
      bodyJson: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
          para('body'),
        ],
      }),
    });

    const converted = notes.convert(note.id, 'notepad');
    expect(converted.kind).toBe('notepad');

    const doc = parseDoc(converted.bodyJson, 'notepad');
    expect(doc.content).toHaveLength(2);
    expect(doc.content!.every((n) => n.type === 'notepadBlock')).toBe(true);
    expect(flattenText(doc)).toBe('Title body');
  });

  it('reindexes on convert so block types describe the new shape', () => {
    const note = notes.create({
      vaultId: VAULT_ID,
      bodyJson: JSON.stringify({ type: 'doc', content: [para('one', 'p1'), para('two', 'p2')] }),
    });
    notes.convert(note.id, 'notepad');

    const rows = index.listForNote(note.id);
    expect(rows).toHaveLength(2);
    // The promoted ids keep any fragment annotations attached.
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('unwraps blocks when converting back', () => {
    const note = notes.create({ vaultId: VAULT_ID, kind: 'notepad' });
    notes.update(note.id, {
      bodyJson: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'notepadBlock', attrs: { blockId: 'b1' }, content: [para('kept')] },
        ],
      }),
    });

    const converted = notes.convert(note.id, 'note');
    expect(converted.kind).toBe('note');

    const doc = parseDoc(converted.bodyJson);
    expect(doc.content![0]!.type).toBe('paragraph');
    expect(flattenText(doc)).toBe('kept');
  });

  it('round-trips content unchanged', () => {
    const original = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, blockId: 'h1' }, content: [{ type: 'text', text: 'Heading' }] },
        para('paragraph', 'p1'),
      ],
    });
    const note = notes.create({ vaultId: VAULT_ID, bodyJson: original });

    notes.convert(note.id, 'notepad');
    const back = notes.convert(note.id, 'note');

    expect(flattenText(parseDoc(back.bodyJson))).toBe('Heading paragraph');
    expect(parseDoc(back.bodyJson).content!.map((n) => n.attrs?.['blockId'])).toEqual(['h1', 'p1']);
  });

  it('is a no-op when the kind already matches', () => {
    const note = notes.create({ vaultId: VAULT_ID, bodyJson: JSON.stringify({ type: 'doc', content: [para('x')] }) });
    const result = notes.convert(note.id, 'note');
    expect(result.bodyJson).toBe(note.bodyJson);
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
      bodyJson: JSON.stringify({ type: 'doc', content: [para('the quick brown fox', 'p1')] }),
    });
    const results = notes.search(VAULT_ID, 'quick brown');
    expect(results.map((r) => r.id)).toEqual([note.id]);
  });

  it('finds a note by title when the body does not match', () => {
    const note = notes.create({ vaultId: VAULT_ID, title: 'Groceries' });
    expect(notes.search(VAULT_ID, 'Groc').map((r) => r.id)).toEqual([note.id]);
  });

  it('returns each matching note once, however many blocks matched', () => {
    const note = notes.create({
      vaultId: VAULT_ID, kind: 'notepad',
      bodyJson: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'notepadBlock', attrs: { blockId: 'b1' }, content: [para('repeat')] },
          { type: 'notepadBlock', attrs: { blockId: 'b2' }, content: [para('repeat again')] },
        ],
      }),
    });
    expect(notes.search(VAULT_ID, 'repeat').filter((r) => r.id === note.id)).toHaveLength(1);
  });

  it('excludes trashed notes', () => {
    const note = notes.create({
      vaultId: VAULT_ID,
      bodyJson: JSON.stringify({ type: 'doc', content: [para('findable', 'p1')] }),
    });
    notes.delete(note.id);
    expect(notes.search(VAULT_ID, 'findable')).toHaveLength(0);
  });

  it('does not leak across vaults', () => {
    seedVault('vault-other', USER_ID);
    notes.create({
      vaultId: 'vault-other',
      bodyJson: JSON.stringify({ type: 'doc', content: [para('secret', 'p1')] }),
    });
    expect(notes.search(VAULT_ID, 'secret')).toHaveLength(0);
  });

  it('reports unlinked mentions with the block they were found in', () => {
    const target = notes.create({ vaultId: VAULT_ID, title: 'Photosynthesis' });
    const mentioning = notes.create({
      vaultId: VAULT_ID, title: 'Biology', kind: 'notepad',
      bodyJson: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'notepadBlock', attrs: { blockId: 'b1' }, content: [para('unrelated opening')] },
          { type: 'notepadBlock', attrs: { blockId: 'b2' }, content: [para('Photosynthesis converts light.')] },
        ],
      }),
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
      bodyJson: JSON.stringify({ type: 'doc', content: [para('Recursion is fun', 'p1')] }),
    });
    expect(notes.findUnlinkedMentions(note.id, VAULT_ID)).toHaveLength(0);
  });

  it('returns nothing for an untitled note', () => {
    const note = notes.create({ vaultId: VAULT_ID });
    expect(notes.findUnlinkedMentions(note.id, VAULT_ID)).toHaveLength(0);
  });
});
