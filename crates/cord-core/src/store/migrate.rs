use rusqlite::Connection;

use crate::{Error, Result};

/// Apply every step past the file's `user_version`, one transaction each.
/// Step `i` (0-based) brings the file to version `i + 1`.
pub fn run(conn: &Connection, steps: &[&str]) -> Result<()> {
    let current = version(conn)?;
    let supported = steps.len() as i64;
    if current > supported {
        return Err(Error::TooNew { found: current, supported });
    }
    for (i, sql) in steps.iter().enumerate().skip(current as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const STEPS: &[&str] = &[
        "CREATE TABLE a (x INTEGER);",
        "ALTER TABLE a ADD COLUMN y INTEGER;",
    ];

    fn columns(conn: &Connection) -> Vec<String> {
        let mut st = conn.prepare("SELECT name FROM pragma_table_info('a')").unwrap();
        st.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn applies_all_steps_to_a_new_file() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn, STEPS).unwrap();
        assert_eq!(version(&conn).unwrap(), 2);
        assert_eq!(columns(&conn), ["x", "y"]);
    }

    #[test]
    fn running_again_is_a_no_op() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn, STEPS).unwrap();
        run(&conn, STEPS).unwrap();
        assert_eq!(version(&conn).unwrap(), 2);
    }

    #[test]
    fn applies_only_new_steps() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn, &STEPS[..1]).unwrap();
        assert_eq!(columns(&conn), ["x"]);
        run(&conn, STEPS).unwrap();
        assert_eq!(columns(&conn), ["x", "y"]);
    }

    #[test]
    fn a_failing_step_leaves_the_previous_version() {
        let conn = Connection::open_in_memory().unwrap();
        let broken: &[&str] = &[STEPS[0], "CREATE TABLE a (x INTEGER);"];
        assert!(run(&conn, broken).is_err());
        assert_eq!(version(&conn).unwrap(), 1);
    }

    #[test]
    fn refuses_a_file_from_a_newer_build() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 9).unwrap();
        assert!(matches!(run(&conn, STEPS), Err(Error::TooNew { found: 9, supported: 2 })));
    }
}
