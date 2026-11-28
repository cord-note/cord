//! The live channel: tells connected devices that a vault's log grew.

use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use cord_core::sync::wire::Ping;
use tokio::sync::broadcast;

use crate::{log, Shared};

#[derive(Clone)]
pub struct Hub {
    tx: broadcast::Sender<Ping>,
}

impl Hub {
    pub fn new() -> Self {
        Self { tx: broadcast::channel(1024).0 }
    }

    pub fn notify(&self, vault: &str, seq: i64) {
        // No listeners is fine.
        let _ = self.tx.send(Ping { vault: vault.into(), seq });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Ping> {
        self.tx.subscribe()
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

/// One device's socket, until it closes or falls behind.
pub async fn run(mut socket: WebSocket, server: Shared, user: String) {
    let mut pings = server.live.subscribe();
    // First keepalive after 30 s, not at once.
    let every = Duration::from_secs(30);
    let mut keepalive = tokio::time::interval_at(tokio::time::Instant::now() + every, every);
    loop {
        tokio::select! {
            got = pings.recv() => match got {
                Ok(ping) => {
                    let member = server.db.lock().ok().and_then(|db| log::role(&db, &user, &ping.vault).ok().flatten());
                    if member.is_none() {
                        continue;
                    }
                    let text = serde_json::to_string(&ping).unwrap_or_default();
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        return;
                    }
                }
                // Fell behind or shutting down: closing makes the device catch up.
                Err(_) => return,
            },
            _ = keepalive.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    return;
                }
            }
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(_)) => {}
            },
        }
    }
}
