use crate::state::AppState;
use super::http::{fwd_get, fwd_post};
use serde_json::Value;
use tauri::State;

// Thin forwards. The sidecar validates input and owns every rule.

#[tauri::command]
pub async fn auth_lock_screen(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_get(&state, "/auth/lock-screen").await
}

#[tauri::command]
pub async fn auth_current(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_get(&state, "/auth/current").await
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
pub async fn auth_unlock_pin(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/unlock-pin", data).await
}

#[tauri::command]
pub async fn auth_set_pin(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/pin", data).await
}

#[tauri::command]
pub async fn auth_verify_password(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/verify-password", data).await
}

#[tauri::command]
pub async fn auth_change_password(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/password", data).await
}

#[tauri::command]
pub async fn auth_issue_recovery_key(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/recovery-key", data).await
}

#[tauri::command]
pub async fn auth_recover(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/recover", data).await
}

#[tauri::command]
pub async fn auth_lock(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_post(&state, "/auth/lock", Value::Null).await
}
