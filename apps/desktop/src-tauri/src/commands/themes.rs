use crate::state::AppState;
use super::http::{fwd_get, fwd_post};
use serde_json::{json, Value};
use tauri::State;

// Thin forwards. The sidecar reads, filters and copies the theme files.

#[tauri::command]
pub async fn themes_default_dir(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_get(&state, "/themes/default-dir").await
}

#[tauri::command]
pub async fn themes_scan(state: State<'_, AppState>, dir: String) -> Result<Value, String> {
    fwd_post(&state, "/themes/scan", json!({ "dir": dir })).await
}

#[tauri::command]
pub async fn themes_import_url(
    state: State<'_, AppState>,
    url: String,
    dir: String,
) -> Result<Value, String> {
    fwd_post(&state, "/themes/import-url", json!({ "url": url, "dir": dir })).await
}

#[tauri::command]
pub async fn themes_import(
    state: State<'_, AppState>,
    source: String,
    dir: String,
) -> Result<Value, String> {
    fwd_post(&state, "/themes/import", json!({ "source": source, "dir": dir })).await
}
