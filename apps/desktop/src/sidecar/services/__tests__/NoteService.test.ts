import { describe, it, expect, beforeEach } from 'bun:test';
import { freshDb, seedUser, seedVault } from './helpers';
import { NoteService } from '../NoteService';

// CORD_DB_PATH=:memory: — run with `bun test`, not Vitest.

describe('NoteService', () => {
  let service: NoteService;
  const VAULT_ID = 'vault-test-01';
  const USER_ID  = 'note-test-user';

  beforeEach(() => {
    // Fresh :memory: database per test. The vault (and its owning user) must
    // exist first because notes.vault_id is a foreign key.
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    service = new NoteService();
  });

  it('creates a note with defaults', () => {
    const note = service.create({ vaultId: VAULT_ID });
    expect(note.id).toBeTruthy();
    expect(note.vaultId).toBe(VAULT_ID);
    expect(note.title).toBe('');
    expect(note.bodyJson).toBe('{}');
    expect(note.kind).toBe('note');
    expect(note.deletedAt).toBeNull();
    expect(note.isPinned).toBe(false);
  });

  it('creates a note with provided fields', () => {
    const note = service.create({
      vaultId:  VAULT_ID,
      title:    'Hello',
      bodyJson: '{"type":"doc","content":[{"type":"paragraph"}]}',
    });
    expect(note.title).toBe('Hello');
    expect(note.bodyJson).toContain('paragraph');
  });

  it('updates title and body', () => {
    const note = service.create({ vaultId: VAULT_ID, title: 'Old' });
    const updated = service.update(note.id, {
      title: 'New',
      bodyJson: '{"type":"doc","content":[{"type":"paragraph"}]}',
    });
    expect(updated.title).toBe('New');
    expect(updated.bodyJson).toContain('paragraph');
  });

  it('soft-deletes a note (sets deletedAt)', () => {
    const note = service.create({ vaultId: VAULT_ID });
    service.delete(note.id);
    const fetched = service.get(note.id);
    expect(fetched?.deletedAt).not.toBeNull();
  });

  it('excludes soft-deleted notes from list()', () => {
    const note = service.create({ vaultId: VAULT_ID });
    service.delete(note.id);
    const listed = service.list(VAULT_ID);
    expect(listed.some((n) => n.id === note.id)).toBe(false);
  });

  it('includes soft-deleted notes in listDeleted()', () => {
    const note = service.create({ vaultId: VAULT_ID });
    service.delete(note.id);
    const trash = service.listDeleted(VAULT_ID);
    expect(trash.some((n) => n.id === note.id)).toBe(true);
  });

  it('restores a soft-deleted note', () => {
    const note = service.create({ vaultId: VAULT_ID });
    service.delete(note.id);
    const restored = service.restore(note.id);
    expect(restored.deletedAt).toBeNull();
    const listed = service.list(VAULT_ID);
    expect(listed.some((n) => n.id === note.id)).toBe(true);
  });

  it('permanentDelete throws if note is not soft-deleted first', () => {
    const note = service.create({ vaultId: VAULT_ID });
    expect(() => service.permanentDelete(note.id)).toThrow();
  });

  it('permanentDelete succeeds on a soft-deleted note', () => {
    const note = service.create({ vaultId: VAULT_ID });
    service.delete(note.id);
    service.permanentDelete(note.id);
    expect(service.get(note.id)).toBeNull();
  });

  it('search returns notes matching title', () => {
    service.create({ vaultId: VAULT_ID, title: 'Quantum computing' });
    service.create({ vaultId: VAULT_ID, title: 'Cooking recipes' });
    const results = service.search(VAULT_ID, 'Quantum');
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe('Quantum computing');
  });

  it('pins and unpins a note', () => {
    const note = service.create({ vaultId: VAULT_ID });
    const pinned = service.update(note.id, { isPinned: true });
    expect(pinned.isPinned).toBe(true);
    const unpinned = service.update(note.id, { isPinned: false });
    expect(unpinned.isPinned).toBe(false);
  });
});
