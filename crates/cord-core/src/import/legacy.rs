//! Reading a Cord 2.x `cord.db`. Only the import uses this.

use std::path::Path;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Value};

use crate::{Error, Result};

/// One row, keyed by column name (the SELECT's aliases).
pub type Row = Map<String, Value>;

/// Columns 2.x migrations added later. Without them the file predates 2.4.
const REQUIRED: [(&str, &str); 6] = [
    ("notes", "kind"),
    ("users", "pin_hash"),
    ("users", "failed_pin_attempts"),
    ("users", "recovery_key_hash"),
    ("tags", "deleted_at"),
    ("app_state", "key"),
];

/// Copy the old database and its WAL into `dir` and open the copy, so the
/// original is never written to, not even by a checkpoint.
pub fn open_copy(old: &Path, dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(dir)?;
    let copy = dir.join("legacy.db");
    for suffix in ["", "-wal", "-shm"] {
        let mut from = old.as_os_str().to_owned();
        from.push(suffix);
        let mut to = copy.as_os_str().to_owned();
        to.push(suffix);
        if Path::new(&from).is_file() {
            std::fs::copy(&from, &to)?;
        }
    }
    let conn = Connection::open(&copy)?;
    check(&conn)?;
    Ok(conn)
}

fn check(conn: &Connection) -> Result<()> {
    for (table, column) in REQUIRED {
        let found: i64 = conn.query_row(
            "SELECT count(*) FROM pragma_table_info(?1) WHERE name = ?2",
            [table, column],
            |r| r.get(0),
        )?;
        if found == 0 {
            return Err(Error::Invalid(format!(
                "this cord.db is older than Cord 2.4 (it has no {table}.{column}); open it once in Cord 2.4 first"
            )));
        }
    }
    Ok(())
}

/// Run one of the queries below and return its rows.
pub fn rows(conn: &Connection, sql: &str, params: &[&str]) -> Result<Vec<Row>> {
    let mut st = conn.prepare(sql)?;
    let names: Vec<String> = st.column_names().into_iter().map(str::to_owned).collect();
    let mut found = st.query(params_from_iter(params))?;
    let mut out = Vec::new();
    while let Some(r) = found.next()? {
        let mut row = Row::new();
        for (i, name) in names.iter().enumerate() {
            row.insert(name.clone(), json(r.get_ref(i)?)?);
        }
        out.push(row);
    }
    Ok(out)
}

pub fn count(conn: &Connection, sql: &str) -> Result<i64> {
    Ok(conn.query_row(sql, [], |r| r.get(0))?)
}

/// Insert a row into a machine-local table (`users`, `app_state`).
pub fn insert(conn: &Connection, table: &str, row: &Row) -> Result<()> {
    let cols: Vec<&str> = row.keys().map(String::as_str).collect();
    let marks: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let sql = format!("INSERT INTO {table} ({}) VALUES ({})", cols.join(", "), marks.join(", "));
    let values: Vec<SqlValue> = row.values().map(sql_value).collect();
    conn.execute(&sql, params_from_iter(values))?;
    Ok(())
}

fn json(v: ValueRef<'_>) -> Result<Value> {
    Ok(match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => return Err(Error::Invalid("the old database holds an unexpected blob".into())),
    })
}

fn sql_value(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n.as_i64().map_or_else(|| SqlValue::Real(n.as_f64().unwrap_or_default()), SqlValue::Integer),
        other => SqlValue::Text(other.as_str().map_or_else(|| other.to_string(), str::to_owned)),
    }
}

// The old SQL. Aliases are the new column names.
//
// Per-user queries take ?1 = the user, ?2 = who gets vaults with no (or an
// unknown) owner. Rows whose note is gone are left out: 2.x hard-deleted purged
// notes, and its UI never showed what pointed at them.

pub const USERS: &str = "SELECT id, username, password_hash, pin_hash, failed_pin_attempts, recovery_key_hash, created_at
    FROM users ORDER BY created_at, id";

pub const APP_STATE: &str = "SELECT key, value, updated_at FROM app_state";

pub const ALL_NOTES: &str = "SELECT count(*) FROM notes";

const OWNED: &str = "SELECT id FROM vaults
    WHERE (CASE WHEN user_id IN (SELECT id FROM users) THEN user_id ELSE ?2 END) = ?1";

pub fn vaults_sql() -> String {
    format!("SELECT id, name, description, color, created_at, updated_at, archived_at FROM vaults WHERE id IN ({OWNED})")
}

pub fn notes_sql() -> String {
    format!(
        "SELECT id, vault_id, title, kind, is_pinned, created_at, updated_at, deleted_at, body_json
         FROM notes WHERE vault_id IN ({OWNED})"
    )
}

pub fn tags_sql() -> String {
    format!("SELECT id, vault_id, name, color, created_at, deleted_at FROM tags WHERE vault_id IN ({OWNED})")
}

pub fn note_tags_sql() -> String {
    format!(
        "SELECT nt.note_id, nt.tag_id, n.vault_id, nt.created_at
         FROM note_tags nt JOIN notes n ON n.id = nt.note_id JOIN tags t ON t.id = nt.tag_id
         WHERE n.vault_id IN ({OWNED})"
    )
}

pub fn block_tags_sql() -> String {
    format!(
        "SELECT ft.fragment_id AS block_id, ft.tag_id, f.note_id, n.vault_id, ft.created_at
         FROM fragment_tags ft JOIN fragments f ON f.id = ft.fragment_id JOIN notes n ON n.id = f.note_id
         WHERE n.vault_id IN ({OWNED})"
    )
}

pub fn block_links_sql() -> String {
    format!(
        "SELECT fl.id, n.vault_id, fl.from_fragment_id AS from_block_id, f.note_id AS from_note_id,
                fl.to_note_id, fl.to_fragment_id AS to_block_id, fl.created_at
         FROM fragment_links fl JOIN fragments f ON f.id = fl.from_fragment_id JOIN notes n ON n.id = f.note_id
         WHERE n.vault_id IN ({OWNED})"
    )
}

pub fn attachments_sql() -> String {
    format!("SELECT id, vault_id, sha256, mime, size, created_at, deleted_at FROM attachments WHERE vault_id IN ({OWNED})")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::fixture::legacy;

    #[test]
    fn reads_rows_that_are_still_in_the_wal() {
        let old = legacy();
        old.user("u1", "ola", "hash", 1);
        assert!(old.root().join("cord.db-wal").metadata().unwrap().len() > 0, "the row is in the WAL");
        let staging = tempfile::tempdir().unwrap();
        let copy = open_copy(&old.root().join("cord.db"), staging.path()).unwrap();
        let users = rows(&copy, USERS, &[]).unwrap();
        assert_eq!(users.len(), 1);
        assert_eq!(users[0]["username"], "ola");
        assert_eq!(users[0]["failed_pin_attempts"], 0);
        assert_eq!(users[0]["pin_hash"], serde_json::Value::Null);
    }

    #[test]
    fn never_writes_to_the_original() {
        let old = legacy();
        old.user("u1", "ola", "hash", 1);
        let files = |p: &std::path::Path| -> Vec<Vec<u8>> {
            ["cord.db", "cord.db-wal"].iter().map(|f| std::fs::read(p.join(f)).unwrap()).collect()
        };
        let before = files(old.root());
        let staging = tempfile::tempdir().unwrap();
        let copy = open_copy(&old.root().join("cord.db"), staging.path()).unwrap();
        copy.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).unwrap();
        drop(copy);
        assert_eq!(files(old.root()), before);
    }

    #[test]
    fn refuses_a_database_from_before_2_4() {
        let old = legacy();
        old.exec("ALTER TABLE tags DROP COLUMN deleted_at;");
        let staging = tempfile::tempdir().unwrap();
        let e = open_copy(&old.root().join("cord.db"), staging.path()).err().unwrap();
        assert!(e.to_string().contains("Cord 2.4"), "{e}");
    }

    #[test]
    fn copies_rows_into_another_table() {
        let old = legacy();
        old.exec("INSERT INTO app_state VALUES ('last_user_id', 'u1', 5);");
        let staging = tempfile::tempdir().unwrap();
        let copy = open_copy(&old.root().join("cord.db"), staging.path()).unwrap();
        let to = Connection::open_in_memory().unwrap();
        to.execute_batch("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);").unwrap();
        for row in rows(&copy, APP_STATE, &[]).unwrap() {
            insert(&to, "app_state", &row).unwrap();
        }
        let v: String = to.query_row("SELECT value FROM app_state WHERE key = 'last_user_id'", [], |r| r.get(0)).unwrap();
        assert_eq!(v, "u1");
    }
}
