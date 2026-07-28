import { nanoid } from 'nanoid';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { vaults } from '../db/schema';
import { logOp } from './oplog';
import type { Vault, CreateVaultInput, UpdateVaultInput } from '@shared/types';

export class VaultService {
  list(userId: string): Vault[] {
    const db = getDb();
    return db
      .select()
      .from(vaults)
      .where(and(isNull(vaults.archivedAt), eq(vaults.userId, userId)))
      .all()
      .map(toVault);
  }

  create(input: CreateVaultInput & { userId: string }): Vault {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();

    return db.transaction((tx) => {
      tx.insert(vaults).values({
        id,
        userId:      input.userId,
        name:        input.name,
        description: input.description ?? null,
        color:       input.color ?? null,
        createdAt:   now,
        updatedAt:   now,
      }).run();

      const row = tx.select().from(vaults).where(eq(vaults.id, id)).get();
      if (!row) throw new Error(`Vault not found after insert: ${id}`);
      const vault = toVault(row);

      logOp(tx, id, 'vault', id, 'create', vault);
      return vault;
    });
  }

  update(id: string, input: UpdateVaultInput): Vault {
    const db = getDb();
    const now = Date.now();

    return db.transaction((tx) => {
      tx.update(vaults)
        .set({
          ...(input.name        !== undefined && { name:        input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.color       !== undefined && { color:       input.color }),
          updatedAt: now,
        })
        .where(eq(vaults.id, id))
        .run();

      const row = tx.select().from(vaults).where(eq(vaults.id, id)).get();
      if (!row) throw new Error(`Vault not found: ${id}`);
      const vault = toVault(row);

      logOp(tx, vault.id, 'vault', id, 'update', vault);
      return vault;
    });
  }

  archive(id: string): void {
    const db = getDb();
    const now = Date.now();

    db.transaction((tx) => {
      tx.update(vaults)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(vaults.id, id))
        .run();

      const row = tx.select().from(vaults).where(eq(vaults.id, id)).get();
      if (!row) throw new Error(`Vault not found: ${id}`);

      logOp(tx, id, 'vault', id, 'delete', toVault(row));
    });
  }

  getById(id: string): Vault | null {
    const db = getDb();
    const row = db.select().from(vaults).where(eq(vaults.id, id)).get();
    return row ? toVault(row) : null;
  }
}

function toVault(row: typeof vaults.$inferSelect): Vault {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description,
    color:       row.color,
    createdAt:   row.createdAt,
    updatedAt:   row.updatedAt,
    archivedAt:  row.archivedAt,
  };
}
