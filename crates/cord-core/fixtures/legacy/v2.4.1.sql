-- Cord 2.4.1's cord.db, from apps/desktop/src/sidecar/db/migrations.ts on main.
-- Only the import tests use it. Keep it as 2.4.1 made it; never "fix" it.
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  pin_hash TEXT,
  failed_pin_attempts INTEGER DEFAULT 0 NOT NULL,
  recovery_key_hash TEXT
);
CREATE UNIQUE INDEX users_username_unique ON users (username);
CREATE TABLE vaults (
  id TEXT PRIMARY KEY NOT NULL, user_id TEXT, name TEXT NOT NULL, description TEXT, color TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER
);
CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL, title TEXT DEFAULT '' NOT NULL,
  body_json TEXT DEFAULT '{}' NOT NULL, kind TEXT DEFAULT 'note' NOT NULL,
  is_pinned INTEGER DEFAULT false NOT NULL, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX idx_notes_vault ON notes (vault_id, deleted_at);
CREATE TABLE note_links (
  id TEXT PRIMARY KEY NOT NULL, from_note_id TEXT NOT NULL, to_note_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_note_links ON note_links (from_note_id, to_note_id);
CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT,
  created_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE UNIQUE INDEX uq_tags_vault_name ON tags (vault_id, name);
CREATE TABLE note_tags (
  note_id TEXT NOT NULL, tag_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (note_id, tag_id)
);
CREATE TABLE fragments (
  id TEXT PRIMARY KEY NOT NULL, note_id TEXT NOT NULL, vault_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE fragment_tags (
  fragment_id TEXT NOT NULL, tag_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (fragment_id, tag_id)
);
CREATE TABLE fragment_links (
  id TEXT PRIMARY KEY NOT NULL, from_fragment_id TEXT NOT NULL, to_note_id TEXT, to_fragment_id TEXT,
  vault_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE operation_log (
  id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, synced_at INTEGER
);
CREATE TABLE blocks (
  id TEXT PRIMARY KEY NOT NULL, note_id TEXT NOT NULL, vault_id TEXT NOT NULL, type TEXT NOT NULL,
  sort INTEGER NOT NULL, level INTEGER, text TEXT DEFAULT '' NOT NULL, ref_block_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
