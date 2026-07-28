import { nanoid } from 'nanoid';
import { operationLog } from '../db/schema';
import type { EntityType, OperationType } from '@shared/types';
import type { getDb } from '../db/client';

// Accepts either the db singleton or a transaction object — both have .insert().
type Db = ReturnType<typeof getDb>;

export function logOp(
  db: Db,
  vaultId: string,
  entityType: EntityType,
  entityId: string,
  operation: OperationType,
  payload: unknown,
): void {
  db.insert(operationLog).values({
    id:          nanoid(),
    vaultId,
    entityType,
    entityId,
    operation,
    payloadJson: JSON.stringify(payload),
    createdAt:   Date.now(),
    syncedAt:    null,
  }).run();
}
