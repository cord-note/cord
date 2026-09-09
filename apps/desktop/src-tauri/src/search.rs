//! Rust-native full-text search over the `blocks` index.
//!
//! This is one of only two places the Rust layer is allowed to hold logic (see
//! CLAUDE.md). It reads the same SQLite file the Bun sidecar writes, and never
//! writes to it.

use rusqlite::Connection;
use serde::Serialize;

/// The trigram tokenizer cannot index fewer than three characters.
const TRIGRAM_MIN_CHARS: usize = 3;

/// Whether a query is long enough for the FTS index to serve it.
///
/// Shorter queries fall back to a plain LIKE scan so that a one- or
/// two-character search still returns the same rows, just without the index.
fn uses_fts(query: &str) -> bool {
    query.chars().count() >= TRIGRAM_MIN_CHARS
}

/// Build a substring LIKE pattern, escaping the wildcards a user may have typed.
///
/// Pairs with an explicit `ESCAPE '\'` clause in the SQL.
fn like_pattern(query: &str) -> String {
    let mut out = String::with_capacity(query.len() + 2);
    out.push('%');
    for ch in query.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('%');
    out
}

/// Wrap a query as an FTS5 phrase.
///
/// A bare user string is parsed as FTS5 query syntax, where characters like
/// `*`, `:`, `(` and `-` are operators. Quoting makes the whole thing a literal
/// phrase — which the trigram tokenizer treats as a substring search — and
/// internal quotes are doubled so they cannot close it early.
fn fts_phrase(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}

/// Mirrors the `NoteListItem` DTO in src/shared/types/index.ts.
///
/// Field names must survive the rename to camelCase exactly — the renderer
/// consumes this from the same `api.notes.search` call it always has, and a
/// mismatch here is invisible until the UI renders undefined.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItem {
    pub id: String,
    pub vault_id: String,
    pub title: String,
    pub kind: String,
    pub is_pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

const SELECT: &str = "SELECT n.id, n.vault_id, n.title, n.kind, n.is_pinned,
                             n.created_at, n.updated_at, n.deleted_at
                      FROM notes n
                      WHERE n.vault_id = ?1 AND n.deleted_at IS NULL AND (";

const ORDER: &str = ") ORDER BY n.is_pinned DESC, n.updated_at DESC";

/// Title and body search, scoped to one vault.
///
/// Body matching goes through the FTS index; vault scoping is applied on
/// `blocks` rather than inside the MATCH, because filtering an UNINDEXED
/// column within the FTS query is a full index scan and defeats the point.
pub fn query(conn: &Connection, vault_id: &str, q: &str) -> rusqlite::Result<Vec<NoteListItem>> {
    let like = like_pattern(q);

    let sql = if uses_fts(q) {
        format!(
            "{} n.title LIKE ?2 ESCAPE '\\'
                 OR n.id IN (SELECT b.note_id FROM blocks_fts f
                             JOIN blocks b ON b.rowid = f.rowid
                             WHERE f.text MATCH ?3 AND b.vault_id = ?1) {}",
            SELECT, ORDER
        )
    } else {
        format!(
            "{} n.title LIKE ?2 ESCAPE '\\'
                 OR n.id IN (SELECT b.note_id FROM blocks b
                             WHERE b.vault_id = ?1 AND b.text LIKE ?2 ESCAPE '\\') {}",
            SELECT, ORDER
        )
    };

    let mut stmt = conn.prepare(&sql)?;

    let map = |row: &rusqlite::Row<'_>| -> rusqlite::Result<NoteListItem> {
        Ok(NoteListItem {
            id:         row.get(0)?,
            vault_id:   row.get(1)?,
            title:      row.get(2)?,
            kind:       row.get(3)?,
            is_pinned:  row.get::<_, i64>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            deleted_at: row.get(7)?,
        })
    };

    let rows = if uses_fts(q) {
        stmt.query_map((vault_id, &like, fts_phrase(q)), map)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        stmt.query_map((vault_id, &like), map)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Rust bundles its own SQLite, separate from Bun's. Confirming FTS5 and the
    /// trigram tokenizer exist here proves nothing about the sidecar and vice
    /// versa, so both sides are checked independently.
    #[test]
    fn bundled_sqlite_supports_fts5_trigram() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE probe USING fts5(x, tokenize='trigram');
             INSERT INTO probe(x) VALUES('barfoosh');",
        )
        .expect("FTS5 with trigram tokenizer must be available");

        let hits: i64 = conn
            .query_row("SELECT count(*) FROM probe WHERE x MATCH ?1", ["\"foo\""], |r| r.get(0))
            .unwrap();

        assert_eq!(hits, 1, "trigram must match mid-word, as LIKE '%foo%' does");
    }

    #[test]
    fn like_pattern_wraps_and_escapes() {
        assert_eq!(like_pattern("plain"), "%plain%");
        // % and _ are LIKE wildcards; a user searching for them means them literally.
        assert_eq!(like_pattern("100%"), "%100\\%%");
        assert_eq!(like_pattern("a_b"), "%a\\_b%");
        // The escape character itself has to be escaped.
        assert_eq!(like_pattern("back\\slash"), "%back\\\\slash%");
    }

    #[test]
    fn fts_phrase_quotes_and_doubles_inner_quotes() {
        assert_eq!(fts_phrase("plain"), "\"plain\"");
        // Without doubling, this would terminate the phrase and the remainder
        // would parse as FTS5 query syntax.
        assert_eq!(fts_phrase("say \"hi\""), "\"say \"\"hi\"\"\"");
    }

    #[test]
    fn uses_fts_only_at_three_characters_or_more() {
        assert!(!uses_fts("ab"));
        assert!(uses_fts("abc"));
        // Counted in characters, not bytes — a two-emoji query is not 8 chars.
        assert!(!uses_fts("🙂🙂"));
    }

    /// Mirrors the columns Task 2's migration creates. Rust builds its own
    /// schema here rather than running migrations.ts, so this DDL can drift —
    /// the Bun tests in src/sidecar/db/__tests__/blocksFts.test.ts are what
    /// guard the real triggers.
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (
               id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL,
               title TEXT NOT NULL, kind TEXT NOT NULL,
               is_pinned INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
               deleted_at INTEGER
             );
             CREATE TABLE blocks (
               id TEXT PRIMARY KEY NOT NULL, note_id TEXT NOT NULL,
               vault_id TEXT NOT NULL, type TEXT NOT NULL, sort INTEGER NOT NULL,
               level INTEGER, text TEXT NOT NULL DEFAULT '', ref_block_id TEXT,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE VIRTUAL TABLE blocks_fts USING fts5(
               text, content='blocks', content_rowid='rowid', tokenize='trigram'
             );
             CREATE TRIGGER blocks_fts_ai AFTER INSERT ON blocks BEGIN
               INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
             END;",
        )
        .unwrap();
        conn
    }

    fn add_note(conn: &Connection, id: &str, vault: &str, title: &str, body: &str) {
        conn.execute(
            "INSERT INTO notes (id, vault_id, title, kind, is_pinned, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'note', 0, 1, 1)",
            (id, vault, title),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO blocks (id, note_id, vault_id, type, sort, text, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'paragraph', 0, ?4, 1, 1)",
            (format!("{id}-b1"), id, vault, body),
        )
        .unwrap();
    }

    #[test]
    fn finds_notes_by_body_substring() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "the barfoosh incident");

        let hits = query(&conn, "v1", "foo").unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "n1");
    }

    #[test]
    fn finds_notes_by_title() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Harbour Notes", "unrelated body");

        let hits = query(&conn, "v1", "arbour").unwrap();

        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn short_queries_still_match_via_the_like_fallback() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "on the quay");

        let hits = query(&conn, "v1", "qu").unwrap();

        assert_eq!(hits.len(), 1, "two-character queries bypass FTS but must still match");
    }

    #[test]
    fn scopes_results_to_the_requested_vault() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "shared word");
        add_note(&conn, "n2", "v2", "Untitled", "shared word");

        let hits = query(&conn, "v1", "shared").unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "n1");
    }

    #[test]
    fn excludes_soft_deleted_notes() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "deleted content");
        conn.execute("UPDATE notes SET deleted_at = 99 WHERE id = 'n1'", ()).unwrap();

        assert!(query(&conn, "v1", "deleted").unwrap().is_empty());
    }

    #[test]
    fn treats_wildcards_and_quotes_literally() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "a 100% increase");
        add_note(&conn, "n2", "v1", "Untitled", "nothing relevant");

        // Were % unescaped, this would match both rows.
        let hits = query(&conn, "v1", "100%").unwrap();
        assert_eq!(hits.len(), 1);

        // Must not error out as malformed FTS5 syntax.
        assert!(query(&conn, "v1", "say \"hi\"").is_ok());
        assert!(query(&conn, "v1", "a OR b*").is_ok());
    }

    #[test]
    fn orders_pinned_first_then_most_recent() {
        let conn = fixture();
        add_note(&conn, "old", "v1", "Untitled", "ordering probe");
        add_note(&conn, "new", "v1", "Untitled", "ordering probe");
        add_note(&conn, "pin", "v1", "Untitled", "ordering probe");
        conn.execute("UPDATE notes SET updated_at = 50 WHERE id = 'new'", ()).unwrap();
        conn.execute("UPDATE notes SET is_pinned = 1 WHERE id = 'pin'", ()).unwrap();

        let ids: Vec<String> = query(&conn, "v1", "ordering").unwrap()
            .into_iter().map(|n| n.id).collect();

        assert_eq!(ids, vec!["pin", "new", "old"]);
    }

    #[test]
    fn is_pinned_serialises_as_a_json_boolean() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "pin check");
        conn.execute("UPDATE notes SET is_pinned = 1 WHERE id = 'n1'", ()).unwrap();

        let json = serde_json::to_value(query(&conn, "v1", "pin").unwrap()).unwrap();

        // SQLite stores 0/1; the renderer's pin control expects a real boolean.
        assert_eq!(json[0]["isPinned"], serde_json::Value::Bool(true));
        assert_eq!(json[0]["deletedAt"], serde_json::Value::Null);
        assert_eq!(json[0]["vaultId"], "v1");
    }
}
