//! Cord's self-hosted sync server: keeps every change it receives and hands
//! them to the other devices in a vault. It never merges or edits content.

pub mod admin;
pub mod api;
pub mod auth;
pub mod db;
pub mod error;
pub mod live;
pub mod log;

use std::path::Path;
use std::sync::{Arc, Mutex};

use cord_core::rusqlite::Connection;
use tokio::net::TcpListener;

pub struct Server {
    pub db: Mutex<Connection>,
    pub server_id: String,
    pub live: live::Hub,
    /// bcrypt cost for new passwords; tests use 4.
    pub hash_cost: u32,
}

pub type Shared = Arc<Server>;

impl Server {
    pub fn open(dir: &Path, hash_cost: u32) -> cord_core::Result<Shared> {
        let conn = db::open(dir)?;
        let server_id = db::server_id(&conn)?;
        Ok(Arc::new(Self { db: Mutex::new(conn), server_id, live: live::Hub::new(), hash_cost }))
    }
}

/// Serve until the process ends.
pub async fn serve(listener: TcpListener, server: Shared) -> std::io::Result<()> {
    axum::serve(listener, api::router(server)).await
}
