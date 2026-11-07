//! Builds `index.db` (attached as `idx`) from `cord.db`. Nothing here is
//! authored data: rows are replaced wholesale and can always be rebuilt.

use rusqlite::{params, Connection, OptionalExtension};

use crate::doc::blocks::extract_blocks;
use crate::doc::helpers::wiki_link_targets;
use crate::doc::yjs::state_to_json;
use crate::Result;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub indexed: usize,
    pub removed: usize,
    /// Notes whose body could not be read. Their old rows are kept.
    pub failed: Vec<String>,
}

/// Rebuild one note's rows. A note with no body (purged, or not yet synced)
/// ends up with none. Safe inside or outside a transaction.
pub fn reindex_note(conn: &Connection, note_id: &str) -> Result<()> {
    let row: Option<(String, Vec<u8>, i64)> = conn
        .query_row(
            "SELECT n.vault_id, b.yjs_state, b.updated_at
             FROM notes n JOIN note_bodies b ON b.note_id = n.id WHERE n.id = ?1",
            [note_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    in_savepoint(conn, || {
        clear(conn, note_id)?;
        let Some((vault_id, state, updated_at)) = row else {
            return Ok(());
        };
        let doc = state_to_json(&state)?;
        conn.execute(
            "INSERT INTO idx.note_docs (note_id, vault_id, body_json, source_updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![note_id, vault_id, doc.to_string(), updated_at],
        )?;
        for b in extract_blocks(&doc, note_id) {
            let insert = |id: &str| {
                conn.execute(
                    "INSERT INTO idx.blocks (id, note_id, vault_id, type, sort, level, text, ref_block_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (id) DO NOTHING",
                    params![id, note_id, vault_id, b.kind, b.sort, b.level, b.text, b.ref_block_id],
                )
            };
            // Another note already holds this id (a pasted block): index it under
            // the synthetic id instead, the same rule as for in-note duplicates.
            if insert(&b.id)? == 0 {
                insert(&format!("{note_id}:{}", b.sort))?;
            }
        }
        for target in wiki_link_targets(&doc) {
            if target != note_id {
                conn.execute(
                    "INSERT OR IGNORE INTO idx.note_links (from_note_id, to_note_id) VALUES (?1, ?2)",
                    params![note_id, target],
                )?;
            }
        }
        Ok(())
    })
}

/// Reindex notes whose body changed since they were indexed, and drop rows of
/// notes that no longer have a body. Proportional to what changed.
pub fn reindex_stale(conn: &Connection) -> Result<Report> {
    let mut report = Report::default();
    let orphans = column(
        conn,
        "SELECT d.note_id FROM idx.note_docs d
         LEFT JOIN note_bodies b ON b.note_id = d.note_id WHERE b.note_id IS NULL",
    )?;
    for id in orphans {
        clear(conn, &id)?;
        report.removed += 1;
    }
    let stale = column(
        conn,
        "SELECT n.id FROM notes n JOIN note_bodies b ON b.note_id = n.id
         LEFT JOIN idx.note_docs d ON d.note_id = n.id
         WHERE d.note_id IS NULL OR d.source_updated_at != b.updated_at
         ORDER BY n.id",
    )?;
    for id in stale {
        match reindex_note(conn, &id) {
            Ok(()) => report.indexed += 1,
            Err(_) => report.failed.push(id),
        }
    }
    Ok(report)
}

/// Rebuild everything, e.g. after `open_user` reports `index_rebuilt`.
pub fn reindex_all(conn: &Connection) -> Result<Report> {
    conn.execute_batch(
        "DELETE FROM idx.note_docs; DELETE FROM idx.blocks; DELETE FROM idx.note_links;",
    )?;
    reindex_stale(conn)
}

fn clear(conn: &Connection, note_id: &str) -> Result<()> {
    conn.execute("DELETE FROM idx.note_docs WHERE note_id = ?1", [note_id])?;
    conn.execute("DELETE FROM idx.blocks WHERE note_id = ?1", [note_id])?;
    conn.execute("DELETE FROM idx.note_links WHERE from_note_id = ?1", [note_id])?;
    Ok(())
}

fn column(conn: &Connection, sql: &str) -> Result<Vec<String>> {
    let mut st = conn.prepare(sql)?;
    let rows = st.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A savepoint nests inside a caller's transaction, unlike BEGIN.
fn in_savepoint<T>(conn: &Connection, f: impl FnOnce() -> Result<T>) -> Result<T> {
    conn.execute_batch("SAVEPOINT reindex")?;
    match f() {
        Ok(v) => {
            conn.execute_batch("RELEASE reindex")?;
            Ok(v)
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK TO reindex; RELEASE reindex")?;
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::yjs::json_to_state;
    use crate::layout::DataLayout;
    use crate::store::{open_user, UserDb};
    use serde_json::{json, Value};

    fn open() -> (tempfile::TempDir, UserDb) {
        let dir = tempfile::tempdir().unwrap();
        let db = open_user(&DataLayout::new(dir.path()), "u1", None).unwrap();
        (dir, db)
    }

    fn put_note(conn: &Connection, id: &str, doc: &Value, updated_at: i64) {
        conn.execute(
            "INSERT INTO notes (id, vault_id, title, created_at, updated_at) VALUES (?1, 'v1', 'T', 1, 1)
             ON CONFLICT (id) DO NOTHING",
            [id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_bodies (note_id, yjs_state, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (note_id) DO UPDATE SET yjs_state = excluded.yjs_state, updated_at = excluded.updated_at",
            params![id, json_to_state(doc).unwrap(), updated_at],
        )
        .unwrap();
    }

    fn para(block_id: &str, text: &str) -> Value {
        json!({ "type": "paragraph", "attrs": { "blockId": block_id }, "content": [{ "type": "text", "text": text }] })
    }

    fn doc(content: Vec<Value>) -> Value {
        json!({ "type": "doc", "content": content })
    }

    fn ids(conn: &Connection, sql: &str) -> Vec<String> {
        let mut st = conn.prepare(sql).unwrap();
        st.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn indexes_doc_blocks_links_and_search() {
        let (_d, db) = open();
        let c = &db.conn;
        let mention = |id: &str| json!({ "type": "mention", "attrs": { "id": id, "label": id } });
        put_note(c, "n1", &doc(vec![
            para("b1", "hello world"),
            json!({ "type": "paragraph", "attrs": { "blockId": "b2" }, "content": [mention("n2"), mention("n1"), mention("n2")] }),
        ]), 5);
        reindex_note(c, "n1").unwrap();

        let (body, at): (String, i64) = c
            .query_row("SELECT body_json, source_updated_at FROM idx.note_docs WHERE note_id = 'n1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["content"][0]["attrs"]["blockId"], "b1");
        assert_eq!(at, 5);
        assert_eq!(ids(c, "SELECT id FROM idx.blocks ORDER BY sort"), ["b1", "b2"]);
        assert_eq!(ids(c, "SELECT to_note_id FROM idx.note_links"), ["n2"]);
        assert_eq!(ids(c, "SELECT id FROM idx.blocks WHERE rowid IN (SELECT rowid FROM idx.blocks_fts WHERE blocks_fts MATCH '\"lo wor\"')"), ["b1"]);
    }

    #[test]
    fn reindexing_replaces_old_rows() {
        let (_d, db) = open();
        let c = &db.conn;
        put_note(c, "n1", &doc(vec![para("b1", "old text")]), 1);
        reindex_note(c, "n1").unwrap();
        put_note(c, "n1", &doc(vec![para("b2", "new text")]), 2);
        reindex_note(c, "n1").unwrap();
        assert_eq!(ids(c, "SELECT id FROM idx.blocks"), ["b2"]);
        assert!(ids(c, "SELECT rowid FROM idx.blocks_fts WHERE blocks_fts MATCH '\"old\"'").is_empty());
    }

    #[test]
    fn a_note_without_a_body_has_no_rows() {
        let (_d, db) = open();
        let c = &db.conn;
        put_note(c, "n1", &doc(vec![para("b1", "x")]), 1);
        reindex_note(c, "n1").unwrap();
        c.execute("DELETE FROM note_bodies WHERE note_id = 'n1'", []).unwrap();
        reindex_note(c, "n1").unwrap();
        assert!(ids(c, "SELECT note_id FROM idx.note_docs").is_empty());
        assert!(ids(c, "SELECT id FROM idx.blocks").is_empty());
    }

    #[test]
    fn a_block_id_taken_by_another_note_falls_back_to_synthetic() {
        let (_d, db) = open();
        let c = &db.conn;
        put_note(c, "n1", &doc(vec![para("same", "first")]), 1);
        put_note(c, "n2", &doc(vec![para("same", "copy")]), 1);
        reindex_note(c, "n1").unwrap();
        reindex_note(c, "n2").unwrap();
        assert_eq!(ids(c, "SELECT id FROM idx.blocks ORDER BY note_id"), ["same", "n2:0"]);
    }

    #[test]
    fn stale_pass_touches_only_what_changed_and_reports_failures() {
        let (_d, db) = open();
        let c = &db.conn;
        put_note(c, "n1", &doc(vec![para("a", "one")]), 1);
        put_note(c, "n2", &doc(vec![para("b", "two")]), 1);
        assert_eq!(reindex_stale(c).unwrap(), Report { indexed: 2, removed: 0, failed: vec![] });
        assert_eq!(reindex_stale(c).unwrap(), Report::default());

        put_note(c, "n1", &doc(vec![para("a", "changed")]), 2);
        c.execute("DELETE FROM note_bodies WHERE note_id = 'n2'", []).unwrap();
        c.execute("INSERT INTO notes (id, vault_id, created_at, updated_at) VALUES ('bad', 'v1', 1, 1)", []).unwrap();
        c.execute("INSERT INTO note_bodies VALUES ('bad', x'010203', 1)", []).unwrap();
        assert_eq!(reindex_stale(c).unwrap(), Report { indexed: 1, removed: 1, failed: vec!["bad".into()] });
        assert_eq!(ids(c, "SELECT note_id FROM idx.note_docs"), ["n1"]);
    }

    #[test]
    fn reindex_all_starts_from_empty() {
        let (_d, db) = open();
        let c = &db.conn;
        put_note(c, "n1", &doc(vec![para("a", "one")]), 1);
        c.execute("INSERT INTO idx.blocks (id, note_id, vault_id, type, sort, text) VALUES ('ghost', 'gone', 'v1', 'paragraph', 0, 'x')", []).unwrap();
        assert_eq!(reindex_all(c).unwrap().indexed, 1);
        assert_eq!(ids(c, "SELECT id FROM idx.blocks"), ["a"]);
    }
}
