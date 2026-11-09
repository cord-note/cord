use cord_core::agents;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::core::{err, Shared};
use crate::mcp::server::McpState;

#[derive(Deserialize)]
pub struct AgentsIn {
    pub allow: bool,
    pub edit: bool,
    pub vaults: Vec<String>,
}

async fn view(core: &Shared, state: &McpState) -> Result<Value, String> {
    let user = core.me()?;
    let s = agents::load(&core.layout, &user).map_err(err)?;
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    Ok(json!({
        "allow": s.allow, "edit": s.edit, "vaults": s.vaults, "hasToken": s.token_hash.is_some(),
        "port": state.port().await, "exe": exe,
    }))
}

#[tauri::command]
pub async fn agents_get(core: State<'_, Shared>, state: State<'_, McpState>) -> Result<Value, String> {
    view(&core, &state).await
}

#[tauri::command]
pub async fn agents_update(core: State<'_, Shared>, state: State<'_, McpState>, data: AgentsIn) -> Result<Value, String> {
    let user = core.me()?;
    let mut s = agents::load(&core.layout, &user).map_err(err)?;
    s.allow = data.allow;
    s.edit = data.edit;
    s.vaults = data.vaults;
    agents::save(&core.layout, &user, &s).map_err(err)?;
    view(&core, &state).await
}

#[tauri::command]
pub async fn agents_new_token(core: State<'_, Shared>) -> Result<Value, String> {
    let user = core.me()?;
    let token = agents::new_token(&core.layout, &user).map_err(err)?;
    Ok(json!({ "token": token }))
}

#[tauri::command]
pub async fn agents_activity(core: State<'_, Shared>) -> Result<Value, String> {
    let user = core.me()?;
    serde_json::to_value(agents::activity(&core.layout, &user).map_err(err)?).map_err(err)
}
