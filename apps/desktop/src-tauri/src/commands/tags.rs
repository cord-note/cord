use crate::state::AppState;
use super::http::{fwd_delete, fwd_get, fwd_post};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn tags_list(state: State<'_, AppState>, vault_id: String) -> Result<Value, String> {
    fwd_get(&state, &format!("/tags?vaultId={vault_id}")).await
}

#[tauri::command]
pub async fn tags_create(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/tags", data).await
}

#[tauri::command]
pub async fn tags_delete(state: State<'_, AppState>, tag_id: String) -> Result<Value, String> {
    fwd_delete(&state, &format!("/tags/{tag_id}")).await
}

#[tauri::command]
pub async fn tags_attach(
    state: State<'_, AppState>,
    note_id: String,
    tag_id: String,
) -> Result<Value, String> {
    fwd_post(&state, &format!("/notes/{note_id}/tags/{tag_id}"), Value::Null).await
}

#[tauri::command]
pub async fn tags_detach(
    state: State<'_, AppState>,
    note_id: String,
    tag_id: String,
) -> Result<Value, String> {
    fwd_delete(&state, &format!("/notes/{note_id}/tags/{tag_id}")).await
}

#[tauri::command]
pub async fn tags_get_for_note(state: State<'_, AppState>, note_id: String) -> Result<Value, String> {
    fwd_get(&state, &format!("/notes/{note_id}/tags")).await
}

#[tauri::command]
pub async fn tags_get_note_map(state: State<'_, AppState>, vault_id: String) -> Result<Value, String> {
    fwd_get(&state, &format!("/tags/note-map?vaultId={vault_id}")).await
}
