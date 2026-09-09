//! Rust-native full-text search over the `blocks` index.
//!
//! This is one of only two places the Rust layer is allowed to hold logic (see
//! CLAUDE.md). It reads the same SQLite file the Bun sidecar writes, and never
//! writes to it.

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
}
