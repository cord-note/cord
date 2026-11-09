use std::collections::HashMap;

use cord_core::agents;
use cord_core::services::{notes, queries};
use cord_core::session::Session;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::core::{err, run, Shared};
use crate::mcp::server::McpState;

#[derive(Deserialize)]
pub struct AgentsIn {
    pub allow: bool,
    pub edit: bool,
    pub vaults: Vec<String>,
}

async fn view(core: &Shared, state: &McpState) -> Result<Value, String> {
    let user = core.me()?;
    let s = agents::load(&core.layout, &user).map_err(err)?;
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    Ok(json!({
        "allow": s.allow, "edit": s.edit, "vaults": s.vaults, "hasToken": s.token_hash.is_some(),
        "port": state.port().await, "exe": exe,
    }))
}

#[tauri::command]
pub async fn agents_get(core: State<'_, Shared>, state: State<'_, McpState>) -> Result<Value, String> {
    view(&core, &state).await
}

#[tauri::command]
pub async fn agents_update(core: State<'_, Shared>, state: State<'_, McpState>, data: AgentsIn) -> Result<Value, String> {
    let user = core.me()?;
    let mut s = agents::load(&core.layout, &user).map_err(err)?;
    s.allow = data.allow;
    s.edit = data.edit;
    s.vaults = data.vaults;
    agents::save(&core.layout, &user, &s).map_err(err)?;
    view(&core, &state).await
}

#[tauri::command]
pub async fn agents_new_token(core: State<'_, Shared>) -> Result<Value, String> {
    let user = core.me()?;
    let token = agents::new_token(&core.layout, &user).map_err(err)?;
    Ok(json!({ "token": token }))
}

/// Recent agent calls, newest first, each with the note it touched (if any).
#[tauri::command]
pub async fn agents_activity(core: State<'_, Shared>) -> Result<Value, String> {
    let user = core.me()?;
    let list = agents::activity(&core.layout, &user).map_err(err)?;
    run(&core, move |c| {
        c.session(|s| {
            let mut seen: HashMap<String, Option<Value>> = HashMap::new();
            let mut out = Vec::with_capacity(list.len());
            for a in list {
                let note = match a.target.as_deref() {
                    Some(id) => match seen.get(id) {
                        Some(n) => n.clone(),
                        None => {
                            let n = note_of(s, id)?;
                            seen.insert(id.to_owned(), n.clone());
                            n
                        }
                    },
                    None => None,
                };
                out.push(json!({ "at": a.at, "tool": a.tool, "target": a.target, "ok": a.ok, "error": a.error, "note": note }));
            }
            Ok(out)
        })
    })
    .await
}

/// The note a target id names: the note itself, or the note holding a block.
pub(crate) fn note_of(s: &Session, id: &str) -> cord_core::Result<Option<Value>> {
    let note = match notes::get(s, id)? {
        Some(n) => Some(n),
        None => match queries::resolve_ref(s, id)? {
            Some(b) => notes::get(s, &b.note_id)?,
            None => None,
        },
    };
    Ok(note.map(|n| json!({ "id": n.meta.id, "title": n.meta.title, "vaultId": n.meta.vault_id, "deleted": n.meta.deleted_at.is_some() })))
}

#[cfg(test)]
mod tests {
    use super::note_of;
    use crate::mcp::tools::tests::world;

    #[test]
    fn activity_targets_name_their_note() {
        let w = world();
        let by_note = w.core.session(|s| note_of(s, &w.note)).unwrap().unwrap();
        assert_eq!(by_note["title"], "Birds");
        let by_block = w.core.session(|s| note_of(s, "b1")).unwrap().unwrap();
        assert_eq!(by_block["id"], w.note.as_str());
        assert!(w.core.session(|s| note_of(s, "pelican")).unwrap().is_none());
    }
}
