use crate::state::AppState;
use super::http::{fwd_delete, fwd_post};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn links_create(
    state: State<'_, AppState>,
    from_id: String,
    to_id: String,
) -> Result<Value, String> {
    fwd_post(&state, "/links", serde_json::json!({ "fromId": from_id, "toId": to_id })).await
}

#[tauri::command]
pub async fn links_delete(
    state: State<'_, AppState>,
    from_id: String,
    to_id: String,
) -> Result<Value, String> {
    fwd_delete(&state, &format!("/links?fromId={from_id}&toId={to_id}")).await
}
