//! The servers this user syncs with. Local to the device, never synced.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use url::Url;

use crate::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRow {
    pub id: String,
    pub url: String,
    pub username: String,
    pub server_user_id: Option<String>,
    /// Never sent to the renderer.
    #[serde(skip)]
    pub token: Option<String>,
    pub paused: bool,
    pub last_sync_at: Option<i64>,
    pub created_at: i64,
}

/// The server address without a trailing slash. HTTPS anywhere; plain HTTP
/// only to this computer, since anything else would send the token in the clear.
pub fn check_url(input: &str) -> Result<String> {
    let url = Url::parse(input.trim()).map_err(|_| Error::Invalid(format!("not a server address: {input}")))?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        "http" => return Err(Error::Invalid("use https:// for a server that is not on this computer".into())),
        _ => return Err(Error::Invalid(format!("not a server address: {input}"))),
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

pub fn add(conn: &Connection, url: &str, username: &str, server_user_id: &str, token: &str, now_ms: i64) -> Result<String> {
    let id = nanoid::nanoid!();
    conn.execute(
        "INSERT INTO connections (id, url, username, server_user_id, token, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, url, username, server_user_id, token, now_ms],
    )?;
    Ok(id)
}

const COLUMNS: &str = "id, url, username, server_user_id, token, paused, last_sync_at, created_at";

fn read(r: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionRow> {
    Ok(ConnectionRow {
        id: r.get(0)?,
        url: r.get(1)?,
        username: r.get(2)?,
        server_user_id: r.get(3)?,
        token: r.get(4)?,
        paused: r.get::<_, i64>(5)? != 0,
        last_sync_at: r.get(6)?,
        created_at: r.get(7)?,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<ConnectionRow>> {
    let mut st = conn.prepare(&format!("SELECT {COLUMNS} FROM connections ORDER BY created_at"))?;
    let rows = st.query_map([], read)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<ConnectionRow>> {
    Ok(conn.query_row(&format!("SELECT {COLUMNS} FROM connections WHERE id = ?1"), [id], read).optional()?)
}

pub fn set_token(conn: &Connection, id: &str, token: Option<&str>) -> Result<()> {
    conn.execute("UPDATE connections SET token = ?2 WHERE id = ?1", params![id, token])?;
    Ok(())
}

pub fn set_paused(conn: &Connection, id: &str, paused: bool) -> Result<()> {
    conn.execute("UPDATE connections SET paused = ?2 WHERE id = ?1", params![id, i64::from(paused)])?;
    Ok(())
}

pub fn touch(conn: &Connection, id: &str, now_ms: i64) -> Result<()> {
    conn.execute("UPDATE connections SET last_sync_at = ?2 WHERE id = ?1", params![id, now_ms])?;
    Ok(())
}

/// Vault ids linked to this connection.
pub fn vaults(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut st = conn.prepare("SELECT vault_id FROM vault_connections WHERE connection_id = ?1 ORDER BY vault_id")?;
    let rows = st.query_map([id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Forget a server: its links, what it was owed and what was parked. Local
/// vaults are untouched. These rows are device settings, not authored data.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    for vault in vaults(conn, id)? {
        crate::sync::link::unlink_vault(conn, id, &vault)?;
    }
    conn.execute("DELETE FROM sync_parked WHERE connection_id = ?1", [id])?;
    conn.execute("DELETE FROM connections WHERE id = ?1", [id])?;
    Ok(())
}

/// The bookmark for one linked vault.
pub fn bookmark(conn: &Connection, id: &str, vault_id: &str) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT bookmark FROM vault_connections WHERE connection_id = ?1 AND vault_id = ?2",
        params![id, vault_id],
        |r| r.get(0),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::test_session;

    #[test]
    fn https_anywhere_http_only_locally() {
        assert!(check_url("https://notes.example.org").is_ok());
        assert!(check_url("http://localhost:8787").is_ok());
        assert!(check_url("http://127.0.0.1:8787/").is_ok());
        assert!(check_url("http://[::1]:8787").is_ok());
        assert!(check_url("http://notes.example.org").is_err());
        assert!(check_url("ftp://localhost").is_err());
        assert!(check_url("not a url").is_err());
        assert_eq!(check_url("https://a.org/").unwrap(), "https://a.org");
    }

    #[test]
    fn add_list_pause_and_remove() {
        let (_d, s) = test_session();
        let id = add(s.conn(), "https://a.org", "ola", "su1", "tok", 5).unwrap();
        let row = get(s.conn(), &id).unwrap().unwrap();
        assert_eq!((row.url.as_str(), row.username.as_str(), row.paused), ("https://a.org", "ola", false));
        assert_eq!(row.token.as_deref(), Some("tok"));
        assert!(!serde_json::to_string(&row).unwrap().contains("tok"));
        set_paused(s.conn(), &id, true).unwrap();
        set_token(s.conn(), &id, None).unwrap();
        let row = &list(s.conn()).unwrap()[0];
        assert!(row.paused && row.token.is_none());
        s.conn()
            .execute(
                "INSERT INTO vault_connections (vault_id, connection_id, server_vault_id, mode, role, created_at)
                 VALUES ('v1', ?1, 'v1', 'two_way', 'owner', 1)",
                [&id],
            )
            .unwrap();
        assert_eq!(vaults(s.conn(), &id).unwrap(), ["v1"]);
        remove(s.conn(), &id).unwrap();
        assert!(list(s.conn()).unwrap().is_empty());
        assert!(vaults(s.conn(), &id).unwrap().is_empty());
    }
}
