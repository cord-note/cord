// Shared fixtures for sidecar service tests.
//
// Run with CORD_DB_PATH=:memory: — each helper assumes that env var is set so
// resetDb() yields a brand-new in-memory database rather than touching a file.
// Foreign keys are enforced (PRAGMA foreign_keys = ON), so a test that creates
// a vault must seed its user first, and a test that creates a note must seed
// its vault first.

import { getDb, resetDb } from '../../db/client';
import { runMigrations } from '../../db/migrations';
import { users, vaults } from '../../db/schema';

/** Drop the cached connection and apply the schema to a fresh database. */
export function freshDb(): void {
  resetDb();
  runMigrations();
}

/** Insert a user row so `vaults.user_id` foreign keys resolve. */
export function seedUser(id: string): void {
  getDb()
    .insert(users)
    .values({
      id,
      username:     id,
      passwordHash: 'test-hash',
      createdAt:    Date.now(),
    })
    .run();
}

/** Insert a vault row so `notes.vault_id` foreign keys resolve. */
export function seedVault(id: string, userId: string): void {
  const now = Date.now();
  getDb()
    .insert(vaults)
    .values({
      id,
      userId,
      name:      'Test Vault',
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
