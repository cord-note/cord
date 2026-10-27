//! Per-field clock stamps for last-edit-wins.

use rusqlite::{params, Connection, OptionalExtension};

use crate::hlc::Hlc;
use crate::Result;

pub fn get(conn: &Connection, entity_id: &str, field: &str) -> Result<Option<Hlc>> {
    let text: Option<String> = conn
        .query_row(
            "SELECT hlc FROM field_clocks WHERE entity_id = ?1 AND field = ?2",
            params![entity_id, field],
            |r| r.get(0),
        )
        .optional()?;
    text.map(|t| Hlc::parse(&t)).transpose()
}

/// Store `hlc` for the field if it is newer than what is there.
/// Returns true when it won — the caller then applies the value.
pub fn set_if_newer(conn: &Connection, entity_id: &str, field: &str, hlc: &Hlc) -> Result<bool> {
    // Text comparison orders stamps the same way as Hlc's Ord.
    let changed = conn.execute(
        "INSERT INTO field_clocks (entity_id, field, hlc) VALUES (?1, ?2, ?3)
         ON CONFLICT (entity_id, field) DO UPDATE SET hlc = excluded.hlc
         WHERE excluded.hlc > field_clocks.hlc",
        params![entity_id, field, hlc.encode()],
    )?;
    Ok(changed == 1)
}

/// The newest stamp on record, for resuming the clock after a restart.
pub fn latest(conn: &Connection) -> Result<Option<Hlc>> {
    let text: Option<String> =
        conn.query_row("SELECT max(hlc) FROM field_clocks", [], |r| r.get(0))?;
    text.map(|t| Hlc::parse(&t)).transpose()
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

    fn h(wall: u64, counter: u32, device: &str) -> Hlc {
        Hlc { wall, counter, device: device.into() }
    }

    #[test]
    fn first_write_wins_and_is_readable() {
        let conn = db();
        assert!(set_if_newer(&conn, "n1", "title", &h(10, 0, "a")).unwrap());
        assert_eq!(get(&conn, "n1", "title").unwrap(), Some(h(10, 0, "a")));
        assert_eq!(get(&conn, "n1", "kind").unwrap(), None);
    }

    #[test]
    fn older_stamp_loses_and_changes_nothing() {
        let conn = db();
        set_if_newer(&conn, "n1", "title", &h(20, 0, "a")).unwrap();
        assert!(!set_if_newer(&conn, "n1", "title", &h(10, 5, "z")).unwrap());
        assert_eq!(get(&conn, "n1", "title").unwrap(), Some(h(20, 0, "a")));
    }

    #[test]
    fn newer_stamp_wins() {
        let conn = db();
        set_if_newer(&conn, "n1", "title", &h(20, 0, "a")).unwrap();
        assert!(set_if_newer(&conn, "n1", "title", &h(20, 1, "a")).unwrap());
    }

    #[test]
    fn equal_time_is_broken_by_device_id() {
        let conn = db();
        set_if_newer(&conn, "n1", "title", &h(20, 0, "b")).unwrap();
        assert!(!set_if_newer(&conn, "n1", "title", &h(20, 0, "a")).unwrap());
        assert!(set_if_newer(&conn, "n1", "title", &h(20, 0, "c")).unwrap());
    }

    #[test]
    fn the_same_stamp_twice_is_not_a_second_win() {
        let conn = db();
        set_if_newer(&conn, "n1", "title", &h(20, 0, "a")).unwrap();
        assert!(!set_if_newer(&conn, "n1", "title", &h(20, 0, "a")).unwrap());
    }

    #[test]
    fn fields_are_independent() {
        let conn = db();
        set_if_newer(&conn, "n1", "title", &h(20, 0, "a")).unwrap();
        assert!(set_if_newer(&conn, "n1", "is_pinned", &h(5, 0, "a")).unwrap());
    }

    #[test]
    fn latest_is_the_newest_across_all_fields() {
        let conn = db();
        assert_eq!(latest(&conn).unwrap(), None);
        set_if_newer(&conn, "n1", "title", &h(20, 0, "a")).unwrap();
        set_if_newer(&conn, "n2", "title", &h(30, 2, "b")).unwrap();
        set_if_newer(&conn, "n3", "title", &h(30, 1, "z")).unwrap();
        assert_eq!(latest(&conn).unwrap(), Some(h(30, 2, "b")));
    }
}
