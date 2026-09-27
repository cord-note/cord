import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { freshDb, seedUser, seedVault } from './helpers';
import { getDb } from '../../db/client';
import { attachments, operationLog } from '../../db/schema';
import { AttachmentService } from '../AttachmentService';

// CORD_DB_PATH=:memory: — run with `bun test`, not Vitest. Files go to a fresh
// temp directory per test through CORD_ATTACHMENTS_DIR.

const USER_ID = 'attach-user';
const VAULT_ID = 'vault-attach-01';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const attachmentOps = (): { entityId: string; payloadJson: string }[] =>
  getDb().select().from(operationLog)
    .where(and(eq(operationLog.entityType, 'attachment'), eq(operationLog.operation, 'create')))
    .all();

describe('AttachmentService', () => {
  let dir: string;
  let service: AttachmentService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cord-attach-'));
    process.env['CORD_ATTACHMENTS_DIR'] = dir;
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    service = new AttachmentService();
  });

  afterEach(() => {
    delete process.env['CORD_ATTACHMENTS_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the file, records a row and logs the create without the bytes', () => {
    const a = service.create({ vaultId: VAULT_ID, mime: 'image/png', dataBase64: PNG.toString('base64') });

    expect(readFileSync(join(dir, `${a.id}.png`)).equals(PNG)).toBe(true);
    expect(a).toMatchObject({ vaultId: VAULT_ID, mime: 'image/png', size: PNG.length, deletedAt: null });
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(getDb().select().from(attachments).where(eq(attachments.id, a.id)).get()).toMatchObject({ id: a.id });

    const ops = attachmentOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.entityId).toBe(a.id);
    expect(ops[0]!.payloadJson).not.toContain(PNG.toString('base64'));
  });

  it('returns the existing attachment for the same bytes in the same vault', () => {
    const input = { vaultId: VAULT_ID, mime: 'image/png', dataBase64: PNG.toString('base64') };
    const first = service.create(input);
    const second = service.create(input);
    expect(second.id).toBe(first.id);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(attachmentOps()).toHaveLength(1);
  });

  it('stores the same bytes again for another vault', () => {
    seedVault('vault-attach-02', USER_ID);
    const data = PNG.toString('base64');
    const first = service.create({ vaultId: VAULT_ID, mime: 'image/png', dataBase64: data });
    const other = service.create({ vaultId: 'vault-attach-02', mime: 'image/png', dataBase64: data });
    expect(other.id).not.toBe(first.id);
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('uses the extension that matches the mime type', () => {
    const a = service.create({ vaultId: VAULT_ID, mime: 'image/jpeg', dataBase64: PNG.toString('base64') });
    expect(existsSync(join(dir, `${a.id}.jpg`))).toBe(true);
  });

  it('rejects unsupported types and oversized payloads', () => {
    expect(() => service.create({ vaultId: VAULT_ID, mime: 'text/html', dataBase64: 'PGI+' })).toThrow();
    const big = Buffer.alloc(25 * 1024 * 1024 + 1).toString('base64');
    expect(() => service.create({ vaultId: VAULT_ID, mime: 'image/png', dataBase64: big })).toThrow();
    expect(readdirSync(dir)).toHaveLength(0);
    expect(getDb().select().from(attachments).all()).toHaveLength(0);
  });
});
