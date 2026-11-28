//! The work behind each sync command, kept here so tests can call it
//! without the IPC layer.

use cord_core::services::vaults;
use cord_core::sync::connections::{self, ConnectionRow};
use cord_core::sync::link;
use serde::Serialize;
use tauri::AppHandle;

use crate::core::{err, Shared};
use crate::sync::client::Client;
use crate::sync::engine;
use crate::sync::state::{Status, SyncState};
use crate::sync::with_session;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerVault {
    pub id: String,
    pub name: String,
    pub role: String,
    /// Already linked on this device.
    pub linked: bool,
}

async fn row(core: &Shared, id: &str) -> Result<ConnectionRow, String> {
    let id = id.to_owned();
    with_session(core, move |s| connections::get(s.conn(), &id))
        .await?
        .ok_or_else(|| "no such server".to_owned())
}

async fn client(core: &Shared, id: &str) -> Result<Client, String> {
    let r = row(core, id).await?;
    let token = r.token.ok_or_else(|| "signed out of this server; add it again".to_owned())?;
    Ok(Client::new(&r.url, Some(token)))
}

/// Check the server, sign in (with an invite code, or a password for an
/// existing account) and remember it.
pub async fn add_server(
    core: &Shared,
    url: &str,
    username: &str,
    password: &str,
    invite: Option<&str>,
    device_name: &str,
) -> Result<ConnectionRow, String> {
    let url = connections::check_url(url).map_err(err)?;
    let c = Client::new(&url, None);
    c.hello().await.map_err(err)?;
    let signed = match invite.filter(|code| !code.trim().is_empty()) {
        Some(code) => c.redeem(code.trim(), username, password, device_name).await,
        None => c.login(username, password, device_name).await,
    }
    .map_err(err)?;
    let username = username.trim().to_owned();
    let id = with_session(core, move |s| connections::add(s.conn(), &url, &username, &signed.user_id, &signed.token, s.now())).await?;
    row(core, &id).await
}

pub async fn list_servers(core: &Shared) -> Result<Vec<ConnectionRow>, String> {
    with_session(core, |s| connections::list(s.conn())).await
}

/// Sign this device out on the server (best effort) and forget the server here.
pub async fn remove_server(core: &Shared, state: &SyncState, id: &str) -> Result<(), String> {
    state.stop(id).await;
    if let Ok(c) = client(core, id).await {
        if let Err(e) = c.logout().await {
            eprintln!("[sync] could not sign out on the server: {e}");
        }
    }
    let id = id.to_owned();
    with_session(core, move |s| connections::remove(s.conn(), &id)).await
}

pub async fn server_vaults(core: &Shared, id: &str) -> Result<Vec<ServerVault>, String> {
    let remote = client(core, id).await?.vaults().await.map_err(err)?;
    let conn_id = id.to_owned();
    let linked = with_session(core, move |s| connections::vaults(s.conn(), &conn_id)).await?;
    Ok(remote
        .into_iter()
        .map(|v| ServerVault { linked: linked.contains(&v.id), id: v.id, name: v.name, role: v.role })
        .collect())
}

/// Put a local vault on the server and queue its whole state. Returns the number of changes queued.
pub async fn link_vault(core: &Shared, state: &SyncState, id: &str, vault_id: &str) -> Result<usize, String> {
    let v = vault_id.to_owned();
    let vault = with_session(core, move |s| vaults::get(s, &v)).await?.ok_or_else(|| "no such vault".to_owned())?;
    let info = client(core, id).await?.create_vault(&vault.id, &vault.name).await.map_err(err)?;
    let (conn_id, vid) = (id.to_owned(), vault.id.clone());
    let queued = with_session(core, move |s| link::link_vault(s, &conn_id, &vid, &info.role)).await?;
    state.nudge(id).await;
    Ok(queued)
}

/// Bring a vault from the server onto this device. Returns the number of changes applied.
pub async fn pull_vault(core: &Shared, events: Option<&AppHandle>, id: &str, vault_id: &str) -> Result<usize, String> {
    let c = client(core, id).await?;
    let info = c
        .vaults()
        .await
        .map_err(err)?
        .into_iter()
        .find(|v| v.id == vault_id)
        .ok_or_else(|| "that vault is not on the server, or not shared with you".to_owned())?;
    let v = vault_id.to_owned();
    if with_session(core, move |s| vaults::get(s, &v)).await?.is_some() {
        return Err("that vault is already on this device".into());
    }
    let (conn_id, vid) = (id.to_owned(), info.id.clone());
    with_session(core, move |s| link::attach_server_vault(s.conn(), &conn_id, &vid, &info.role, s.now())).await?;
    engine::pull_vault(core, events, &c, id, vault_id).await.map_err(err)
}

/// Stop syncing a vault with this server. The local vault stays.
pub async fn unlink_vault(core: &Shared, id: &str, vault_id: &str) -> Result<(), String> {
    let (id, v) = (id.to_owned(), vault_id.to_owned());
    with_session(core, move |s| link::unlink_vault(s.conn(), &id, &v)).await
}

pub async fn set_paused(core: &Shared, id: &str, paused: bool) -> Result<(), String> {
    let id = id.to_owned();
    with_session(core, move |s| connections::set_paused(s.conn(), &id, paused)).await
}

pub async fn sync_now(state: &SyncState, id: &str) {
    state.nudge(id).await;
}

pub fn status(state: &SyncState) -> Vec<Status> {
    state.statuses.list()
}
