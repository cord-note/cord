use crate::state::AppState;
use super::http::{fwd_delete, fwd_get, fwd_post};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn fragments_get_for_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Value, String> {
    fwd_get(&state, &format!("/fragments?noteId={note_id}")).await
}

#[tauri::command]
pub async fn fragments_attach_tag(
    state: State<'_, AppState>,
    block_id: String,
    note_id: String,
    vault_id: String,
    tag_id: String,
) -> Result<Value, String> {
    fwd_post(
        &state,
        &format!("/fragments/{block_id}/tags/{tag_id}"),
        serde_json::json!({ "noteId": note_id, "vaultId": vault_id }),
    ).await
}

#[tauri::command]
pub async fn fragments_detach_tag(
    state: State<'_, AppState>,
    block_id: String,
    tag_id: String,
) -> Result<Value, String> {
    fwd_delete(&state, &format!("/fragments/{block_id}/tags/{tag_id}")).await
}

#[tauri::command]
pub async fn fragments_create_link(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/fragment-links", data).await
}

#[tauri::command]
pub async fn fragments_delete_link(
    state: State<'_, AppState>,
    link_id: String,
) -> Result<Value, String> {
    fwd_delete(&state, &format!("/fragment-links/{link_id}")).await
}
