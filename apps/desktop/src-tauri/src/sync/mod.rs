//! Syncing linked vaults with cord-server. The rules live in
//! `cord_core::sync`; this module moves batches over the network.

pub mod actions;
pub mod client;
pub mod engine;
pub mod live;
pub mod state;

#[cfg(test)]
mod e2e_tests;

use cord_core::session::Session;

use crate::core::{err, Shared};

/// Run `f` on the signed-in user's data, off the async threads.
pub async fn with_session<T: Send + 'static>(
    core: &Shared,
    f: impl FnOnce(&mut Session) -> cord_core::Result<T> + Send + 'static,
) -> Result<T, String> {
    let core = core.clone();
    tokio::task::spawn_blocking(move || core.session(f)).await.map_err(err)?
}
