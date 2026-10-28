//! Local accounts in machine.db. Never synced, never logged.

pub mod password;
pub mod recovery;

use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::layout::DataLayout;
use crate::session::now_ms;
use crate::{Error, Result};

/// Wrong PINs in a row before the PIN is refused until a password sign-in.
pub const MAX_PIN_ATTEMPTS: i64 = 5;
const LAST_USER_KEY: &str = "last_user_id";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: String,
    pub username: String,
    pub created_at: i64,
    pub has_pin: bool,
    pub has_recovery_key: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockUser {
    pub id: String,
    pub username: String,
    pub has_pin: bool,
    pub pin_locked: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockScreenState {
    pub users: Vec<LockUser>,
    pub last_user_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinUnlockResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<AuthUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tries_left: Option<i64>,
}

struct UserRow {
    id: String,
    username: String,
    password_hash: String,
    pin_hash: Option<String>,
    failed_pin_attempts: i64,
    recovery_key_hash: Option<String>,
    created_at: i64,
}

const USER_COLUMNS: &str = "id, username, password_hash, pin_hash, failed_pin_attempts, recovery_key_hash, created_at";

fn user_row(r: &Row<'_>) -> rusqlite::Result<UserRow> {
    Ok(UserRow {
        id: r.get(0)?,
        username: r.get(1)?,
        password_hash: r.get(2)?,
        pin_hash: r.get(3)?,
        failed_pin_attempts: r.get(4)?,
        recovery_key_hash: r.get(5)?,
        created_at: r.get(6)?,
    })
}

fn auth_user(row: &UserRow) -> AuthUser {
    AuthUser {
        id: row.id.clone(),
        username: row.username.clone(),
        created_at: row.created_at,
        has_pin: row.pin_hash.is_some(),
        has_recovery_key: row.recovery_key_hash.is_some(),
    }
}

/// Accounts on this machine. Signing in returns the user; holding the
/// session is the caller's job.
pub struct Accounts<'a> {
    conn: &'a Connection,
    layout: &'a DataLayout,
    hash_cost: u32,
    recovery_delay: Duration,
}

impl<'a> Accounts<'a> {
    pub fn new(conn: &'a Connection, layout: &'a DataLayout) -> Self {
        Self { conn, layout, hash_cost: bcrypt::DEFAULT_COST, recovery_delay: Duration::from_secs(1) }
    }

    /// Tests lower the bcrypt cost and the wrong-recovery-key pause.
    pub fn tuned(mut self, hash_cost: u32, recovery_delay: Duration) -> Self {
        self.hash_cost = hash_cost;
        self.recovery_delay = recovery_delay;
        self
    }

    /// Everything the lock screen shows before anyone has unlocked.
    pub fn lock_screen(&self) -> Result<LockScreenState> {
        let sql = format!("SELECT {USER_COLUMNS} FROM users ORDER BY username");
        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map([], user_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        let last: Option<String> = self
            .conn
            .query_row("SELECT value FROM app_state WHERE key = ?1", [LAST_USER_KEY], |r| r.get(0))
            .optional()?;
        Ok(LockScreenState {
            last_user_id: last.filter(|id| rows.iter().any(|r| &r.id == id)),
            users: rows
                .iter()
                .map(|r| LockUser {
                    id: r.id.clone(),
                    username: r.username.clone(),
                    has_pin: r.pin_hash.is_some(),
                    pin_locked: r.failed_pin_attempts >= MAX_PIN_ATTEMPTS,
                })
                .collect(),
        })
    }

    /// Registering signs you in; setup continues with a PIN.
    pub fn register(&self, username: &str, password: &str) -> Result<AuthUser> {
        let name = clean_username(username);
        if self.find_by_username(&name)?.is_some() {
            return Err(Error::Invalid("That username is taken".into()));
        }
        let id = nanoid::nanoid!();
        self.conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, self.hash(password)?, now_ms()],
        )?;
        std::fs::create_dir_all(self.layout.user_dir(&id)?)?;
        let row = self.require(&id)?;
        self.remember(&row)
    }

    pub fn login(&self, username: &str, password: &str) -> Result<AuthUser> {
        let row = self
            .find_by_username(username)?
            .filter(|r| password::verify(password, &r.password_hash))
            .ok_or_else(|| Error::Invalid("Invalid username or password".into()))?;
        // A password sign-in is what re-enables a PIN refused after wrong attempts.
        self.conn.execute("UPDATE users SET failed_pin_attempts = 0 WHERE id = ?1", [&row.id])?;
        self.remember(&UserRow { failed_pin_attempts: 0, ..row })
    }

    pub fn unlock_with_pin(&self, user_id: &str, pin: &str) -> Result<PinUnlockResult> {
        let row = self.find_by_id(user_id)?.ok_or_else(|| Error::Invalid("Unknown user".into()))?;
        let Some(pin_hash) = row.pin_hash.as_deref() else {
            return Err(Error::Invalid("This user has no PIN yet. Sign in with your password.".into()));
        };
        if row.failed_pin_attempts >= MAX_PIN_ATTEMPTS {
            return Err(Error::Invalid("Too many wrong PINs. Sign in with your password.".into()));
        }
        if !password::verify(pin, pin_hash) {
            let attempts = row.failed_pin_attempts + 1;
            self.conn.execute("UPDATE users SET failed_pin_attempts = ?1 WHERE id = ?2", params![attempts, row.id])?;
            return Ok(PinUnlockResult { ok: false, user: None, tries_left: Some(MAX_PIN_ATTEMPTS - attempts) });
        }
        self.conn.execute("UPDATE users SET failed_pin_attempts = 0 WHERE id = ?1", [&row.id])?;
        let user = self.remember(&UserRow { failed_pin_attempts: 0, ..row })?;
        Ok(PinUnlockResult { ok: true, user: Some(user), tries_left: None })
    }

    /// The first PIN is part of setup; replacing one needs the password.
    pub fn set_pin(&self, user_id: &str, pin: &str, password: Option<&str>) -> Result<AuthUser> {
        let row = self.require(user_id)?;
        if !is_pin(pin) {
            return Err(Error::Invalid("PIN must be 4 to 6 digits".into()));
        }
        if row.pin_hash.is_some() {
            self.require_password(&row, password)?;
        }
        let pin_hash = self.hash(pin)?;
        self.conn.execute(
            "UPDATE users SET pin_hash = ?1, failed_pin_attempts = 0 WHERE id = ?2",
            params![pin_hash, row.id],
        )?;
        Ok(auth_user(&UserRow { pin_hash: Some(pin_hash), failed_pin_attempts: 0, ..row }))
    }

    pub fn verify_password(&self, user_id: &str, password: &str) -> Result<()> {
        self.require_password(&self.require(user_id)?, Some(password))
    }

    pub fn change_password(&self, user_id: &str, current: &str, new: &str) -> Result<()> {
        let row = self.require(user_id)?;
        self.require_password(&row, Some(current))?;
        self.conn.execute("UPDATE users SET password_hash = ?1 WHERE id = ?2", params![self.hash(new)?, row.id])?;
        Ok(())
    }

    /// A new recovery key, in plain text only this once. Replacing one needs the password.
    pub fn issue_recovery_key(&self, user_id: &str, password: Option<&str>) -> Result<String> {
        let row = self.require(user_id)?;
        if row.recovery_key_hash.is_some() {
            self.require_password(&row, password)?;
        }
        let key = recovery::generate()?;
        self.conn.execute(
            "UPDATE users SET recovery_key_hash = ?1 WHERE id = ?2",
            params![self.hash(&recovery::normalise(&key))?, row.id],
        )?;
        Ok(key)
    }

    /// Forgotten password: the key sets a new one and signs in. The key is
    /// spent and the PIN goes with the old password.
    pub fn recover(&self, username: &str, recovery_key: &str, new_password: &str) -> Result<AuthUser> {
        let row = self.find_by_username(username)?.filter(|r| {
            r.recovery_key_hash.as_deref().is_some_and(|h| password::verify(&recovery::normalise(recovery_key), h))
        });
        let Some(row) = row else {
            std::thread::sleep(self.recovery_delay);
            return Err(Error::Invalid("That recovery key doesn't match.".into()));
        };
        let password_hash = self.hash(new_password)?;
        self.conn.execute(
            "UPDATE users SET password_hash = ?1, pin_hash = NULL, failed_pin_attempts = 0, recovery_key_hash = NULL
             WHERE id = ?2",
            params![password_hash, row.id],
        )?;
        self.remember(&UserRow { password_hash, pin_hash: None, failed_pin_attempts: 0, recovery_key_hash: None, ..row })
    }

    pub fn user(&self, user_id: &str) -> Result<Option<AuthUser>> {
        Ok(self.find_by_id(user_id)?.as_ref().map(auth_user))
    }

    fn find_by_id(&self, id: &str) -> Result<Option<UserRow>> {
        let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?1");
        Ok(self.conn.query_row(&sql, [id], user_row).optional()?)
    }

    fn find_by_username(&self, username: &str) -> Result<Option<UserRow>> {
        let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE username = ?1");
        Ok(self.conn.query_row(&sql, [clean_username(username)], user_row).optional()?)
    }

    fn require(&self, id: &str) -> Result<UserRow> {
        self.find_by_id(id)?.ok_or_else(|| Error::Invalid("Not authenticated".into()))
    }

    fn require_password(&self, row: &UserRow, password: Option<&str>) -> Result<()> {
        match password {
            Some(p) if password::verify(p, &row.password_hash) => Ok(()),
            _ => Err(Error::Invalid("Wrong password".into())),
        }
    }

    fn hash(&self, secret: &str) -> Result<String> {
        password::hash(secret, self.hash_cost)
    }

    fn remember(&self, row: &UserRow) -> Result<AuthUser> {
        self.conn.execute(
            "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![LAST_USER_KEY, row.id, now_ms()],
        )?;
        Ok(auth_user(row))
    }
}

fn clean_username(username: &str) -> String {
    username.trim().to_lowercase()
}

fn is_pin(pin: &str) -> bool {
    (4..=6).contains(&pin.len()) && pin.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::open_machine;

    fn setup() -> (tempfile::TempDir, DataLayout, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let layout = DataLayout::new(dir.path());
        let conn = open_machine(&layout).unwrap();
        (dir, layout, conn)
    }

    fn fast<'a>(conn: &'a Connection, layout: &'a DataLayout) -> Accounts<'a> {
        Accounts::new(conn, layout).tuned(4, Duration::ZERO)
    }

    #[test]
    fn registering_signs_in_and_preselects_the_user() {
        let (_d, l, c) = setup();
        let a = fast(&c, &l);
        let u = a.register("  Ola ", "pw").unwrap();
        assert_eq!((u.username.as_str(), u.has_pin, u.has_recovery_key), ("ola", false, false));
        assert!(l.user_dir(&u.id).unwrap().is_dir());
        let state = a.lock_screen().unwrap();
        assert_eq!(state.last_user_id.as_deref(), Some(u.id.as_str()));
        assert_eq!(state.users[0].username, "ola");
        assert!(matches!(a.register("OLA", "x"), Err(Error::Invalid(_))));
    }

    #[test]
    fn login_checks_the_password() {
        let (_d, l, c) = setup();
        let a = fast(&c, &l);
        a.register("ola", "pw").unwrap();
        assert!(a.login("Ola", "pw").is_ok());
        let e = a.login("ola", "nope").unwrap_err().to_string();
        assert_eq!(e, "Invalid username or password");
    }

    #[test]
    fn a_password_bun_hashed_still_works() {
        let (_d, l, c) = setup();
        c.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'ola', ?1, 1)",
            ["$2b$04$Y3AS0kaP.yAK8ZohrL0XVeB0LOMghmULrXGzI8fKQeO5GL/a0v0Fi"],
        )
        .unwrap();
        assert_eq!(fast(&c, &l).login("ola", "correct horse").unwrap().id, "u1");
    }

    #[test]
    fn pins_lock_after_five_wrong_tries_until_a_password_sign_in() {
        let (_d, l, c) = setup();
        let a = fast(&c, &l);
        let u = a.register("ola", "pw").unwrap();
        assert!(matches!(a.set_pin(&u.id, "12a4", None), Err(Error::Invalid(_))));
        assert!(a.set_pin(&u.id, "1234", None).unwrap().has_pin);

        for left in (0..MAX_PIN_ATTEMPTS).rev() {
            let r = a.unlock_with_pin(&u.id, "0000").unwrap();
            assert_eq!((r.ok, r.tries_left), (false, Some(left)));
        }
        assert!(a.lock_screen().unwrap().users[0].pin_locked);
        let e = a.unlock_with_pin(&u.id, "1234").unwrap_err().to_string();
        assert_eq!(e, "Too many wrong PINs. Sign in with your password.");

        a.login("ola", "pw").unwrap();
        let ok = a.unlock_with_pin(&u.id, "1234").unwrap();
        assert!(ok.ok && ok.user.is_some());
    }

    #[test]
    fn replacing_a_pin_or_key_needs_the_password() {
        let (_d, l, c) = setup();
        let a = fast(&c, &l);
        let u = a.register("ola", "pw").unwrap();
        a.set_pin(&u.id, "1234", None).unwrap();
        assert!(matches!(a.set_pin(&u.id, "5678", None), Err(Error::Invalid(_))));
        a.set_pin(&u.id, "5678", Some("pw")).unwrap();
        a.issue_recovery_key(&u.id, None).unwrap();
        assert!(matches!(a.issue_recovery_key(&u.id, Some("nope")), Err(Error::Invalid(_))));
        assert!(a.issue_recovery_key(&u.id, Some("pw")).is_ok());
    }

    #[test]
    fn a_recovery_key_resets_the_password_once() {
        let (_d, l, c) = setup();
        let a = fast(&c, &l);
        let u = a.register("ola", "pw").unwrap();
        a.set_pin(&u.id, "1234", None).unwrap();
        let key = a.issue_recovery_key(&u.id, None).unwrap();

        assert!(a.recover("ola", "WRONG-KEY", "new").is_err());
        let back = a.recover("ola", &key.to_lowercase(), "new").unwrap();
        assert_eq!((back.has_pin, back.has_recovery_key), (false, false));
        assert!(a.login("ola", "new").is_ok());
        assert!(a.recover("ola", &key, "again").is_err(), "a key is spent once used");
    }

    #[test]
    fn password_change_and_check() {
        let (_d, l, c) = setup();
        let a = fast(&c, &l);
        let u = a.register("ola", "pw").unwrap();
        assert!(a.verify_password(&u.id, "nope").is_err());
        a.change_password(&u.id, "pw", "pw2").unwrap();
        assert!(a.verify_password(&u.id, "pw2").is_ok());
        assert!(a.change_password(&u.id, "pw", "x").is_err());
    }
}
