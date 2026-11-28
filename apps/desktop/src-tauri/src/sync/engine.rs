//! One sync step at a time: send what is owed, pull what is new, and tell the
//! renderer what changed. The loop around these lives in `state.rs`.

use cord_core::sync::apply::{self, Applied};
use cord_core::sync::wire::{Rejected, WireChange};
use cord_core::sync::{connections, link, outbox};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::core::Shared;
use crate::sync::client::{Client, SyncError};
use crate::sync::with_session;

/// Send everything this connection is owed. Returns how many changes the
/// server accepted. A vault the server no longer lets us into is unlinked.
pub async fn push_all(core: &Shared, client: &Client, conn_id: &str) -> Result<usize, SyncError> {
    let mut sent = 0;
    loop {
        let id = conn_id.to_owned();
        let batch = with_session(core, move |s| outbox::next_batch(s.conn(), &id)).await?;
        if batch.changes.is_empty() {
            return Ok(sent);
        }
        let mut accepted: Vec<String> = Vec::new();
        let mut rejected: Vec<Rejected> = Vec::new();
        let mut gone: Vec<String> = Vec::new();
        let mut failure = None;
        for (vault, changes) in by_vault(&batch.changes) {
            match client.push(&vault, changes).await {
                Ok(reply) => {
                    accepted.extend(reply.accepted);
                    rejected.extend(reply.rejected);
                }
                Err(SyncError::Forbidden | SyncError::NotFound) => gone.push(vault),
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            }
        }
        let progressed = !accepted.is_empty() || !rejected.is_empty() || !gone.is_empty();
        sent += accepted.len();
        let id = conn_id.to_owned();
        with_session(core, move |s| {
            outbox::confirm(s.conn(), &id, &batch, &accepted)?;
            outbox::reject(s.conn(), &id, &batch, &rejected, s.now())?;
            for vault in &gone {
                link::unlink_vault(s.conn(), &id, vault)?;
            }
            Ok(())
        })
        .await?;
        if let Some(e) = failure {
            return Err(e);
        }
        if !progressed {
            return Ok(sent);
        }
    }
}

/// Split a batch per vault, keeping order inside each.
fn by_vault(changes: &[WireChange]) -> Vec<(String, Vec<WireChange>)> {
    let mut out: Vec<(String, Vec<WireChange>)> = Vec::new();
    for c in changes {
        match out.iter_mut().find(|(v, _)| *v == c.vault_id) {
            Some((_, list)) => list.push(c.clone()),
            None => out.push((c.vault_id.clone(), vec![c.clone()])),
        }
    }
    out
}

/// Pull everything after the bookmark for one vault. Returns how many changes applied.
pub async fn pull_vault(core: &Shared, events: Option<&AppHandle>, client: &Client, conn_id: &str, vault: &str) -> Result<usize, SyncError> {
    let mut total = 0;
    loop {
        let (id, v) = (conn_id.to_owned(), vault.to_owned());
        let after = with_session(core, move |s| connections::bookmark(s.conn(), &id, &v)).await?;
        let page = match client.pull(vault, after).await {
            Ok(page) => page,
            Err(SyncError::Forbidden | SyncError::NotFound) => {
                let (id, v) = (conn_id.to_owned(), vault.to_owned());
                with_session(core, move |s| link::unlink_vault(s.conn(), &id, &v)).await?;
                eprintln!("[sync] vault {vault} is no longer on the server; unlinked, local copy kept");
                return Ok(total);
            }
            Err(e) => return Err(e),
        };
        let more = page.more;
        let (id, v) = (conn_id.to_owned(), vault.to_owned());
        let applied = with_session(core, move |s| apply::apply_batch(s, &id, &v, &page.changes)).await?;
        if applied.parked > 0 {
            eprintln!("[sync] {} change(s) in vault {vault} set aside for now", applied.parked);
        }
        total += applied.applied;
        tell(events, &applied);
        if !more {
            return Ok(total);
        }
    }
}

/// Push, then pull every linked vault, then note the time.
pub async fn sync_once(core: &Shared, events: Option<&AppHandle>, client: &Client, conn_id: &str) -> Result<(), SyncError> {
    push_all(core, client, conn_id).await?;
    let id = conn_id.to_owned();
    let vaults = with_session(core, move |s| connections::vaults(s.conn(), &id)).await?;
    for vault in vaults {
        pull_vault(core, events, client, conn_id, &vault).await?;
    }
    let id = conn_id.to_owned();
    with_session(core, move |s| connections::touch(s.conn(), &id, s.now())).await?;
    Ok(())
}

/// The same events agents use, so lists, tags and open editors refresh.
fn tell(events: Option<&AppHandle>, applied: &Applied) {
    let Some(app) = events else { return };
    for (note_id, update) in &applied.bodies {
        let _ = app.emit("note-body-changed", json!({ "noteId": note_id, "update": update }));
    }
    for vault in &applied.vaults {
        let _ = app.emit("notes-changed", json!({ "vaultId": vault }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cord_core::changes::PAYLOAD_FORMAT_V1;

    fn c(id: &str, vault: &str) -> WireChange {
        WireChange {
            id: id.into(),
            vault_id: vault.into(),
            entity_type: "note".into(),
            entity_id: "n".into(),
            kind: "create".into(),
            field: None,
            hlc: "0000000000001-000000-d".into(),
            author_device_id: "d".into(),
            author_user_id: "u".into(),
            payload: vec![PAYLOAD_FORMAT_V1],
            seq: None,
            received_at: None,
        }
    }

    #[test]
    fn by_vault_keeps_order_within_each_vault() {
        let groups = by_vault(&[c("1", "a"), c("2", "b"), c("3", "a")]);
        let ids: Vec<(String, Vec<String>)> =
            groups.into_iter().map(|(v, l)| (v, l.into_iter().map(|c| c.id).collect())).collect();
        assert_eq!(ids, [("a".into(), vec!["1".into(), "3".into()]), ("b".into(), vec!["2".into()])]);
    }
}
