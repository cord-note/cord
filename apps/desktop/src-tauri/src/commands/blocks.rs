use crate::state::AppState;
use super::http::{fwd_get, fwd_post};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn blocks_list_for_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Value, String> {
    fwd_get(&state, &format!("/notes/{note_id}/blocks")).await
}

#[tauri::command]
pub async fn blocks_resolve_ref(
    state: State<'_, AppState>,
    block_id: String,
) -> Result<Value, String> {
    fwd_get(&state, &format!("/blocks/{block_id}/resolve")).await
}

#[tauri::command]
pub async fn blocks_reproject(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Value, String> {
    fwd_post(&state, &format!("/notes/{note_id}/reproject"), Value::Null).await
}
