//! Cord's domain core: storage, clocks and the sync outbox. No Tauri here.

pub mod error;
pub mod layout;
pub mod hlc;
pub mod store;
pub mod clock;
pub mod changes;
pub mod device;

pub use error::{Error, Result};

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn sqlcipher_build_supports_fts5_trigram() {
        let conn = Connection::open_in_memory().unwrap();
        let version: String = conn
            .query_row("PRAGMA cipher_version", [], |r| r.get(0))
            .unwrap();
        assert!(!version.is_empty(), "not a SQLCipher build");
        conn.execute_batch(
            "CREATE VIRTUAL TABLE t USING fts5(text, tokenize='trigram');
             INSERT INTO t(text) VALUES ('hello world');",
        )
        .unwrap();
        let hits: i64 = conn
            .query_row("SELECT count(*) FROM t WHERE t MATCH '\"llo wo\"'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(hits, 1);
    }
}
