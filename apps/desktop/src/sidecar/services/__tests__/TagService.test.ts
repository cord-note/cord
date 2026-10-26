import { describe, it, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser, seedVault } from './helpers';
import { TagService } from '../TagService';
import { FragmentService } from '../FragmentService';
import { NoteService } from '../NoteService';
import { getDb } from '../../db/client';
import { operationLog } from '../../db/schema';
import { DISTINCT_VAULT_COLORS } from '@shared/constants/vaultColors';

const USER  = 'u1';
const VAULT = 'v1';

describe('TagService', () => {
  let tags: TagService;
  let noteId: string;

  beforeEach(() => {
    freshDb();
    seedUser(USER);
    seedVault(VAULT, USER);
    tags = new TagService();
    noteId = new NoteService().create({ vaultId: VAULT, title: 'N' }).id;
  });

  it('gives a new tag a colour from the palette, least-used first', () => {
    const a = tags.create({ vaultId: VAULT, name: 'a' });
    const b = tags.create({ vaultId: VAULT, name: 'b' });
    expect(a.color).toBe(DISTINCT_VAULT_COLORS[0]!);
    expect(b.color).toBe(DISTINCT_VAULT_COLORS[1]!);
  });

  it('trims the name and returns the existing tag for a duplicate', () => {
    const a = tags.create({ vaultId: VAULT, name: '  work ' });
    expect(a.name).toBe('work');
    expect(tags.create({ vaultId: VAULT, name: 'work' }).id).toBe(a.id);
  });

  it('renames and recolours a tag, and logs it', () => {
    const a = tags.create({ vaultId: VAULT, name: 'a' });
    const updated = tags.update(a.id, { name: 'renamed', color: '#123456' });
    expect(updated.name).toBe('renamed');
    expect(updated.color).toBe('#123456');

    const ops = getDb().select().from(operationLog).where(eq(operationLog.entityId, a.id)).all();
    expect(ops.map((o) => o.operation)).toEqual(['create', 'update']);
  });

  it('refuses to rename onto another live tag', () => {
    tags.create({ vaultId: VAULT, name: 'a' });
    const b = tags.create({ vaultId: VAULT, name: 'b' });
    expect(() => tags.update(b.id, { name: 'a' })).toThrow();
  });

  it('can take the name of a deleted tag', () => {
    const a = tags.create({ vaultId: VAULT, name: 'a' });
    const b = tags.create({ vaultId: VAULT, name: 'b' });
    tags.delete(a.id);
    expect(tags.update(b.id, { name: 'a' }).name).toBe('a');
  });

  it('soft-deletes a tag and hides it everywhere', () => {
    const a = tags.create({ vaultId: VAULT, name: 'a' });
    tags.attach(noteId, a.id);
    tags.delete(a.id);

    expect(tags.list(VAULT)).toEqual([]);
    expect(tags.getForNote(noteId)).toEqual([]);
    expect(tags.getNoteMap(VAULT)).toEqual([]);
  });

  it('deletes a tag that is attached to a block', () => {
    const a = tags.create({ vaultId: VAULT, name: 'a' });
    const fragments = new FragmentService();
    fragments.attachTag('block-1', noteId, VAULT, a.id);

    expect(() => tags.delete(a.id)).not.toThrow();
    expect(fragments.getForNote(noteId)['block-1']?.tags ?? []).toEqual([]);
  });

  it('restores a deleted tag when one with the same name is created', () => {
    const a = tags.create({ vaultId: VAULT, name: 'a' });
    tags.delete(a.id);
    const again = tags.create({ vaultId: VAULT, name: 'a' });
    expect(again.id).toBe(a.id);
    expect(tags.list(VAULT).map((t) => t.id)).toEqual([a.id]);
  });

  it('logs attach and detach', () => {
    const a = tags.create({ vaultId: VAULT, name: 'a' });
    tags.attach(noteId, a.id);
    tags.detach(noteId, a.id);

    const ops = getDb().select().from(operationLog).where(eq(operationLog.entityId, noteId)).all();
    const actions = ops.map((o) => (JSON.parse(o.payloadJson) as { action?: string }).action);
    expect(actions).toContain('attachTag');
    expect(actions).toContain('detachTag');
  });
});
