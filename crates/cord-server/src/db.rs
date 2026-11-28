//! The server's one database file.

use std::path::Path;

use cord_core::rusqlite::{Connection, OptionalExtension};
use cord_core::store::migrate;

/// Append-only, like cord-core's steps.
const STEPS: &[&str] = &[V1];

const V1: &str = r#"
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE devices (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at   INTEGER
);

CREATE TABLE invites (
  code_hash  TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  used_by    TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE vaults (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seq        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE members (
  vault_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL,      -- 'owner' | 'editor'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, user_id)
);

CREATE TABLE changes (
  vault_id         TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  id               TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  kind             TEXT NOT NULL,
  field            TEXT,
  hlc              TEXT NOT NULL,
  author_device_id TEXT NOT NULL,
  author_user_id   TEXT NOT NULL,
  payload          BLOB NOT NULL,
  received_at      INTEGER NOT NULL,
  PRIMARY KEY (vault_id, seq),
  UNIQUE (vault_id, id)
);
"#;

pub const FILE: &str = "server.db";

/// Open (creating and migrating) `<dir>/server.db`.
pub fn open(dir: &Path) -> cord_core::Result<Connection> {
    std::fs::create_dir_all(dir)?;
    let conn = Connection::open(dir.join(FILE))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    migrate::run(&conn, STEPS)?;
    Ok(conn)
}

/// This server's id, made once.
pub fn server_id(conn: &Connection) -> cord_core::Result<String> {
    let found: Option<String> =
        conn.query_row("SELECT value FROM meta WHERE key = 'server_id'", [], |r| r.get(0)).optional()?;
    if let Some(id) = found {
        return Ok(id);
    }
    let id = nanoid::nanoid!();
    conn.execute("INSERT INTO meta (key, value) VALUES ('server_id', ?1)", [&id])?;
    Ok(id)
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_twice_and_keeps_its_id() {
        let dir = tempfile::tempdir().unwrap();
        let id = server_id(&open(dir.path()).unwrap()).unwrap();
        assert_eq!(server_id(&open(dir.path()).unwrap()).unwrap(), id);
    }
}
