//! Invites, accounts and the token each signed-in device holds.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use cord_core::accounts::password;
use cord_core::rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::error::ApiError;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// 32 random bytes as URL-safe text.
pub fn new_secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("the system has no random source");
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash(secret: &str) -> String {
    Sha256::digest(secret.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// A one-time invite code, valid for `days`.
pub fn create_invite(conn: &Connection, days: i64, now: i64) -> cord_core::Result<String> {
    let code = new_secret();
    conn.execute(
        "INSERT INTO invites (code_hash, expires_at, created_at) VALUES (?1, ?2, ?3)",
        params![hash(&code), now + days * DAY_MS, now],
    )?;
    Ok(code)
}

/// Use an invite: create the account and sign this device in. Returns (user id, token).
pub fn redeem(
    conn: &Connection,
    code: &str,
    username: &str,
    secret: &str,
    device: &str,
    cost: u32,
    now: i64,
) -> Result<(String, String), ApiError> {
    let username = username.trim();
    if username.is_empty() || secret.is_empty() {
        return Err(ApiError::BadRequest("a username and password are needed".into()));
    }
    let usable: Option<i64> = conn
        .query_row(
            "SELECT expires_at FROM invites WHERE code_hash = ?1 AND used_at IS NULL",
            [hash(code)],
            |r| r.get(0),
        )
        .optional()?;
    match usable {
        Some(expires) if expires > now => {}
        _ => return Err(ApiError::Forbidden),
    }
    let taken: bool = conn
        .query_row("SELECT 1 FROM users WHERE username = ?1", [username], |_| Ok(true))
        .optional()?
        .is_some();
    if taken {
        return Err(ApiError::Conflict("that username is taken".into()));
    }
    let user = nanoid::nanoid!();
    let hashed = password::hash(secret, cost)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![user, username, hashed, now],
    )?;
    tx.execute("UPDATE invites SET used_at = ?2, used_by = ?3 WHERE code_hash = ?1", params![hash(code), now, user])?;
    let token = issue(&tx, &user, device, now)?;
    tx.commit()?;
    Ok((user, token))
}

/// Sign a device in with a username and password. Returns (user id, token).
pub fn login(conn: &Connection, username: &str, secret: &str, device: &str, now: i64) -> Result<(String, String), ApiError> {
    let found: Option<(String, String)> = conn
        .query_row(
            "SELECT id, password_hash FROM users WHERE username = ?1",
            [username.trim()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((user, hashed)) = found else { return Err(ApiError::SignedOut) };
    if !password::verify(secret, &hashed) {
        return Err(ApiError::SignedOut);
    }
    let token = issue(conn, &user, device, now)?;
    Ok((user, token))
}

fn issue(conn: &Connection, user: &str, device: &str, now: i64) -> cord_core::Result<String> {
    let token = new_secret();
    let name: String = device.trim().chars().take(80).collect();
    conn.execute(
        "INSERT INTO devices (token_hash, user_id, name, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![hash(&token), user, name, now],
    )?;
    Ok(token)
}

/// The user a live token belongs to; notes when the device was last seen.
pub fn user_for_token(conn: &Connection, token: &str, now: i64) -> cord_core::Result<Option<String>> {
    let h = hash(token);
    let user: Option<String> = conn
        .query_row("SELECT user_id FROM devices WHERE token_hash = ?1 AND revoked_at IS NULL", [&h], |r| r.get(0))
        .optional()?;
    if user.is_some() {
        conn.execute("UPDATE devices SET last_seen_at = ?2 WHERE token_hash = ?1", params![h, now])?;
    }
    Ok(user)
}

pub fn logout(conn: &Connection, token: &str, now: i64) -> cord_core::Result<()> {
    conn.execute("UPDATE devices SET revoked_at = ?2 WHERE token_hash = ?1", params![hash(token), now])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open(dir.path()).unwrap();
        (dir, conn)
    }

    fn pw() -> String {
        format!("pw-{:?}", std::time::SystemTime::now())
    }

    #[test]
    fn an_invite_makes_one_account() {
        let (_d, c) = db();
        let code = create_invite(&c, 7, 1_000).unwrap();
        let pass = pw();
        let (user, token) = redeem(&c, &code, "ola", &pass, "laptop", 4, 2_000).unwrap();
        assert_eq!(user_for_token(&c, &token, 3_000).unwrap(), Some(user));
        assert_eq!(redeem(&c, &code, "eve", &pass, "x", 4, 2_000), Err(ApiError::Forbidden));
    }

    #[test]
    fn an_expired_or_unknown_invite_is_refused() {
        let (_d, c) = db();
        let code = create_invite(&c, 1, 0).unwrap();
        assert_eq!(redeem(&c, &code, "ola", &pw(), "x", 4, 2 * DAY_MS), Err(ApiError::Forbidden));
        assert_eq!(redeem(&c, "nope", "ola", &pw(), "x", 4, 1), Err(ApiError::Forbidden));
    }

    #[test]
    fn usernames_are_unique_and_a_taken_name_keeps_the_invite() {
        let (_d, c) = db();
        let first = create_invite(&c, 7, 0).unwrap();
        redeem(&c, &first, "ola", &pw(), "x", 4, 1).unwrap();
        let second = create_invite(&c, 7, 0).unwrap();
        assert!(matches!(redeem(&c, &second, "ola", &pw(), "x", 4, 1), Err(ApiError::Conflict(_))));
        assert!(redeem(&c, &second, "kim", &pw(), "x", 4, 1).is_ok());
    }

    #[test]
    fn login_checks_the_password_and_logout_revokes() {
        let (_d, c) = db();
        let code = create_invite(&c, 7, 0).unwrap();
        let pass = pw();
        let (user, _) = redeem(&c, &code, "ola", &pass, "laptop", 4, 1).unwrap();
        assert_eq!(login(&c, "ola", "wrong", "phone", 2), Err(ApiError::SignedOut));
        assert_eq!(login(&c, "nobody", &pass, "phone", 2), Err(ApiError::SignedOut));
        let (again, token) = login(&c, "ola", &pass, "phone", 2).unwrap();
        assert_eq!(again, user);
        logout(&c, &token, 3).unwrap();
        assert_eq!(user_for_token(&c, &token, 4).unwrap(), None);
    }

    #[test]
    fn secrets_are_stored_only_as_hashes() {
        let (_d, c) = db();
        let code = create_invite(&c, 7, 0).unwrap();
        let (_, token) = redeem(&c, &code, "ola", &pw(), "x", 4, 1).unwrap();
        let stored: String = c.query_row("SELECT token_hash FROM devices", [], |r| r.get(0)).unwrap();
        assert_ne!(stored, token);
        assert_eq!(stored, hash(&token));
    }
}
