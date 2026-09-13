import { nanoid } from 'nanoid';
import { operationLog } from '../db/schema';
import type { EntityType, OperationType } from '@shared/types';
import type { getDb } from '../db/client';

// Accepts either the db singleton or a transaction object — both have .insert().
//
// The transaction type is derived from the singleton's own .transaction()
// callback rather than imported, so it cannot drift from whatever driver
// getDb() returns. Spelling the union out is load-bearing: drizzle 0.45 added
// `$client` to the database type, which a transaction does not carry, so the
// two are no longer structurally interchangeable the way they were on 0.30.
type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Transaction;

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
