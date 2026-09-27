use crate::state::AppState;
use super::http::fwd_post;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn attachments_create(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/attachments", data).await
}
