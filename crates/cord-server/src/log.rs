//! Vaults, members and every change received, in arrival order per vault.

use cord_core::rusqlite::{params, Connection, OptionalExtension};
use cord_core::sync::wire::{self, PushReply, Rejected, VaultInfo, WireChange, MAX_BATCH};

use crate::error::ApiError;

/// What an append did: the reply to send, and where the vault's log now ends.
#[derive(Debug)]
pub struct Appended {
    pub reply: PushReply,
    pub seq: i64,
    /// True when anything new was stored, so a ping is due.
    pub grew: bool,
}

pub struct Page {
    pub changes: Vec<WireChange>,
    pub more: bool,
}

pub fn role(conn: &Connection, user: &str, vault: &str) -> cord_core::Result<Option<String>> {
    Ok(conn
        .query_row("SELECT role FROM members WHERE vault_id = ?1 AND user_id = ?2", params![vault, user], |r| r.get(0))
        .optional()?)
}

pub fn vaults_for(conn: &Connection, user: &str) -> cord_core::Result<Vec<VaultInfo>> {
    let mut st = conn.prepare(
        "SELECT v.id, v.name, m.role FROM members m JOIN vaults v ON v.id = m.vault_id
         WHERE m.user_id = ?1 ORDER BY v.name, v.id",
    )?;
    let rows = st.query_map([user], |r| Ok(VaultInfo { id: r.get(0)?, name: r.get(1)?, role: r.get(2)? }))?;
    Ok(rows.collect::<cord_core::rusqlite::Result<_>>()?)
}

/// Put a vault on the server with its own id. Repeating it as a member is a no-op.
pub fn create_vault(conn: &Connection, user: &str, id: &str, name: &str, now: i64) -> Result<VaultInfo, ApiError> {
    if id.is_empty() || id.len() > 64 {
        return Err(ApiError::BadRequest("bad vault id".into()));
    }
    let exists: bool = conn.query_row("SELECT 1 FROM vaults WHERE id = ?1", [id], |_| Ok(true)).optional()?.is_some();
    if exists {
        let name: String = conn.query_row("SELECT name FROM vaults WHERE id = ?1", [id], |r| r.get(0))?;
        return match role(conn, user, id)? {
            Some(role) => Ok(VaultInfo { id: id.into(), name, role }),
            None => Err(ApiError::Conflict("that vault belongs to someone else".into())),
        };
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO vaults (id, name, created_by, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, user, now],
    )?;
    tx.execute(
        "INSERT INTO members (vault_id, user_id, role, created_at) VALUES (?1, ?2, 'owner', ?3)",
        params![id, user, now],
    )?;
    tx.commit()?;
    Ok(VaultInfo { id: id.into(), name: name.into(), role: "owner".into() })
}

pub fn add_member(conn: &Connection, vault: &str, user: &str, role: &str, now: i64) -> cord_core::Result<()> {
    conn.execute(
        "INSERT INTO members (vault_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (vault_id, user_id) DO UPDATE SET role = excluded.role",
        params![vault, user, role, now],
    )?;
    Ok(())
}

/// Store new changes from `user` in one transaction. A repeated id is
/// accepted again but stored once.
pub fn append(conn: &Connection, user: &str, vault: &str, changes: &[WireChange], now: i64) -> Result<Appended, ApiError> {
    if changes.len() > MAX_BATCH {
        return Err(ApiError::BadRequest(format!("at most {MAX_BATCH} changes per request")));
    }
    match role(conn, user, vault)?.as_deref() {
        Some("owner" | "editor") => {}
        _ => return Err(ApiError::Forbidden),
    }
    let tx = conn.unchecked_transaction()?;
    let start: i64 = tx.query_row("SELECT seq FROM vaults WHERE id = ?1", [vault], |r| r.get(0))?;
    let mut seq = start;
    let mut reply = PushReply::default();
    for c in changes {
        let refuse = |reason: &str| Rejected { id: c.id.clone(), reason: reason.into() };
        if c.vault_id != vault {
            reply.rejected.push(refuse("the change is for another vault"));
            continue;
        }
        if c.author_user_id != user {
            reply.rejected.push(refuse("the change names another author"));
            continue;
        }
        if let Err(reason) = wire::validate(c) {
            reply.rejected.push(refuse(&reason));
            continue;
        }
        let seen = tx
            .query_row("SELECT 1 FROM changes WHERE vault_id = ?1 AND id = ?2", params![vault, c.id], |_| Ok(()))
            .optional()?
            .is_some();
        if !seen {
            seq += 1;
            tx.execute(
                "INSERT INTO changes (vault_id, seq, id, entity_type, entity_id, kind, field, hlc,
                                      author_device_id, author_user_id, payload, received_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    vault, seq, c.id, c.entity_type, c.entity_id, c.kind, c.field, c.hlc,
                    c.author_device_id, c.author_user_id, c.payload, now
                ],
            )?;
        }
        reply.accepted.push(c.id.clone());
    }
    tx.execute("UPDATE vaults SET seq = ?2 WHERE id = ?1", params![vault, seq])?;
    tx.commit()?;
    Ok(Appended { reply, seq, grew: seq > start })
}

/// Up to MAX_BATCH changes after `after`, in order.
pub fn read_after(conn: &Connection, vault: &str, after: i64) -> cord_core::Result<Page> {
    let mut st = conn.prepare(
        "SELECT id, vault_id, entity_type, entity_id, kind, field, hlc, author_device_id,
                author_user_id, payload, seq, received_at
         FROM changes WHERE vault_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3",
    )?;
    let rows = st.query_map(params![vault, after, MAX_BATCH as i64 + 1], |r| {
        Ok(WireChange {
            id: r.get(0)?,
            vault_id: r.get(1)?,
            entity_type: r.get(2)?,
            entity_id: r.get(3)?,
            kind: r.get(4)?,
            field: r.get(5)?,
            hlc: r.get(6)?,
            author_device_id: r.get(7)?,
            author_user_id: r.get(8)?,
            payload: r.get(9)?,
            seq: Some(r.get(10)?),
            received_at: Some(r.get(11)?),
        })
    })?;
    let mut changes: Vec<WireChange> = rows.collect::<cord_core::rusqlite::Result<_>>()?;
    let more = changes.len() > MAX_BATCH;
    changes.truncate(MAX_BATCH);
    Ok(Page { changes, more })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use cord_core::changes::PAYLOAD_FORMAT_V1;
    use cord_core::hlc::Hlc;

    pub(crate) fn change(id: &str, vault: &str, user: &str, title: &str) -> WireChange {
        WireChange {
            id: id.into(),
            vault_id: vault.into(),
            entity_type: "note".into(),
            entity_id: "n1".into(),
            kind: "field_set".into(),
            field: Some("title".into()),
            hlc: Hlc { wall: 1, counter: 0, device: "d".into() }.encode(),
            author_device_id: "d".into(),
            author_user_id: user.into(),
            payload: [&[PAYLOAD_FORMAT_V1][..], serde_json::to_string(title).unwrap().as_bytes()].concat(),
            seq: None,
            received_at: None,
        }
    }

    fn db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open(dir.path()).unwrap();
        (dir, conn)
    }

    #[test]
    fn creating_a_vault_makes_you_its_owner_and_is_repeatable() {
        let (_d, c) = db();
        let info = create_vault(&c, "u1", "v1", "Shared", 1).unwrap();
        assert_eq!(info.role, "owner");
        assert_eq!(create_vault(&c, "u1", "v1", "Shared", 2).unwrap(), info);
        assert!(matches!(create_vault(&c, "u2", "v1", "Mine", 3), Err(ApiError::Conflict(_))));
        assert_eq!(vaults_for(&c, "u1").unwrap(), [info]);
        assert!(vaults_for(&c, "u2").unwrap().is_empty());
    }

    #[test]
    fn appends_once_per_id_and_counts_per_vault() {
        let (_d, c) = db();
        create_vault(&c, "u1", "v1", "V", 1).unwrap();
        let reply = append(&c, "u1", "v1", &[change("a", "v1", "u1", "A"), change("b", "v1", "u1", "B")], 5).unwrap();
        assert_eq!((reply.reply.accepted.len(), reply.seq), (2, 2));
        let again = append(&c, "u1", "v1", &[change("a", "v1", "u1", "A")], 6).unwrap();
        assert_eq!((again.reply.accepted, again.seq), (vec!["a".to_owned()], 2));
        let page = read_after(&c, "v1", 0).unwrap();
        assert_eq!(page.changes.iter().map(|c| c.seq.unwrap()).collect::<Vec<_>>(), [1, 2]);
        assert_eq!(page.changes[0].received_at, Some(5));
        assert!(!page.more);
        assert_eq!(read_after(&c, "v1", 1).unwrap().changes[0].id, "b");
    }

    #[test]
    fn bad_changes_are_rejected_with_a_reason_and_the_rest_kept() {
        let (_d, c) = db();
        create_vault(&c, "u1", "v1", "V", 1).unwrap();
        let mut bad = change("bad", "v1", "u1", "x");
        bad.field = Some("password".into());
        let other_vault = change("elsewhere", "v2", "u1", "x");
        let forged = change("forged", "v1", "someone-else", "x");
        let reply = append(&c, "u1", "v1", &[bad, change("ok", "v1", "u1", "A"), other_vault, forged], 1).unwrap();
        assert_eq!(reply.reply.accepted, ["ok"]);
        let ids: Vec<&str> = reply.reply.rejected.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["bad", "elsewhere", "forged"]);
        assert!(reply.reply.rejected.iter().all(|r| !r.reason.is_empty()));
    }

    #[test]
    fn only_members_may_write_or_read() {
        let (_d, c) = db();
        create_vault(&c, "u1", "v1", "V", 1).unwrap();
        assert_eq!(append(&c, "u2", "v1", &[change("a", "v1", "u2", "A")], 1).unwrap_err(), ApiError::Forbidden);
        assert_eq!(role(&c, "u2", "v1").unwrap(), None);
        add_member(&c, "v1", "u2", "editor", 2).unwrap();
        assert!(append(&c, "u2", "v1", &[change("a", "v1", "u2", "A")], 3).is_ok());
    }

    #[test]
    fn pages_are_capped_and_say_when_more_remain() {
        let (_d, c) = db();
        create_vault(&c, "u1", "v1", "V", 1).unwrap();
        for n in 0..3 {
            let chunk: Vec<WireChange> = (0..250).map(|i| change(&format!("c{n}-{i}"), "v1", "u1", "t")).collect();
            append(&c, "u1", "v1", &chunk, 1).unwrap();
        }
        let first = read_after(&c, "v1", 0).unwrap();
        assert_eq!((first.changes.len(), first.more), (MAX_BATCH, true));
        let rest = read_after(&c, "v1", MAX_BATCH as i64).unwrap();
        assert_eq!((rest.changes.len(), rest.more), (250, false));
    }
}
