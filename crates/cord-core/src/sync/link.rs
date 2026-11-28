//! Connecting vaults to a server, and disconnecting them.

use rusqlite::types::ValueRef;
use rusqlite::{params, Connection};
use serde_json::{Map, Value};

use crate::changes::{self, ChangeKind, NewChange};
use crate::clock;
use crate::entity::{self, Entity};
use crate::hlc::Hlc;
use crate::session::{Inbound, Session};
use crate::{Error, Result};

/// Link a local vault to a connection (two-way) and queue its whole current
/// state for that connection. Returns how many changes were queued.
pub fn link_vault(s: &mut Session, connection_id: &str, vault_id: &str, role: &str) -> Result<usize> {
    s.inbound(|i| {
        let exists: bool = i
            .conn
            .query_row("SELECT 1 FROM vaults WHERE id = ?1", [vault_id], |_| Ok(true))
            .unwrap_or(false);
        if !exists {
            return Err(Error::NotFound(format!("vault {vault_id}")));
        }
        insert_link(i.conn, connection_id, vault_id, role, i.now)?;
        let targets = [connection_id.to_owned()];
        let mut queued = 0;
        for entity in Entity::ALL {
            for row in read_rows(i.conn, entity, vault_id)? {
                queued += queue_row(i, entity, vault_id, &row, &targets)?;
            }
        }
        queued += queue_bodies(i, vault_id, &targets)?;
        Ok(queued)
    })
}

/// Link a vault that lives on the server and will arrive by pulling.
pub fn attach_server_vault(conn: &Connection, connection_id: &str, vault_id: &str, role: &str, now_ms: i64) -> Result<()> {
    insert_link(conn, connection_id, vault_id, role, now_ms)
}

/// Stop syncing a vault with a connection and forget what it was still owed.
/// The local vault is untouched.
pub fn unlink_vault(conn: &Connection, connection_id: &str, vault_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM change_pending WHERE connection_id = ?1
         AND change_id IN (SELECT id FROM changes WHERE vault_id = ?2)",
        params![connection_id, vault_id],
    )?;
    conn.execute(
        "DELETE FROM changes WHERE vault_id = ?1
         AND NOT EXISTS (SELECT 1 FROM change_pending WHERE change_id = changes.id)",
        [vault_id],
    )?;
    conn.execute("DELETE FROM sync_parked WHERE connection_id = ?1 AND vault_id = ?2", params![connection_id, vault_id])?;
    conn.execute(
        "DELETE FROM vault_connections WHERE connection_id = ?1 AND vault_id = ?2",
        params![connection_id, vault_id],
    )?;
    Ok(())
}

fn insert_link(conn: &Connection, connection_id: &str, vault_id: &str, role: &str, now_ms: i64) -> Result<()> {
    let added = conn.execute(
        "INSERT INTO vault_connections (vault_id, connection_id, server_vault_id, mode, role, created_at)
         VALUES (?1, ?2, ?1, 'two_way', ?3, ?4) ON CONFLICT DO NOTHING",
        params![vault_id, connection_id, role, now_ms],
    )?;
    if added == 0 {
        return Err(Error::Invalid(format!("vault {vault_id} is already linked to this server")));
    }
    Ok(())
}

/// Every row of `entity` in the vault, as the create payload: key, fields and fixed columns.
fn read_rows(conn: &Connection, entity: Entity, vault_id: &str) -> Result<Vec<Map<String, Value>>> {
    let cols: Vec<&str> = entity.key().iter().chain(entity.fields()).chain(entity.fixed()).copied().collect();
    let filter = if entity == Entity::Vault { "id" } else { "vault_id" };
    let sql = format!("SELECT {} FROM {} WHERE {filter} = ?1", cols.join(", "), entity.table());
    let mut st = conn.prepare(&sql)?;
    let mut rows = st.query([vault_id])?;
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        let mut map = Map::new();
        for (i, col) in cols.iter().enumerate() {
            let v = match r.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => Value::from(n),
                ValueRef::Real(f) => Value::from(f),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Blob(_) => return Err(Error::Invalid(format!("{}.{col} is binary", entity.as_str()))),
            };
            map.insert((*col).to_owned(), v);
        }
        out.push(map);
    }
    Ok(out)
}

/// One create stamped with the row's oldest field clock, then a field change
/// for each field with a newer clock.
fn queue_row(i: &mut Inbound<'_>, entity: Entity, vault_id: &str, row: &Map<String, Value>, targets: &[String]) -> Result<usize> {
    let row_value = Value::Object(row.clone());
    let id = entity::row_id(entity, &row_value)?;
    let mut clocks: Vec<(&str, Hlc)> = Vec::new();
    for field in entity.fields() {
        if let Some(h) = clock::get(i.conn, &id, field)? {
            clocks.push((field, h));
        }
    }
    let created = match clocks.iter().map(|(_, h)| h).min() {
        Some(h) => h.clone(),
        None => i.clock.tick(i.now as u64),
    };
    let payload = serde_json::to_vec(&row_value).map_err(|e| Error::Invalid(e.to_string()))?;
    queue(i, vault_id, entity, &id, ChangeKind::Create, None, &created, &payload, targets)?;
    let mut n = 1;
    for (field, h) in &clocks {
        if *h > created {
            let value = serde_json::to_vec(&row[*field]).map_err(|e| Error::Invalid(e.to_string()))?;
            queue(i, vault_id, entity, &id, ChangeKind::FieldSet, Some(field), h, &value, targets)?;
            n += 1;
        }
    }
    Ok(n)
}

/// One full-state body update per note in the vault.
fn queue_bodies(i: &mut Inbound<'_>, vault_id: &str, targets: &[String]) -> Result<usize> {
    let bodies: Vec<(String, Vec<u8>)> = {
        let mut st = i.conn.prepare(
            "SELECT b.note_id, b.yjs_state FROM note_bodies b JOIN notes n ON n.id = b.note_id WHERE n.vault_id = ?1",
        )?;
        let rows = st.query_map([vault_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (note_id, state) in &bodies {
        let hlc = i.clock.tick(i.now as u64);
        queue(i, vault_id, Entity::Note, note_id, ChangeKind::BodyUpdate, None, &hlc, state, targets)?;
    }
    Ok(bodies.len())
}

#[allow(clippy::too_many_arguments)]
fn queue(
    i: &Inbound<'_>,
    vault_id: &str,
    entity: Entity,
    entity_id: &str,
    kind: ChangeKind,
    field: Option<&str>,
    hlc: &Hlc,
    payload: &[u8],
    targets: &[String],
) -> Result<()> {
    let change = NewChange {
        vault_id,
        entity_type: entity.as_str(),
        entity_id,
        kind,
        field,
        hlc,
        author_device_id: i.device_id,
        author_user_id: i.user_id,
        payload,
    };
    changes::record_for(i.conn, &change, i.now, targets)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::DataLayout;
    use crate::model::{NewNote, NewTag, NewVault, NoteChanges};
    use crate::services::{notes, tags, vaults};
    use crate::sync::apply::apply_batch;
    use crate::sync::outbox::{confirm, next_batch};

    fn device(name: &str) -> (tempfile::TempDir, Session) {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = Session::open(&DataLayout::new(dir.path()), name, "u1", None).unwrap();
        (dir, s)
    }

    fn rows(s: &Session, sql: &str) -> Vec<String> {
        let mut st = s.conn().prepare(sql).unwrap();
        st.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn a_linked_vault_arrives_whole_on_another_device() {
        let (_a, mut a) = device("dev-a");
        let v = vaults::create(&mut a, NewVault { name: "Shared".into(), ..Default::default() }).unwrap();
        let n = notes::create(&mut a, NewNote { vault_id: v.id.clone(), title: Some("First".into()), ..Default::default() }).unwrap();
        notes::update(&mut a, &n.meta.id, NoteChanges { title: Some("Renamed".into()), ..Default::default() }).unwrap();
        let t = tags::create(&mut a, NewTag { vault_id: v.id.clone(), name: "idea".into(), color: None }).unwrap();
        tags::attach(&mut a, &n.meta.id, &t.id).unwrap();

        let queued = link_vault(&mut a, "c1", &v.id, "owner").unwrap();
        assert!(queued >= 5);
        let batch = next_batch(a.conn(), "c1").unwrap();
        assert_eq!(batch.changes[0].entity_type, "vault");

        let (_b, mut b) = device("dev-b");
        attach_server_vault(b.conn(), "c1", &v.id, "owner", 1).unwrap();
        let out = apply_batch(&mut b, "c1", &v.id, &batch.changes).unwrap();
        assert_eq!(out.parked, 0);
        assert_eq!(rows(&b, "SELECT title FROM notes"), ["Renamed"]);
        assert_eq!(rows(&b, "SELECT name FROM tags"), ["idea"]);
        assert_eq!(rows(&b, "SELECT tag_id FROM note_tags"), [t.id.clone()]);
        assert_eq!(
            rows(&a, "SELECT body_json FROM idx.note_docs"),
            rows(&b, "SELECT body_json FROM idx.note_docs")
        );
        let ids: Vec<String> = batch.changes.iter().map(|c| c.id.clone()).collect();
        confirm(a.conn(), "c1", &batch, &ids).unwrap();
    }

    #[test]
    fn field_clocks_survive_the_trip() {
        let (_a, mut a) = device("dev-a");
        let v = vaults::create(&mut a, NewVault { name: "Shared".into(), ..Default::default() }).unwrap();
        let n = notes::create(&mut a, NewNote { vault_id: v.id.clone(), title: Some("First".into()), ..Default::default() }).unwrap();
        notes::update(&mut a, &n.meta.id, NoteChanges { title: Some("Renamed".into()), ..Default::default() }).unwrap();
        link_vault(&mut a, "c1", &v.id, "owner").unwrap();
        let (_b, mut b) = device("dev-b");
        attach_server_vault(b.conn(), "c1", &v.id, "owner", 1).unwrap();
        apply_batch(&mut b, "c1", &v.id, &next_batch(a.conn(), "c1").unwrap().changes).unwrap();
        let clock = |s: &Session| clock::get(s.conn(), &n.meta.id, "title").unwrap();
        assert_eq!(clock(&a), clock(&b));
    }

    #[test]
    fn linking_twice_is_refused() {
        let (_a, mut a) = device("dev-a");
        let v = vaults::create(&mut a, NewVault { name: "V".into(), ..Default::default() }).unwrap();
        link_vault(&mut a, "c1", &v.id, "owner").unwrap();
        assert!(link_vault(&mut a, "c1", &v.id, "owner").is_err());
    }

    #[test]
    fn unlinking_forgets_what_was_owed_and_stops_recording() {
        let (_a, mut a) = device("dev-a");
        let v = vaults::create(&mut a, NewVault { name: "V".into(), ..Default::default() }).unwrap();
        link_vault(&mut a, "c1", &v.id, "owner").unwrap();
        unlink_vault(a.conn(), "c1", &v.id).unwrap();
        assert!(next_batch(a.conn(), "c1").unwrap().changes.is_empty());
        assert!(rows(&a, "SELECT id FROM changes").is_empty());
        notes::create(&mut a, NewNote { vault_id: v.id.clone(), title: Some("x".into()), ..Default::default() }).unwrap();
        assert!(rows(&a, "SELECT id FROM changes").is_empty());
    }
}
