use crate::state::AppState;
use super::http::{fwd_get, fwd_post};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn auth_has_users(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_get(&state, "/auth/has-users").await
}

#[tauri::command]
pub async fn auth_register(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/register", data).await
}

#[tauri::command]
pub async fn auth_login(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/login", data).await
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_post(&state, "/auth/logout", Value::Null).await
}

#[tauri::command]
pub async fn auth_session(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_get(&state, "/auth/session").await
}
