//! The local outbox: a change is kept only while some connection still needs it.
//! Call these inside the same transaction as the write they describe.

use rusqlite::{params, Connection};

use crate::hlc::Hlc;
use crate::Result;

/// First payload byte. Leaves room for encrypted payloads later.
pub const PAYLOAD_FORMAT_V1: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    BodyUpdate,
    FieldSet,
    Create,
}

impl ChangeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BodyUpdate => "body_update",
            Self::FieldSet => "field_set",
            Self::Create => "create",
        }
    }
}

pub struct NewChange<'a> {
    pub vault_id: &'a str,
    pub entity_type: &'a str,
    pub entity_id: &'a str,
    pub kind: ChangeKind,
    pub field: Option<&'a str>,
    pub hlc: &'a Hlc,
    pub author_device_id: &'a str,
    pub author_user_id: &'a str,
    pub payload: &'a [u8],
}

/// Store the change for every connection that sends this vault (two-way or
/// push). Returns its id, or None when no connection needs it.
pub fn record(conn: &Connection, change: &NewChange<'_>, now_ms: i64) -> Result<Option<String>> {
    let targets: Vec<String> = {
        let mut st = conn.prepare(
            "SELECT connection_id FROM vault_connections
             WHERE vault_id = ?1 AND mode IN ('two_way', 'push')",
        )?;
        let rows = st.query_map([change.vault_id], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    if targets.is_empty() {
        return Ok(None);
    }

    let id = nanoid::nanoid!();
    let mut payload = Vec::with_capacity(change.payload.len() + 1);
    payload.push(PAYLOAD_FORMAT_V1);
    payload.extend_from_slice(change.payload);

    conn.execute(
        "INSERT INTO changes (id, vault_id, entity_type, entity_id, kind, field, hlc,
                              author_device_id, author_user_id, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            change.vault_id,
            change.entity_type,
            change.entity_id,
            change.kind.as_str(),
            change.field,
            change.hlc.encode(),
            change.author_device_id,
            change.author_user_id,
            payload,
            now_ms,
        ],
    )?;
    for target in &targets {
        conn.execute(
            "INSERT INTO change_pending (change_id, connection_id) VALUES (?1, ?2)",
            params![id, target],
        )?;
    }
    Ok(Some(id))
}

/// A server confirmed the change. Drops it once no connection is owed it.
pub fn confirm(conn: &Connection, change_id: &str, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM change_pending WHERE change_id = ?1 AND connection_id = ?2",
        params![change_id, connection_id],
    )?;
    conn.execute(
        "DELETE FROM changes WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM change_pending WHERE change_id = ?1)",
        [change_id],
    )?;
    Ok(())
}

/// Ids still owed to a connection, oldest stamp first.
pub fn pending_for(conn: &Connection, connection_id: &str) -> Result<Vec<String>> {
    let mut st = conn.prepare(
        "SELECT c.id FROM change_pending p JOIN changes c ON c.id = p.change_id
         WHERE p.connection_id = ?1 ORDER BY c.hlc",
    )?;
    let rows = st.query_map([connection_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{migrate, sql};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate::run(&conn, sql::CORD).unwrap();
        conn
    }

    fn connect(conn: &Connection, vault: &str, connection: &str, mode: &str) {
        conn.execute(
            "INSERT INTO vault_connections (vault_id, connection_id, server_vault_id, mode, role, created_at)
             VALUES (?1, ?2, 'sv', ?3, 'owner', 1)",
            params![vault, connection, mode],
        )
        .unwrap();
    }

    fn title_change<'a>(hlc: &'a Hlc, payload: &'a [u8]) -> NewChange<'a> {
        NewChange {
            vault_id: "v1",
            entity_type: "note",
            entity_id: "n1",
            kind: ChangeKind::FieldSet,
            field: Some("title"),
            hlc,
            author_device_id: "dev",
            author_user_id: "u1",
            payload,
        }
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    fn stamp(wall: u64) -> Hlc {
        Hlc { wall, counter: 0, device: "dev".into() }
    }

    #[test]
    fn nothing_is_stored_without_a_sending_connection() {
        let conn = db();
        connect(&conn, "v1", "c-pull", "pull");
        connect(&conn, "v2", "c-other", "two_way");
        let id = record(&conn, &title_change(&stamp(1), b"x"), 1).unwrap();
        assert_eq!(id, None);
        assert_eq!(count(&conn, "changes"), 0);
    }

    #[test]
    fn stores_one_pending_row_per_sending_connection() {
        let conn = db();
        connect(&conn, "v1", "c-a", "two_way");
        connect(&conn, "v1", "c-b", "push");
        connect(&conn, "v1", "c-pull", "pull");
        let id = record(&conn, &title_change(&stamp(1), b"x"), 1).unwrap().unwrap();
        assert_eq!(pending_for(&conn, "c-a").unwrap(), std::slice::from_ref(&id));
        assert_eq!(pending_for(&conn, "c-b").unwrap(), [id]);
        assert!(pending_for(&conn, "c-pull").unwrap().is_empty());
    }

    #[test]
    fn payload_starts_with_the_format_byte() {
        let conn = db();
        connect(&conn, "v1", "c-a", "two_way");
        record(&conn, &title_change(&stamp(1), b"abc"), 1).unwrap();
        let payload: Vec<u8> = conn.query_row("SELECT payload FROM changes", [], |r| r.get(0)).unwrap();
        assert_eq!(payload, [PAYLOAD_FORMAT_V1, b'a', b'b', b'c']);
    }

    #[test]
    fn change_is_dropped_only_after_every_connection_confirms() {
        let conn = db();
        connect(&conn, "v1", "c-a", "two_way");
        connect(&conn, "v1", "c-b", "push");
        let id = record(&conn, &title_change(&stamp(1), b"x"), 1).unwrap().unwrap();
        confirm(&conn, &id, "c-a").unwrap();
        assert_eq!(count(&conn, "changes"), 1);
        confirm(&conn, &id, "c-b").unwrap();
        assert_eq!(count(&conn, "changes"), 0);
        assert_eq!(count(&conn, "change_pending"), 0);
    }

    #[test]
    fn pending_is_ordered_by_stamp() {
        let conn = db();
        connect(&conn, "v1", "c-a", "two_way");
        let late = record(&conn, &title_change(&stamp(50), b"x"), 1).unwrap().unwrap();
        let early = record(&conn, &title_change(&stamp(10), b"x"), 2).unwrap().unwrap();
        assert_eq!(pending_for(&conn, "c-a").unwrap(), [early, late]);
    }
}
