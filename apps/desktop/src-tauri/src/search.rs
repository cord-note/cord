//! Rust-native full-text search over the `blocks` index.
//!
//! This is one of only two places the Rust layer is allowed to hold logic (see
//! CLAUDE.md). It reads the same SQLite file the Bun sidecar writes, and never
//! writes to it.

#[cfg(test)]
mod tests {
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
}
