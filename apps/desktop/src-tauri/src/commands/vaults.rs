use cord_core::services::vaults;
use serde_json::Value;
use tauri::State;

use crate::core::{run, Shared};
use crate::dto::VaultIn;

#[tauri::command]
pub async fn vaults_list(core: State<'_, Shared>) -> Result<Value, String> {
    run(&core, |c| c.session(|s| vaults::list(s))).await
}

#[tauri::command]
pub async fn vaults_create(core: State<'_, Shared>, data: VaultIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| vaults::create(s, data.new_vault()))).await
}

#[tauri::command]
pub async fn vaults_update(core: State<'_, Shared>, id: String, data: VaultIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| vaults::update(s, &id, data.changes()))).await
}

#[tauri::command]
pub async fn vaults_archive(core: State<'_, Shared>, id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| vaults::archive(s, &id))).await
}
