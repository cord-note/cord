//! Applying changes received from a server.

use std::collections::BTreeSet;

use rusqlite::{params, Connection};
use serde_json::Value;

use crate::entity::{self, Entity};
use crate::hlc::Hlc;
use crate::session::{Inbound, Session};
use crate::sync::wire::{self, WireChange};
use crate::{Error, Result};

/// What one applied batch changed, for the shell to tell the renderer.
#[derive(Debug, Default)]
pub struct Applied {
    pub applied: usize,
    pub parked: usize,
    /// Vaults where something changed.
    pub vaults: BTreeSet<String>,
    /// Body updates that applied: (note id, Yjs update), for open editors.
    pub bodies: Vec<(String, Vec<u8>)>,
}

/// Apply changes pulled for `vault_id` from `connection_id`, in one transaction,
/// then retry what was parked earlier and save the bookmark.
pub fn apply_batch(s: &mut Session, connection_id: &str, vault_id: &str, changes: &[WireChange]) -> Result<Applied> {
    s.inbound(|i| {
        let mut out = Applied::default();
        for ch in changes {
            if ch.author_device_id == i.device_id {
                continue;
            }
            match try_one(i, ch) {
                Ok(applied) => note(&mut out, ch, applied),
                Err(e) => {
                    park(i.conn, connection_id, ch, &e.to_string(), i.now)?;
                    out.parked += 1;
                }
            }
        }
        retry_parked(i, connection_id, &mut out)?;
        if let Some(seq) = changes.iter().filter_map(|c| c.seq).max() {
            i.conn.execute(
                "UPDATE vault_connections SET bookmark = max(bookmark, ?3)
                 WHERE vault_id = ?1 AND connection_id = ?2",
                params![vault_id, connection_id, seq],
            )?;
        }
        Ok(out)
    })
}

fn note(out: &mut Applied, ch: &WireChange, applied: bool) {
    if !applied {
        return;
    }
    out.applied += 1;
    out.vaults.insert(ch.vault_id.clone());
    if ch.kind == "body_update" {
        out.bodies.push((ch.entity_id.clone(), ch.payload[1..].to_vec()));
    }
}

/// Apply one change in a savepoint; a failure leaves nothing behind.
fn try_one(i: &mut Inbound<'_>, ch: &WireChange) -> Result<bool> {
    i.conn.execute_batch("SAVEPOINT sync_one")?;
    match apply_one(i.conn, ch) {
        Ok(applied) => {
            i.conn.execute_batch("RELEASE sync_one")?;
            i.clock.observe(&Hlc::parse(&ch.hlc)?, i.now as u64);
            Ok(applied)
        }
        Err(e) => {
            i.conn.execute_batch("ROLLBACK TO sync_one; RELEASE sync_one")?;
            Err(e)
        }
    }
}

fn apply_one(conn: &Connection, ch: &WireChange) -> Result<bool> {
    let entity: Entity = wire::validate(ch).map_err(Error::Invalid)?;
    let hlc = Hlc::parse(&ch.hlc)?;
    let body = &ch.payload[1..];
    match ch.kind.as_str() {
        "create" => entity::apply_create(conn, entity, &json(body)?, &hlc),
        "field_set" => {
            let field = ch.field.as_deref().unwrap_or_default();
            entity::apply_field(conn, entity, &ch.entity_id, field, &json(body)?, &hlc)
        }
        _ => entity::apply_body(conn, &ch.entity_id, body, &hlc),
    }
}

fn json(bytes: &[u8]) -> Result<Value> {
    serde_json::from_slice(bytes).map_err(|e| Error::Invalid(format!("bad change payload: {e}")))
}

fn park(conn: &Connection, connection_id: &str, ch: &WireChange, reason: &str, now: i64) -> Result<()> {
    let text = serde_json::to_string(ch).map_err(|e| Error::Invalid(e.to_string()))?;
    conn.execute(
        "INSERT INTO sync_parked (id, connection_id, vault_id, change_json, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (id, connection_id) DO UPDATE SET reason = excluded.reason, attempts = attempts + 1",
        params![ch.id, connection_id, ch.vault_id, text, reason, now],
    )?;
    Ok(())
}

/// Try parked changes again, oldest first, until a pass applies nothing new.
fn retry_parked(i: &mut Inbound<'_>, connection_id: &str, out: &mut Applied) -> Result<()> {
    loop {
        let waiting: Vec<(String, String)> = {
            let mut st = i.conn.prepare(
                "SELECT id, change_json FROM sync_parked WHERE connection_id = ?1 ORDER BY created_at, id",
            )?;
            let rows = st.query_map([connection_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let mut progressed = false;
        for (id, text) in waiting {
            let ch: WireChange = serde_json::from_str(&text).map_err(|e| Error::Invalid(e.to_string()))?;
            match try_one(i, &ch) {
                Ok(applied) => {
                    i.conn.execute(
                        "DELETE FROM sync_parked WHERE id = ?1 AND connection_id = ?2",
                        params![id, connection_id],
                    )?;
                    note(out, &ch, applied);
                    progressed = true;
                }
                Err(e) => {
                    i.conn.execute(
                        "UPDATE sync_parked SET reason = ?3, attempts = attempts + 1
                         WHERE id = ?1 AND connection_id = ?2",
                        params![id, connection_id, e.to_string()],
                    )?;
                }
            }
        }
        if !progressed {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::PAYLOAD_FORMAT_V1;
    use crate::layout::DataLayout;
    use serde_json::json;

    fn device(name: &str) -> (tempfile::TempDir, Session) {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = Session::open(&DataLayout::new(dir.path()), name, "u1", None).unwrap();
        (dir, s)
    }

    #[allow(clippy::too_many_arguments)]
    fn wire(id: &str, entity: &str, entity_id: &str, kind: &str, field: Option<&str>, wall: u64, author: &str, payload: &[u8]) -> WireChange {
        WireChange {
            id: id.into(),
            vault_id: "v1".into(),
            entity_type: entity.into(),
            entity_id: entity_id.into(),
            kind: kind.into(),
            field: field.map(str::to_owned),
            hlc: Hlc { wall, counter: 0, device: author.into() }.encode(),
            author_device_id: author.into(),
            author_user_id: "u1".into(),
            payload: [&[PAYLOAD_FORMAT_V1][..], payload].concat(),
            seq: None,
            received_at: None,
        }
    }

    fn vault_create(wall: u64) -> WireChange {
        let row = json!({ "id": "v1", "name": "Shared", "created_at": 1, "updated_at": 1 });
        wire("c-vault", "vault", "v1", "create", None, wall, "other", row.to_string().as_bytes())
    }

    fn rename(id: &str, name: &str, wall: u64) -> WireChange {
        wire(id, "vault", "v1", "field_set", Some("name"), wall, "other", json!(name).to_string().as_bytes())
    }

    fn name(s: &Session) -> Option<String> {
        s.conn().query_row("SELECT name FROM vaults WHERE id = 'v1'", [], |r| r.get(0)).ok()
    }

    fn parked(s: &Session) -> i64 {
        s.conn().query_row("SELECT count(*) FROM sync_parked", [], |r| r.get(0)).unwrap()
    }

    fn with_link(s: &Session) {
        s.conn()
            .execute(
                "INSERT INTO vault_connections (vault_id, connection_id, server_vault_id, mode, role, created_at)
                 VALUES ('v1', 'c1', 'v1', 'two_way', 'owner', 1)",
                [],
            )
            .unwrap();
    }

    #[test]
    fn applies_creates_and_fields_and_saves_the_bookmark() {
        let (_d, mut s) = device("me");
        with_link(&s);
        let mut a = vault_create(10);
        a.seq = Some(1);
        let mut b = rename("c2", "Renamed", 20);
        b.seq = Some(2);
        let applied = apply_batch(&mut s, "c1", "v1", &[a, b]).unwrap();
        assert_eq!(applied.applied, 2);
        assert_eq!(name(&s).as_deref(), Some("Renamed"));
        let bookmark: i64 = s.conn().query_row("SELECT bookmark FROM vault_connections", [], |r| r.get(0)).unwrap();
        assert_eq!(bookmark, 2);
        assert!(applied.vaults.contains("v1"));
    }

    #[test]
    fn a_field_before_its_row_is_parked_then_applied() {
        let (_d, mut s) = device("me");
        with_link(&s);
        let first = apply_batch(&mut s, "c1", "v1", &[rename("c2", "Renamed", 20)]).unwrap();
        assert_eq!((first.applied, first.parked), (0, 1));
        assert_eq!(parked(&s), 1);
        apply_batch(&mut s, "c1", "v1", &[vault_create(10)]).unwrap();
        assert_eq!(name(&s).as_deref(), Some("Renamed"));
        assert_eq!(parked(&s), 0);
    }

    #[test]
    fn own_and_repeated_changes_change_nothing() {
        let (_d, mut s) = device("me");
        with_link(&s);
        apply_batch(&mut s, "c1", "v1", &[vault_create(10), rename("c2", "Renamed", 20)]).unwrap();
        let mut mine = rename("c3", "Mine", 30);
        mine.author_device_id = "me".into();
        let again = apply_batch(&mut s, "c1", "v1", &[vault_create(10), rename("c2", "Renamed", 20), mine]).unwrap();
        assert_eq!(again.applied, 0);
        assert_eq!(name(&s).as_deref(), Some("Renamed"));
    }

    #[test]
    fn an_older_edit_loses() {
        let (_d, mut s) = device("me");
        with_link(&s);
        apply_batch(&mut s, "c1", "v1", &[vault_create(10), rename("c2", "New", 30), rename("c3", "Old", 20)]).unwrap();
        assert_eq!(name(&s).as_deref(), Some("New"));
    }

    #[test]
    fn a_broken_change_is_parked_and_the_rest_still_applies() {
        let (_d, mut s) = device("me");
        with_link(&s);
        let broken = wire("c9", "note", "n1", "body_update", None, 15, "other", b"not yjs");
        let out = apply_batch(&mut s, "c1", "v1", &[vault_create(10), broken, rename("c2", "Renamed", 20)]).unwrap();
        assert_eq!((out.applied, out.parked), (2, 1));
        assert_eq!(name(&s).as_deref(), Some("Renamed"));
        let reason: String = s.conn().query_row("SELECT reason FROM sync_parked", [], |r| r.get(0)).unwrap();
        assert!(!reason.is_empty());
    }

    #[test]
    fn received_stamps_move_the_clock_forward() {
        let (_d, mut s) = device("me");
        with_link(&s);
        apply_batch(&mut s, "c1", "v1", &[vault_create(9_000_000_000_000)]).unwrap();
        let stamp = s.inbound(|i| Ok(i.clock.tick(i.now as u64))).unwrap();
        assert!(stamp.wall >= 9_000_000_000_000);
    }
}
