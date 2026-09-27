use crate::state::AppState;
use super::http::{fwd_get, fwd_post};
use serde_json::{json, Value};
use tauri::State;

// Thin forwards. The sidecar validates the file name and stores the text.

#[tauri::command]
pub async fn settings_read(state: State<'_, AppState>, file: String) -> Result<Value, String> {
    fwd_get(&state, &format!("/settings/{file}")).await
}

#[tauri::command]
pub async fn settings_write(
    state: State<'_, AppState>,
    file: String,
    text: String,
) -> Result<Value, String> {
    fwd_post(&state, &format!("/settings/{file}"), json!({ "text": text })).await
}
