//! What a connection is owed: batches to send, and confirming or rejecting them.

use std::collections::HashMap;

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

use crate::changes::{self, PAYLOAD_FORMAT_V1};
use crate::doc::yjs::merge_update;
use crate::sync::wire::{Rejected, WireChange, MAX_BATCH, MAX_BATCH_BYTES};
use crate::Result;

/// Changes to send now, and which outbox rows each one stands for.
#[derive(Debug, Default)]
pub struct Batch {
    pub changes: Vec<WireChange>,
    /// Sent change id -> the `changes` rows it covers (one, or several merged).
    pub covers: HashMap<String, Vec<String>>,
}

/// The next batch owed to `connection_id`, oldest stamp first.
pub fn next_batch(conn: &Connection, connection_id: &str) -> Result<Batch> {
    let mut st = conn.prepare(
        "SELECT c.id, c.vault_id, c.entity_type, c.entity_id, c.kind, c.field, c.hlc,
                c.author_device_id, c.author_user_id, c.payload
         FROM change_pending p JOIN changes c ON c.id = p.change_id
         WHERE p.connection_id = ?1 AND c.rejected_at IS NULL
         ORDER BY c.hlc",
    )?;
    let rows = st.query_map([connection_id], |r| {
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
            seq: None,
            received_at: None,
        })
    })?;
    build(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Merge body updates per note and stop at the size limits.
fn build(rows: Vec<WireChange>) -> Result<Batch> {
    let mut out: Vec<WireChange> = Vec::new();
    let mut covered: Vec<Vec<String>> = Vec::new();
    let mut body_at: HashMap<String, usize> = HashMap::new();
    let mut bytes = 0usize;
    for ch in rows {
        if ch.kind == "body_update" {
            if let Some(&i) = body_at.get(&ch.entity_id) {
                let merged = merge_update(&out[i].payload[1..], &ch.payload[1..])?;
                bytes = bytes - out[i].payload.len() + merged.len() + 1;
                out[i].payload = [&[PAYLOAD_FORMAT_V1][..], &merged].concat();
                out[i].hlc = out[i].hlc.clone().max(ch.hlc.clone());
                covered[i].push(ch.id);
                continue;
            }
        }
        if out.len() >= MAX_BATCH || (!out.is_empty() && bytes + ch.payload.len() > MAX_BATCH_BYTES) {
            break;
        }
        bytes += ch.payload.len();
        if ch.kind == "body_update" {
            body_at.insert(ch.entity_id.clone(), out.len());
        }
        covered.push(vec![ch.id.clone()]);
        out.push(ch);
    }
    let mut covers = HashMap::new();
    for (ch, ids) in out.iter_mut().zip(covered) {
        if ids.len() > 1 {
            ch.id = merged_id(&ids);
        }
        covers.insert(ch.id.clone(), ids);
    }
    Ok(Batch { changes: out, covers })
}

/// Same covered ids, same id: a resend is stored once by the server.
fn merged_id(ids: &[String]) -> String {
    let mut sorted = ids.to_vec();
    sorted.sort();
    let digest = Sha256::digest(sorted.join(",").as_bytes());
    let hex: String = digest.iter().take(12).map(|b| format!("{b:02x}")).collect();
    format!("m{hex}")
}

/// The server accepted these ids: drop what they cover from this connection's outbox.
pub fn confirm(conn: &Connection, connection_id: &str, batch: &Batch, accepted: &[String]) -> Result<()> {
    for id in accepted {
        for row in batch.covers.get(id).into_iter().flatten() {
            changes::confirm(conn, row, connection_id)?;
        }
    }
    Ok(())
}

/// The server refused these: mark them with the reason and stop sending them here.
pub fn reject(conn: &Connection, connection_id: &str, batch: &Batch, rejected: &[Rejected], now_ms: i64) -> Result<()> {
    for r in rejected {
        for row in batch.covers.get(&r.id).into_iter().flatten() {
            conn.execute(
                "UPDATE changes SET rejected_at = ?2, reject_reason = ?3 WHERE id = ?1",
                params![row, now_ms, r.reason],
            )?;
            conn.execute(
                "DELETE FROM change_pending WHERE change_id = ?1 AND connection_id = ?2",
                params![row, connection_id],
            )?;
        }
    }
    Ok(())
}

/// Time to send: a second since the last edit, or five since the oldest unsent one.
pub fn due(conn: &Connection, connection_id: &str, now_ms: i64) -> Result<bool> {
    let (oldest, newest): (Option<i64>, Option<i64>) = conn.query_row(
        "SELECT min(c.created_at), max(c.created_at)
         FROM change_pending p JOIN changes c ON c.id = p.change_id
         WHERE p.connection_id = ?1 AND c.rejected_at IS NULL",
        [connection_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(match (oldest, newest) {
        (Some(o), Some(n)) => now_ms - n >= 1_000 || now_ms - o >= 5_000,
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::yjs::{json_to_state, state_to_json};
    use crate::model::{NewNote, NewVault, NoteChanges};
    use crate::services::{notes, vaults};
    use crate::session::{connect, test_session, Session};
    use serde_json::json;

    fn vault_with_note(s: &mut Session) -> (String, String) {
        let v = vaults::create(s, NewVault { name: "V".into(), ..Default::default() }).unwrap();
        connect(s, &v.id);
        let n = notes::create(s, NewNote { vault_id: v.id.clone(), title: Some("A".into()), ..Default::default() }).unwrap();
        (v.id, n.meta.id)
    }

    fn para(text: &str) -> Vec<u8> {
        json_to_state(&json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [{ "type": "text", "text": text }] }
        ] }))
        .unwrap()
    }

    #[test]
    fn batch_holds_every_pending_change_in_stamp_order() {
        let (_d, mut s) = test_session();
        let (_v, n) = vault_with_note(&mut s);
        notes::update(&mut s, &n, NoteChanges { title: Some("B".into()), ..Default::default() }).unwrap();
        let b = next_batch(s.conn(), "c1").unwrap();
        let kinds: Vec<&str> = b.changes.iter().map(|c| c.kind.as_str()).collect();
        assert_eq!(kinds.first(), Some(&"create"));
        assert_eq!(kinds.last(), Some(&"field_set"));
        assert!(b.changes.windows(2).all(|w| w[0].hlc <= w[1].hlc));
    }

    #[test]
    fn body_updates_to_one_note_become_one_change() {
        let (_d, mut s) = test_session();
        let (_v, n) = vault_with_note(&mut s);
        notes::apply_body_update(&mut s, &n, &para("one")).unwrap();
        notes::apply_body_update(&mut s, &n, &para("two")).unwrap();
        let b = next_batch(s.conn(), "c1").unwrap();
        let bodies: Vec<&WireChange> = b.changes.iter().filter(|c| c.kind == "body_update").collect();
        assert_eq!(bodies.len(), 1);
        assert_eq!(bodies[0].payload[0], PAYLOAD_FORMAT_V1);
        let text = state_to_json(&bodies[0].payload[1..]).unwrap().to_string();
        assert!(text.contains("one") && text.contains("two"));
        assert!(b.covers[&bodies[0].id].len() >= 2);
    }

    #[test]
    fn a_merged_id_depends_only_on_what_it_covers() {
        let (_d, mut s) = test_session();
        let (_v, n) = vault_with_note(&mut s);
        notes::apply_body_update(&mut s, &n, &para("one")).unwrap();
        let first = next_batch(s.conn(), "c1").unwrap();
        let again = next_batch(s.conn(), "c1").unwrap();
        assert_eq!(first.changes, again.changes);
        notes::apply_body_update(&mut s, &n, &para("two")).unwrap();
        let more = next_batch(s.conn(), "c1").unwrap();
        let body_id = |b: &Batch| b.changes.iter().find(|c| c.kind == "body_update").unwrap().id.clone();
        assert_ne!(body_id(&first), body_id(&more));
    }

    #[test]
    fn confirming_drops_every_covered_change() {
        let (_d, mut s) = test_session();
        let (_v, n) = vault_with_note(&mut s);
        notes::apply_body_update(&mut s, &n, &para("one")).unwrap();
        let b = next_batch(s.conn(), "c1").unwrap();
        let ids: Vec<String> = b.changes.iter().map(|c| c.id.clone()).collect();
        confirm(s.conn(), "c1", &b, &ids).unwrap();
        assert!(next_batch(s.conn(), "c1").unwrap().changes.is_empty());
        let left: i64 = s.conn().query_row("SELECT count(*) FROM changes", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn rejecting_marks_the_change_and_stops_sending_it() {
        let (_d, mut s) = test_session();
        vault_with_note(&mut s);
        let b = next_batch(s.conn(), "c1").unwrap();
        let first = b.changes[0].id.clone();
        reject(s.conn(), "c1", &b, &[Rejected { id: first.clone(), reason: "nope".into() }], 5).unwrap();
        let again = next_batch(s.conn(), "c1").unwrap();
        assert!(again.changes.iter().all(|c| c.id != first));
        let reason: String = s
            .conn()
            .query_row("SELECT reject_reason FROM changes WHERE id = ?1", [&first], |r| r.get(0))
            .unwrap();
        assert_eq!(reason, "nope");
    }

    #[test]
    fn batches_stop_at_the_change_limit() {
        let (_d, mut s) = test_session();
        let (_v, n) = vault_with_note(&mut s);
        for i in 0..(MAX_BATCH + 10) {
            notes::update(&mut s, &n, NoteChanges { title: Some(format!("t{i}")), ..Default::default() }).unwrap();
        }
        assert_eq!(next_batch(s.conn(), "c1").unwrap().changes.len(), MAX_BATCH);
    }

    #[test]
    fn due_waits_for_a_quiet_second_but_not_past_five() {
        let (_d, mut s) = test_session();
        vault_with_note(&mut s);
        let (oldest, newest): (i64, i64) = s
            .conn()
            .query_row("SELECT min(created_at), max(created_at) FROM changes", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert!(!due(s.conn(), "c1", newest + 500).unwrap());
        assert!(due(s.conn(), "c1", newest + 1_000).unwrap());
        assert!(due(s.conn(), "c1", oldest + 5_000).unwrap());
        assert!(!due(s.conn(), "nobody", newest + 10_000).unwrap());
    }
}
