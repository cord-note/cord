use crate::state::AppState;
use super::http::{fwd_get, fwd_patch, fwd_post};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn vaults_list(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_get(&state, "/vaults").await
}

#[tauri::command]
pub async fn vaults_create(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/vaults", data).await
}

#[tauri::command]
pub async fn vaults_update(
    state: State<'_, AppState>,
    id: String,
    data: Value,
) -> Result<Value, String> {
    fwd_patch(&state, &format!("/vaults/{id}"), data).await
}

#[tauri::command]
pub async fn vaults_archive(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    fwd_post(&state, &format!("/vaults/{id}/archive"), Value::Null).await
}
