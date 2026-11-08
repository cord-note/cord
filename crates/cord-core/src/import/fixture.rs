//! Old Cord 2.4.1 installs for the import tests.

use std::path::Path;

use rusqlite::{params, Connection};

pub const SCHEMA: &str = include_str!("../../fixtures/legacy/v2.4.1.sql");

/// A data directory holding a 2.4.1 `cord.db`. The connection stays open with
/// checkpoints off, so writes sit in `cord.db-wal` as on a real install.
pub struct Legacy {
    pub dir: tempfile::TempDir,
    pub conn: Connection,
}

pub fn legacy() -> Legacy {
    let dir = tempfile::tempdir().unwrap();
    let conn = Connection::open(dir.path().join("cord.db")).unwrap();
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(())).unwrap();
    conn.execute_batch("PRAGMA wal_autocheckpoint = 0;").unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    Legacy { dir, conn }
}

impl Legacy {
    pub fn root(&self) -> &Path {
        self.dir.path()
    }

    pub fn exec(&self, sql: &str) {
        self.conn.execute_batch(sql).unwrap();
    }

    pub fn user(&self, id: &str, name: &str, password_hash: &str, created_at: i64) {
        self.conn
            .execute(
                "INSERT INTO users (id, username, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, password_hash, created_at],
            )
            .unwrap();
    }

    pub fn vault(&self, id: &str, user_id: Option<&str>, name: &str) {
        self.conn
            .execute(
                "INSERT INTO vaults (id, user_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, 10, 20)",
                params![id, user_id, name],
            )
            .unwrap();
    }

    /// A note with a fixed history: created at 100, last edited at 200.
    pub fn note(&self, id: &str, vault_id: &str, title: &str, body_json: &str) {
        self.conn
            .execute(
                "INSERT INTO notes (id, vault_id, title, body_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 100, 200)",
                params![id, vault_id, title, body_json],
            )
            .unwrap();
    }
}

/// A body of one paragraph with a block id.
pub fn para(block_id: &str, text: &str) -> String {
    serde_json::json!({ "type": "doc", "content": [
        { "type": "paragraph", "attrs": { "blockId": block_id }, "content": [{ "type": "text", "text": text }] }
    ]})
    .to_string()
}
