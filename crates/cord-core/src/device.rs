//! This install's id, kept in machine.db. Never synced.

use rusqlite::{params, Connection, OptionalExtension};

use crate::Result;

const KEY: &str = "device_id";

/// The device id, created on first call.
pub fn device_id(machine: &Connection, now_ms: i64) -> Result<String> {
    let existing: Option<String> = machine
        .query_row("SELECT value FROM app_state WHERE key = ?1", [KEY], |r| r.get(0))
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = nanoid::nanoid!();
    machine.execute(
        "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3)",
        params![KEY, id, now_ms],
    )?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::DataLayout;
    use crate::store::open_machine;

    #[test]
    fn is_created_once_and_then_stable() {
        let dir = tempfile::tempdir().unwrap();
        let layout = DataLayout::new(dir.path());
        let first = {
            let conn = open_machine(&layout).unwrap();
            let id = device_id(&conn, 1).unwrap();
            assert_eq!(device_id(&conn, 2).unwrap(), id);
            id
        };
        let conn = open_machine(&layout).unwrap();
        assert_eq!(device_id(&conn, 3).unwrap(), first);
        assert_eq!(first.len(), 21);
    }
}
