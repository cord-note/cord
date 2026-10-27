//! Opening and migrating Cord's database files.

pub mod migrate;
pub(crate) mod sql;

use std::fmt;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

use crate::layout::DataLayout;
use crate::Result;

/// A raw 256-bit SQLCipher key. Unused until encryption is switched on.
pub struct DbKey([u8; 32]);

impl DbKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// SQLCipher's raw-key literal: `x'<64 hex>'`.
    fn literal(&self) -> String {
        let hex: String = self.0.iter().map(|b| format!("{b:02X}")).collect();
        format!("x'{hex}'")
    }
}

impl fmt::Debug for DbKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DbKey(..)")
    }
}

/// A user's open data: `cord.db` as `main`, `index.db` attached as `idx`.
pub struct UserDb {
    pub conn: Connection,
    /// True when `index.db` was created or rebuilt empty and must be re-derived.
    pub index_rebuilt: bool,
}

/// Open (creating and migrating) `machine.db`. Never encrypted.
pub fn open_machine(layout: &DataLayout) -> Result<Connection> {
    let path = layout.machine_db();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(&path)?;
    configure(&conn, None)?;
    migrate::run(&conn, sql::MACHINE)?;
    Ok(conn)
}

/// Open one user's files. The only way anything opens them.
pub fn open_user(layout: &DataLayout, user_id: &str, key: Option<&DbKey>) -> Result<UserDb> {
    std::fs::create_dir_all(layout.attachments_dir(user_id)?)?;

    let index_path = layout.index_db(user_id)?;
    let index_rebuilt = prepare_index(&index_path, key)?;

    let conn = Connection::open(layout.cord_db(user_id)?)?;
    configure(&conn, key)?;
    migrate::run(&conn, sql::CORD)?;

    // A raw key is not inherited by ATTACH, so it is passed explicitly.
    let index = index_path.to_string_lossy().into_owned();
    match key {
        Some(k) => conn.execute(&format!("ATTACH DATABASE ?1 AS idx KEY \"{}\"", k.literal()), [&index])?,
        None => conn.execute("ATTACH DATABASE ?1 AS idx", [&index])?,
    };

    Ok(UserDb { conn, index_rebuilt })
}

/// Key, WAL and busy timeout. Fails here, not later, on a wrong key.
fn configure(conn: &Connection, key: Option<&DbKey>) -> Result<()> {
    if let Some(key) = key {
        run_pragma(conn, &format!("PRAGMA key = \"{}\"", key.literal()))?;
    }
    conn.busy_timeout(Duration::from_secs(5))?;
    // A wrong key surfaces on the first read as "file is not a database".
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
    run_pragma(conn, "PRAGMA journal_mode = WAL")?;
    Ok(())
}

/// Run a pragma that may answer with a row (SQLCipher's `key` does).
fn run_pragma(conn: &Connection, sql: &str) -> Result<()> {
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query([])?;
    while rows.next()?.is_some() {}
    Ok(())
}

/// Make sure `index.db` exists at the current version. Returns true when it was
/// created or rebuilt and so holds nothing yet.
fn prepare_index(path: &Path, key: Option<&DbKey>) -> Result<bool> {
    {
        let conn = Connection::open(path)?;
        configure(&conn, key)?;
        match migrate::version(&conn)? {
            v if v == sql::INDEX_VERSION => return Ok(false),
            0 => {
                create_index(&conn)?;
                return Ok(true);
            }
            _ => {} // other version: fall through and rebuild
        }
    }
    for suffix in ["", "-wal", "-shm"] {
        let mut file = path.as_os_str().to_owned();
        file.push(suffix);
        match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    let conn = Connection::open(path)?;
    configure(&conn, key)?;
    create_index(&conn)?;
    Ok(true)
}

fn create_index(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(sql::INDEX)?;
    tx.pragma_update(None, "user_version", sql::INDEX_VERSION)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Error;

    fn layout() -> (tempfile::TempDir, DataLayout) {
        let dir = tempfile::tempdir().unwrap();
        let layout = DataLayout::new(dir.path());
        (dir, layout)
    }

    #[test]
    fn opens_machine_db_and_migrates_it() {
        let (_d, l) = layout();
        let conn = open_machine(&l).unwrap();
        assert_eq!(migrate::version(&conn).unwrap(), sql::MACHINE.len() as i64);
        assert!(l.machine_db().exists());
    }

    #[test]
    fn opens_user_files_and_creates_folders() {
        let (_d, l) = layout();
        let db = open_user(&l, "u1", None).unwrap();
        assert!(db.index_rebuilt);
        assert!(l.cord_db("u1").unwrap().exists());
        assert!(l.index_db("u1").unwrap().exists());
        assert!(l.attachments_dir("u1").unwrap().is_dir());
        // Both files answer on one connection.
        db.conn.execute("INSERT INTO vaults (id, name, created_at, updated_at) VALUES ('v', 'V', 1, 1)", []).unwrap();
        db.conn.execute("INSERT INTO idx.note_docs VALUES ('n', 'v', '{}', 1)", []).unwrap();
    }

    #[test]
    fn reopening_keeps_the_index() {
        let (_d, l) = layout();
        drop(open_user(&l, "u1", None).unwrap());
        let db = open_user(&l, "u1", None).unwrap();
        assert!(!db.index_rebuilt);
    }

    #[test]
    fn an_index_from_another_version_is_rebuilt_empty() {
        let (_d, l) = layout();
        {
            let db = open_user(&l, "u1", None).unwrap();
            db.conn.execute("INSERT INTO idx.note_docs VALUES ('n', 'v', '{}', 1)", []).unwrap();
            db.conn.pragma_update(Some(rusqlite::DatabaseName::Attached("idx")), "user_version", 99).unwrap();
        }
        let db = open_user(&l, "u1", None).unwrap();
        assert!(db.index_rebuilt);
        let rows: i64 = db.conn.query_row("SELECT count(*) FROM idx.note_docs", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn rejects_a_bad_user_id() {
        let (_d, l) = layout();
        assert!(matches!(open_user(&l, "../x", None), Err(Error::BadId(_))));
    }

    #[test]
    fn a_key_encrypts_both_files_and_is_required_to_reopen() {
        let (_d, l) = layout();
        let key = DbKey::from_bytes([7; 32]);
        {
            let db = open_user(&l, "u1", Some(&key)).unwrap();
            db.conn.execute("INSERT INTO notes (id, vault_id, title, created_at, updated_at) VALUES ('n', 'v', 'secret-title', 1, 1)", []).unwrap();
            db.conn.execute("INSERT INTO idx.note_docs VALUES ('n', 'v', 'secret-body', 1)", []).unwrap();
            run_pragma(&db.conn, "PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
            run_pragma(&db.conn, "PRAGMA idx.wal_checkpoint(TRUNCATE)").unwrap();
        }
        for (file, secret) in [(l.cord_db("u1").unwrap(), "secret-title"), (l.index_db("u1").unwrap(), "secret-body")] {
            let bytes = std::fs::read(&file).unwrap();
            assert!(!bytes.windows(secret.len()).any(|w| w == secret.as_bytes()), "{file:?} holds plain text");
        }
        assert!(open_user(&l, "u1", None).is_err());
        assert!(open_user(&l, "u1", Some(&DbKey::from_bytes([8; 32]))).is_err());
        let db = open_user(&l, "u1", Some(&key)).unwrap();
        assert!(!db.index_rebuilt);
        let title: String = db.conn.query_row("SELECT title FROM notes", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "secret-title");
    }
}
