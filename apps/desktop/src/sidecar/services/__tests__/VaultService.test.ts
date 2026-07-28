import { describe, it, expect, beforeEach } from 'bun:test';
import { freshDb, seedUser } from './helpers';
import { VaultService } from '../VaultService';

// CORD_DB_PATH=:memory: is set in the bun test command. Tests run with
// `bun test` (not Vitest) because bun:sqlite is a Bun-native module
// unavailable in Node.js pools.

describe('VaultService', () => {
  let service: VaultService;
  const TEST_USER_ID  = 'test-user-01';
  const OTHER_USER_ID = 'other-user';

  beforeEach(() => {
    // Fresh :memory: database per test — without this the cached connection
    // would leak vaults between tests and break the isolation assertions.
    // Both users are seeded because vaults.user_id is a foreign key.
    freshDb();
    seedUser(TEST_USER_ID);
    seedUser(OTHER_USER_ID);
    service = new VaultService();
  });

  it('creates a vault and returns it', () => {
    const vault = service.create({ name: 'My Vault', userId: TEST_USER_ID });
    expect(vault.id).toBeTruthy();
    expect(vault.name).toBe('My Vault');
    expect(vault.archivedAt).toBeNull();
  });

  it('lists only non-archived vaults for the user', () => {
    service.create({ name: 'Active',   userId: TEST_USER_ID });
    const archived = service.create({ name: 'Archived', userId: TEST_USER_ID });
    service.archive(archived.id);

    const listed = service.list(TEST_USER_ID);
    expect(listed.every((v) => v.archivedAt === null)).toBe(true);
    expect(listed.some((v) => v.id === archived.id)).toBe(false);
  });

  it('updates a vault field', () => {
    const vault = service.create({ name: 'Old Name', userId: TEST_USER_ID });
    const updated = service.update(vault.id, { name: 'New Name' });
    expect(updated.name).toBe('New Name');
    expect(updated.id).toBe(vault.id);
  });

  it('archives a vault (sets archivedAt)', () => {
    const vault = service.create({ name: 'To archive', userId: TEST_USER_ID });
    service.archive(vault.id);
    const fetched = service.getById(vault.id);
    expect(fetched?.archivedAt).not.toBeNull();
  });

  it('does not list vaults belonging to another user', () => {
    service.create({ name: 'Other user vault', userId: OTHER_USER_ID });
    const listed = service.list(TEST_USER_ID);
    expect(listed.length).toBe(0);
  });
});
