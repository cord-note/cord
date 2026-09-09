use crate::search;
use crate::state::AppState;
use super::http::{fwd_get, fwd_patch, fwd_post};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn notes_list(state: State<'_, AppState>, vault_id: String) -> Result<Value, String> {
    fwd_get(&state, &format!("/notes?vaultId={vault_id}")).await
}

#[tauri::command]
pub async fn notes_get(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    fwd_get(&state, &format!("/notes/{id}")).await
}

#[tauri::command]
pub async fn notes_create(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/notes", data).await
}

#[tauri::command]
pub async fn notes_update(
    state: State<'_, AppState>,
    id: String,
    data: Value,
) -> Result<Value, String> {
    fwd_patch(&state, &format!("/notes/{id}"), data).await
}

#[tauri::command]
pub async fn notes_delete(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    fwd_post(&state, &format!("/notes/{id}/delete"), Value::Null).await
}

#[tauri::command]
pub async fn notes_restore(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    fwd_post(&state, &format!("/notes/{id}/restore"), Value::Null).await
}

#[tauri::command]
pub async fn notes_list_deleted(
    state: State<'_, AppState>,
    vault_id: String,
) -> Result<Value, String> {
    fwd_get(&state, &format!("/notes/deleted?vaultId={vault_id}")).await
}

#[tauri::command]
pub async fn notes_get_links(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    fwd_get(&state, &format!("/notes/{id}/links")).await
}

/// Search notes. The one command that does not forward to the sidecar.
///
/// Runs against SQLite directly because this fires on every keystroke and the
/// HTTP round-trip dominated the query. If the database could not be opened at
/// startup, it forwards as before — search degrades to slow, not broken.
#[tauri::command]
pub async fn notes_search(
    state: State<'_, AppState>,
    vault_id: String,
    query: String,
) -> Result<Value, String> {
    if let Some(db) = state.db.clone() {
        let vault = vault_id.clone();
        let q = query.clone();

        // SQLite calls block; running them on the async runtime would stall
        // unrelated IPC on a large vault.
        let result = tokio::task::spawn_blocking(move || {
            let conn = db.lock().map_err(|e| e.to_string())?;
            search::query(&conn, &vault, &q).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;

        match result {
            Ok(items) => return serde_json::to_value(items).map_err(|e| e.to_string()),
            Err(err) => eprintln!("[search] direct query failed, forwarding: {err}"),
        }
    }

    let q = urlencoding::encode(&query);
    fwd_get(&state, &format!("/notes/search?vaultId={vault_id}&q={q}")).await
}

#[tauri::command]
pub async fn notes_permanent_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    fwd_post(&state, &format!("/notes/{id}/permanent-delete"), Value::Null).await
}

#[tauri::command]
pub async fn notes_convert(
    state: State<'_, AppState>,
    id: String,
    kind: String,
) -> Result<Value, String> {
    fwd_post(
        &state,
        &format!("/notes/{id}/convert"),
        serde_json::json!({ "kind": kind }),
    ).await
}

#[tauri::command]
pub async fn notes_conversion_impact(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    fwd_get(&state, &format!("/notes/{id}/conversion-impact")).await
}

#[tauri::command]
pub async fn notes_unlinked_mentions(
    state: State<'_, AppState>,
    note_id: String,
    vault_id: String,
) -> Result<Value, String> {
    fwd_get(
        &state,
        &format!("/notes/{note_id}/unlinked-mentions?vaultId={vault_id}"),
    ).await
}
