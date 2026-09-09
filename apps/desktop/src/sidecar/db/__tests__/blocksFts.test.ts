import { describe, it, expect, beforeEach } from 'bun:test';
import { freshDb, seedUser, seedVault } from '../../services/__tests__/helpers';
import { getRawSqlite } from '../client';
import { runMigrations } from '../migrations';
import { NoteService } from '../../services/NoteService';
import { BlockIndexService } from '../../services/BlockIndexService';

// blocks_fts is maintained by SQLite triggers, not by service code, so nothing
// in TypeScript references it. These tests are the only thing standing between
// a broken trigger and phantom search results — an external-content FTS table
// that misses a delete keeps matching text that no longer exists anywhere.

const USER_ID = 'fts-user';
const VAULT_ID = 'vault-fts-01';

const notepad = (...texts: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: texts.map((text, i) => ({
      type: 'notepadBlock',
      attrs: { blockId: `fts-b${i + 1}` },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  });

/** Rows in the FTS index whose text contains `needle` as a substring. */
function ftsMatches(needle: string): number {
  const row = getRawSqlite()
    .query(`SELECT count(*) AS c FROM blocks_fts WHERE text MATCH ?`)
    .get(`"${needle}"`) as { c: number };
  return row.c;
}

function ftsTotal(): number {
  const row = getRawSqlite()
    .query(`SELECT count(*) AS c FROM blocks_fts`)
    .get() as { c: number };
  return row.c;
}

describe('blocks_fts', () => {
  let notes: NoteService;
  let index: BlockIndexService;

  beforeEach(() => {
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    index = new BlockIndexService();
    notes = new NoteService(index);
  });

  it('indexes block text when a note is created', () => {
    notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('hello harbour') });
    expect(ftsMatches('harbour')).toBe(1);
  });

  it('matches mid-word, exactly as LIKE did', () => {
    notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('barfoosh') });
    expect(ftsMatches('foo')).toBe(1);
  });

  it('drops stale rows when a note is reprojected with new text', () => {
    const note = notes.create({
      vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('original text'),
    });
    notes.update(note.id, { bodyJson: notepad('replacement text') });

    expect(ftsMatches('original')).toBe(0);
    expect(ftsMatches('replacement')).toBe(1);
  });

  it('does not duplicate rows when a note is reprojected unchanged', () => {
    const note = notes.create({
      vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('stable text'),
    });
    const before = ftsTotal();

    index.reproject(note.id);
    index.reproject(note.id);

    expect(ftsTotal()).toBe(before);
    expect(ftsMatches('stable')).toBe(1);
  });

  it('leaves nothing behind when a note is purged', () => {
    const note = notes.create({
      vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('doomed text'),
    });
    notes.delete(note.id);
    notes.permanentDelete(note.id);

    expect(ftsMatches('doomed')).toBe(0);
    expect(ftsTotal()).toBe(0);
  });

  it('is idempotent — re-running migrations does not error or rebuild', () => {
    notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('persistent text') });
    const before = ftsTotal();

    runMigrations();

    expect(ftsTotal()).toBe(before);
    expect(ftsMatches('persistent')).toBe(1);
  });
});
