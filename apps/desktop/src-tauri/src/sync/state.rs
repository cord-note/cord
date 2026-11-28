//! One background task per server, kept in step with who is signed in.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use cord_core::sync::{connections, outbox};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;

use crate::core::Shared;
use crate::sync::client::{Client, SyncError};
use crate::sync::{engine, live, with_session};

/// One server's state, as the renderer will see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub id: String,
    /// connecting | connected | offline | paused | signedOut | updateNeeded
    pub state: &'static str,
    /// When this state began, ms.
    pub since: Option<i64>,
    pub message: Option<String>,
}

#[derive(Default, Clone)]
pub struct Statuses(Arc<StdMutex<HashMap<String, Status>>>);

impl Statuses {
    /// Returns true when the state or message changed.
    pub fn set(&self, id: &str, state: &'static str, message: Option<String>) -> bool {
        let Ok(mut map) = self.0.lock() else { return false };
        if map.get(id).is_some_and(|s| s.state == state && s.message == message) {
            return false;
        }
        map.insert(id.to_owned(), Status { id: id.to_owned(), state, since: Some(now()), message });
        true
    }

    pub fn list(&self) -> Vec<Status> {
        let mut out: Vec<Status> = self.0.lock().map(|m| m.values().cloned().collect()).unwrap_or_default();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Forget servers that no longer exist.
    pub fn retain(&self, ids: &[String]) {
        if let Ok(mut map) = self.0.lock() {
            map.retain(|id, _| ids.contains(id));
        }
    }
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

struct Running {
    user: String,
    token: Option<String>,
    url: String,
    cancel: CancellationToken,
    nudge: mpsc::Sender<()>,
}

#[derive(Default)]
pub struct SyncState {
    running: Mutex<HashMap<String, Running>>,
    pub statuses: Statuses,
}

impl SyncState {
    /// Ask a server's task to sync right away.
    pub async fn nudge(&self, id: &str) {
        if let Some(r) = self.running.lock().await.get(id) {
            let _ = r.nudge.try_send(());
        }
    }

    pub async fn stop(&self, id: &str) {
        if let Some(r) = self.running.lock().await.remove(id) {
            r.cancel.cancel();
        }
    }
}

fn report(statuses: &Statuses, events: Option<&AppHandle>, id: &str, state: &'static str, message: Option<String>) {
    if statuses.set(id, state, message) {
        if let Some(app) = events {
            let _ = app.emit("sync-status", statuses.list());
        }
    }
}

/// Start, stop or restart server tasks to match the signed-in user's
/// connections. Called every second.
pub async fn reconcile(core: Shared, events: Option<AppHandle>, state: &SyncState) {
    let user = core.user_id();
    let rows = match &user {
        Some(_) => core.session(|s| connections::list(s.conn())).unwrap_or_default(),
        None => Vec::new(),
    };
    let mut running = state.running.lock().await;
    running.retain(|id, r| {
        let keep = rows.iter().any(|w| {
            &w.id == id && !w.paused && w.token == r.token && w.url == r.url && user.as_deref() == Some(r.user.as_str())
        });
        if !keep {
            r.cancel.cancel();
        }
        keep
    });
    state.statuses.retain(&rows.iter().map(|r| r.id.clone()).collect::<Vec<_>>());
    for row in &rows {
        if row.paused {
            report(&state.statuses, events.as_ref(), &row.id, "paused", None);
            continue;
        }
        let Some(token) = row.token.clone() else {
            report(&state.statuses, events.as_ref(), &row.id, "signedOut", None);
            continue;
        };
        if running.contains_key(&row.id) {
            continue;
        }
        let cancel = CancellationToken::new();
        let (nudge, nudges) = mpsc::channel(4);
        let task = Task {
            core: core.clone(),
            events: events.clone(),
            statuses: state.statuses.clone(),
            id: row.id.clone(),
            client: Client::new(&row.url, Some(token.clone())),
            cancel: cancel.clone(),
        };
        tokio::spawn(task.run(nudges));
        running.insert(
            row.id.clone(),
            Running { user: user.clone().unwrap_or_default(), token: Some(token), url: row.url.clone(), cancel, nudge },
        );
    }
}

struct Task {
    core: Shared,
    events: Option<AppHandle>,
    statuses: Statuses,
    id: String,
    client: Client,
    cancel: CancellationToken,
}

const MAX_BACKOFF: Duration = Duration::from_secs(60);

impl Task {
    fn report(&self, state: &'static str, message: Option<String>) {
        report(&self.statuses, self.events.as_ref(), &self.id, state, message);
    }

    /// Wait, or return false if the task was stopped meanwhile.
    async fn pause(&self, d: Duration) -> bool {
        tokio::select! {
            _ = self.cancel.cancelled() => false,
            _ = tokio::time::sleep(d) => true,
        }
    }

    /// Show the error. Returns false when retrying is pointless until something changes.
    async fn failed(&self, e: &SyncError) -> bool {
        match e {
            SyncError::SignedOut => {
                // Keep the outbox and bookmark; signing in again resumes.
                let id = self.id.clone();
                let _ = with_session(&self.core, move |s| connections::set_token(s.conn(), &id, None)).await;
                self.report("signedOut", None);
                false
            }
            SyncError::UpdateNeeded { .. } => {
                self.report("updateNeeded", Some(e.to_string()));
                false
            }
            other => {
                self.report("offline", Some(other.to_string()));
                true
            }
        }
    }

    async fn run(self, mut nudges: mpsc::Receiver<()>) {
        let mut backoff = Duration::from_secs(1);
        loop {
            if self.cancel.is_cancelled() {
                return;
            }
            self.report("connecting", None);
            let ready = match self.client.hello().await {
                Ok(_) => engine::sync_once(&self.core, self.events.as_ref(), &self.client, &self.id).await,
                Err(e) => Err(e),
            };
            if let Err(e) = ready {
                if !self.failed(&e).await {
                    self.cancel.cancelled().await;
                    return;
                }
                if !self.pause(backoff).await {
                    return;
                }
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
            self.report("connected", None);
            let started = Instant::now();
            match self.connected(&mut nudges).await {
                Some(e) => {
                    if !self.failed(&e).await {
                        self.cancel.cancelled().await;
                        return;
                    }
                }
                None if self.cancel.is_cancelled() => return,
                None => self.report("connecting", None),
            }
            // A connection that stayed up a while resets the wait.
            if started.elapsed() > Duration::from_secs(30) {
                backoff = Duration::from_secs(1);
            }
            if !self.pause(backoff).await {
                return;
            }
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
    }

    /// While the live channel is open: send when due, pull on pings and nudges.
    /// Returns the error that ended it, or None when the socket closed or the task stopped.
    async fn connected(&self, nudges: &mut mpsc::Receiver<()>) -> Option<SyncError> {
        let (tx, mut pings) = mpsc::channel(64);
        let token = self.client.token().unwrap_or_default().to_owned();
        let listener = tokio::spawn(live::listen(self.client.live_url(), token, tx));
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let result = loop {
            tokio::select! {
                _ = self.cancel.cancelled() => break None,
                _ = tick.tick() => {
                    let id = self.id.clone();
                    let due = with_session(&self.core, move |s| outbox::due(s.conn(), &id, s.now())).await.unwrap_or(false);
                    if due {
                        if let Err(e) = engine::push_all(&self.core, &self.client, &self.id).await {
                            break Some(e);
                        }
                    }
                }
                Some(()) = nudges.recv() => {
                    if let Err(e) = engine::sync_once(&self.core, self.events.as_ref(), &self.client, &self.id).await {
                        break Some(e);
                    }
                }
                ping = pings.recv() => match ping {
                    Some(p) => {
                        let id = self.id.clone();
                        let linked = with_session(&self.core, move |s| connections::vaults(s.conn(), &id)).await.unwrap_or_default();
                        if linked.contains(&p.vault) {
                            if let Err(e) = engine::pull_vault(&self.core, self.events.as_ref(), &self.client, &self.id, &p.vault).await {
                                break Some(e);
                            }
                        }
                    }
                    None => break None,
                },
            }
        };
        listener.abort();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_change_only_when_something_differs() {
        let s = Statuses::default();
        assert!(s.set("c1", "connecting", None));
        assert!(!s.set("c1", "connecting", None));
        assert!(s.set("c1", "offline", Some("down".into())));
        let list = s.list();
        assert_eq!((list[0].state, list[0].message.as_deref()), ("offline", Some("down")));
        assert!(list[0].since.is_some());
        s.retain(&[]);
        assert!(s.list().is_empty());
    }
}
