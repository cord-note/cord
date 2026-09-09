use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OpenFlags};

pub struct AppState {
    pub sidecar_url: String,
    pub http: Arc<reqwest::Client>,
    /// Read-only in practice — the sidecar owns every write. `None` when the
    /// database could not be opened, in which case search falls back to the
    /// sidecar route rather than failing.
    pub db: Option<Arc<Mutex<Connection>>>,
}

impl AppState {
    pub fn new(port: u16, db_path: Option<&str>) -> Self {
        Self {
            sidecar_url: format!("http://127.0.0.1:{port}"),
            http: Arc::new(reqwest::Client::new()),
            db: db_path.and_then(open_db),
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.sidecar_url)
    }
}

/// Open the database the sidecar just migrated.
///
/// READ_WRITE despite never writing: WAL mode needs a writable `-shm`. Without
/// CREATE, a wrong path is an immediate error rather than an empty database
/// that would report no search results forever.
fn open_db(path: &str) -> Option<Arc<Mutex<Connection>>> {
    if path == ":memory:" {
        return None; // test configuration — nothing on disk to share
    }
    match Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE) {
        Ok(conn) => Some(Arc::new(Mutex::new(conn))),
        Err(err) => {
            eprintln!("[search] could not open {path}: {err} — falling back to sidecar");
            None
        }
    }
}
