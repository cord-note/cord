//! Schema SQL for the three files. Migration steps are append-only: never edit
//! a shipped step, add a new one.

/// `machine.db` — what the lock screen needs before anyone unlocks.
pub const MACHINE: &[&str] = &[MACHINE_V1];

/// `users/<id>/cord.db` — authored data and local-only sync tables.
pub const CORD: &[&str] = &[CORD_V1];

/// `users/<id>/index.db` is derived and never migrated: a different version
/// means the file is deleted and rebuilt.
pub const INDEX_VERSION: i64 = 1;

const MACHINE_V1: &str = r#"
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  pin_hash            TEXT,
  failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
  recovery_key_hash   TEXT,
  created_at          INTEGER NOT NULL
);

-- Encryption prep: empty while encryption is off.
CREATE TABLE key_wraps (
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,          -- 'password' | 'recovery'
  wrapped_key BLOB NOT NULL,
  salt        BLOB NOT NULL,
  params      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
"#;

const CORD_V1: &str = r#"
-- Synced tables. No foreign keys: changes arrive in any order.

CREATE TABLE vaults (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'note',   -- 'note' | 'notepad'
  is_pinned  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  purged_at  INTEGER
);
CREATE INDEX idx_notes_vault ON notes (vault_id, deleted_at);

CREATE TABLE note_bodies (
  note_id    TEXT PRIMARY KEY,
  yjs_state  BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_tags_vault_name ON tags (vault_id, lower(name));

CREATE TABLE note_tags (
  note_id    TEXT NOT NULL,
  tag_id     TEXT NOT NULL,
  vault_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX idx_note_tags_tag ON note_tags (tag_id);

CREATE TABLE block_tags (
  block_id   TEXT NOT NULL,
  tag_id     TEXT NOT NULL,
  note_id    TEXT NOT NULL,
  vault_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (block_id, tag_id)
);
CREATE INDEX idx_block_tags_note ON block_tags (note_id);
CREATE INDEX idx_block_tags_tag ON block_tags (tag_id);

CREATE TABLE block_links (
  id            TEXT PRIMARY KEY,
  vault_id      TEXT NOT NULL,
  from_block_id TEXT NOT NULL,
  from_note_id  TEXT NOT NULL,
  to_note_id    TEXT,
  to_block_id   TEXT,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_block_links_from ON block_links (from_note_id);
CREATE INDEX idx_block_links_to ON block_links (to_note_id);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_attachments_vault_hash ON attachments (vault_id, sha256);

CREATE TABLE field_clocks (
  entity_id TEXT NOT NULL,
  field     TEXT NOT NULL,
  hlc       TEXT NOT NULL,
  PRIMARY KEY (entity_id, field)
) WITHOUT ROWID;

-- Local-only tables. Never synced.

CREATE TABLE changes (
  id               TEXT PRIMARY KEY,
  vault_id         TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  kind             TEXT NOT NULL,     -- 'body_update' | 'field_set' | 'create'
  field            TEXT,
  hlc              TEXT NOT NULL,
  author_device_id TEXT NOT NULL,
  author_user_id   TEXT NOT NULL,
  payload          BLOB NOT NULL,     -- first byte is the payload format
  created_at       INTEGER NOT NULL,
  rejected_at      INTEGER,
  reject_reason    TEXT
);

CREATE TABLE change_pending (
  change_id     TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  PRIMARY KEY (change_id, connection_id)
) WITHOUT ROWID;
CREATE INDEX idx_change_pending_conn ON change_pending (connection_id);

CREATE TABLE connections (
  id               TEXT PRIMARY KEY,
  url              TEXT NOT NULL,
  label            TEXT,
  username         TEXT NOT NULL,
  server_user_id   TEXT,
  token            TEXT,
  cert_fingerprint TEXT,
  paused           INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'offline',
  last_sync_at     INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE vault_connections (
  vault_id        TEXT NOT NULL,
  connection_id   TEXT NOT NULL,
  server_vault_id TEXT NOT NULL,
  mode            TEXT NOT NULL,      -- 'two_way' | 'push' | 'pull'
  role            TEXT NOT NULL,      -- 'owner' | 'editor' | 'viewer'
  bookmark        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (vault_id, connection_id)
);
"#;

pub const INDEX: &str = r#"
CREATE TABLE note_docs (
  note_id           TEXT PRIMARY KEY,
  vault_id          TEXT NOT NULL,
  body_json         TEXT NOT NULL,
  source_updated_at INTEGER NOT NULL
);

CREATE TABLE blocks (
  id           TEXT PRIMARY KEY,
  note_id      TEXT NOT NULL,
  vault_id     TEXT NOT NULL,
  type         TEXT NOT NULL,
  sort         INTEGER NOT NULL,
  level        INTEGER,
  text         TEXT NOT NULL DEFAULT '',
  ref_block_id TEXT
);
CREATE INDEX idx_blocks_note ON blocks (note_id, sort);
CREATE INDEX idx_blocks_type ON blocks (vault_id, type);
CREATE INDEX idx_blocks_ref ON blocks (ref_block_id);

CREATE VIRTUAL TABLE blocks_fts USING fts5(
  text,
  content='blocks',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER blocks_fts_ai AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- External-content FTS cannot recover old text; removals must pass it in.
CREATE TRIGGER blocks_fts_ad AFTER DELETE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER blocks_fts_au AFTER UPDATE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE note_links (
  from_note_id TEXT NOT NULL,
  to_note_id   TEXT NOT NULL,
  PRIMARY KEY (from_note_id, to_note_id)
) WITHOUT ROWID;
CREATE INDEX idx_note_links_to ON note_links (to_note_id);

CREATE TABLE index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::migrate;
    use rusqlite::Connection;

    fn tables(conn: &Connection) -> Vec<String> {
        let mut st = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'blocks_fts%' ORDER BY name")
            .unwrap();
        st.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn machine_schema_creates_its_tables() {
        let conn = Connection::open_in_memory().unwrap();
        migrate::run(&conn, MACHINE).unwrap();
        assert_eq!(tables(&conn), ["app_state", "key_wraps", "users"]);
    }

    #[test]
    fn cord_schema_creates_its_tables() {
        let conn = Connection::open_in_memory().unwrap();
        migrate::run(&conn, CORD).unwrap();
        assert_eq!(
            tables(&conn),
            [
                "attachments", "block_links", "block_tags", "change_pending", "changes",
                "connections", "field_clocks", "note_bodies", "note_tags", "notes",
                "tags", "vault_connections", "vaults",
            ]
        );
    }

    #[test]
    fn cord_schema_has_no_foreign_keys() {
        let conn = Connection::open_in_memory().unwrap();
        migrate::run(&conn, CORD).unwrap();
        let fks: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master m, pragma_foreign_key_list(m.name) WHERE m.type = 'table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fks, 0);
    }

    #[test]
    fn index_schema_keeps_search_in_step_with_blocks() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(INDEX).unwrap();
        conn.execute(
            "INSERT INTO blocks (id, note_id, vault_id, type, sort, text) VALUES ('b1', 'n1', 'v1', 'paragraph', 0, 'hello world')",
            [],
        )
        .unwrap();
        let hits = |q: &str| -> i64 {
            conn.query_row("SELECT count(*) FROM blocks_fts WHERE blocks_fts MATCH ?1", [q], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(hits("\"llo wo\""), 1);
        conn.execute("UPDATE blocks SET text = 'goodbye' WHERE id = 'b1'", []).unwrap();
        assert_eq!(hits("\"llo wo\""), 0);
        assert_eq!(hits("\"oodby\""), 1);
        conn.execute("DELETE FROM blocks WHERE id = 'b1'", []).unwrap();
        assert_eq!(hits("\"oodby\""), 0);
    }
}
