//! What the `cord-server` command line does besides serving.

use std::path::Path;

use cord_core::rusqlite::OptionalExtension;

use crate::{auth, db, log};

/// Print-ready one-time invite code, valid for `days`.
pub fn invite(dir: &Path, days: i64) -> cord_core::Result<String> {
    auth::create_invite(&db::open(dir)?, days, db::now())
}

/// Share a vault with another account by username.
pub fn add_member(dir: &Path, vault: &str, username: &str, role: &str) -> Result<(), String> {
    if !matches!(role, "owner" | "editor") {
        return Err(format!("the role must be owner or editor, not {role}"));
    }
    let conn = db::open(dir).map_err(|e| e.to_string())?;
    let user: Option<String> = conn
        .query_row("SELECT id FROM users WHERE username = ?1", [username], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let user = user.ok_or_else(|| format!("no account named {username}"))?;
    let exists: Option<i64> = conn
        .query_row("SELECT 1 FROM vaults WHERE id = ?1", [vault], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err(format!("no vault {vault}"));
    }
    log::add_member(&conn, vault, &user, role, db::now()).map_err(|e| e.to_string())
}
