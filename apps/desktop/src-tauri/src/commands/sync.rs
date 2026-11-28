//! Sync commands. Thin: parse, call `sync::actions`, return JSON.

use std::any::Any;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Runtime, State};

use crate::core::{err, Shared};
use crate::sync::actions;
use crate::sync::state::SyncState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddServerIn {
    pub url: String,
    pub username: String,
    pub password: String,
    pub invite_code: Option<String>,
    pub device_name: String,
}

#[derive(Deserialize)]
pub struct ServerIn {
    pub id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultLinkIn {
    pub id: String,
    pub vault_id: String,
}

fn json(v: impl serde::Serialize) -> Result<Value, String> {
    serde_json::to_value(v).map_err(err)
}

#[tauri::command]
pub async fn sync_servers(core: State<'_, Shared>) -> Result<Value, String> {
    json(actions::list_servers(&core).await?)
}

/// The app handle for events, in the real app only. Commands that need one are
/// generic over the runtime so the mock-runtime IPC tests can call them.
fn events<R: Runtime>(app: &AppHandle<R>) -> Option<&AppHandle> {
    (app as &dyn Any).downcast_ref::<AppHandle>()
}

#[tauri::command]
pub async fn sync_add_server<R: Runtime>(
    app: AppHandle<R>,
    core: State<'_, Shared>,
    state: State<'_, SyncState>,
    data: AddServerIn,
) -> Result<Value, String> {
    let row = actions::add_server(&core, &data.url, &data.username, &data.password, data.invite_code.as_deref(), &data.device_name).await?;
    // Starts the task now rather than on the next tick. It keeps the handle it
    // starts with, so it must get the real one or it never tells the renderer.
    crate::sync::state::reconcile(core.inner().clone(), events(&app).cloned(), &state).await;
    json(row)
}

#[tauri::command]
pub async fn sync_remove_server(core: State<'_, Shared>, state: State<'_, SyncState>, data: ServerIn) -> Result<Value, String> {
    actions::remove_server(&core, &state, &data.id).await?;
    json(())
}

#[tauri::command]
pub async fn sync_server_vaults(core: State<'_, Shared>, data: ServerIn) -> Result<Value, String> {
    json(actions::server_vaults(&core, &data.id).await?)
}

#[tauri::command]
pub async fn sync_link_vault(core: State<'_, Shared>, state: State<'_, SyncState>, data: VaultLinkIn) -> Result<Value, String> {
    json(actions::link_vault(&core, &state, &data.id, &data.vault_id).await?)
}

#[tauri::command]
pub async fn sync_pull_vault<R: Runtime>(app: AppHandle<R>, core: State<'_, Shared>, data: VaultLinkIn) -> Result<Value, String> {
    json(actions::pull_vault(&core, events(&app), &data.id, &data.vault_id).await?)
}

#[tauri::command]
pub async fn sync_unlink_vault(core: State<'_, Shared>, data: VaultLinkIn) -> Result<Value, String> {
    actions::unlink_vault(&core, &data.id, &data.vault_id).await?;
    json(())
}

#[tauri::command]
pub async fn sync_now(state: State<'_, SyncState>, data: ServerIn) -> Result<Value, String> {
    actions::sync_now(&state, &data.id).await;
    json(())
}

#[tauri::command]
pub async fn sync_pause(core: State<'_, Shared>, data: ServerIn) -> Result<Value, String> {
    actions::set_paused(&core, &data.id, true).await?;
    json(())
}

#[tauri::command]
pub async fn sync_resume(core: State<'_, Shared>, data: ServerIn) -> Result<Value, String> {
    actions::set_paused(&core, &data.id, false).await?;
    json(())
}

#[tauri::command]
pub async fn sync_status(state: State<'_, SyncState>) -> Result<Value, String> {
    json(actions::status(&state))
}
