import { nanoid } from 'nanoid';
import { and, eq, isNull } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb, resolveAttachmentsDir } from '../db/client';
import { attachments } from '../db/schema';
import { logOp } from './oplog';
import type { Attachment, CreateAttachmentInput } from '@shared/types';

/** Image types an attachment may have, and the extension its file gets. */
const EXTENSIONS: Record<string, string> = {
  'image/png':     'png',
  'image/jpeg':    'jpg',
  'image/gif':     'gif',
  'image/webp':    'webp',
  'image/svg+xml': 'svg',
  'image/avif':    'avif',
};

const MAX_BYTES = 25 * 1024 * 1024;

export class AttachmentService {
  /**
   * Store an image and return its row. The same bytes in the same vault return
   * the existing attachment, so pasting an image twice keeps one file.
   *
   * The file is written before the row is inserted: a failed write leaves no
   * row pointing at nothing. The op-log payload is the row, never the bytes.
   */
  create(input: CreateAttachmentInput): Attachment {
    const ext = EXTENSIONS[input.mime];
    if (!ext) throw new Error(`Unsupported attachment type: ${input.mime}`);

    const bytes = Buffer.from(input.dataBase64, 'base64');
    if (bytes.length > MAX_BYTES) throw new Error(`Attachment too large: ${bytes.length} bytes`);

    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const db = getDb();

    const existing = db.select().from(attachments)
      .where(and(eq(attachments.vaultId, input.vaultId), eq(attachments.sha256, sha256), isNull(attachments.deletedAt)))
      .get();
    if (existing) return existing;

    const attachment: Attachment = {
      id: nanoid(),
      vaultId: input.vaultId,
      mime: input.mime,
      size: bytes.length,
      sha256,
      createdAt: Date.now(),
      deletedAt: null,
    };

    const dir = resolveAttachmentsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${attachment.id}.${ext}`), bytes);

    return db.transaction((tx) => {
      tx.insert(attachments).values(attachment).run();
      logOp(tx, attachment.vaultId, 'attachment', attachment.id, 'create', attachment);
      return attachment;
    });
  }
}
