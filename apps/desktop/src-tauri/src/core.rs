//! The shell's hold on cord-core: the data layout, machine.db, this install's
//! device id, and the signed-in user's Session. Every command goes through here.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use cord_core::accounts::Accounts;
use cord_core::layout::DataLayout;
use cord_core::rusqlite::Connection;
use cord_core::session::Session;
use cord_core::{data_dir, device, import, store};
use serde::Serialize;
use serde_json::Value;

pub type Shared = Arc<Core>;

pub struct Core {
    pub layout: DataLayout,
    machine: Mutex<Connection>,
    device_id: String,
    session: Mutex<Option<Session>>,
}

impl Core {
    /// Opens `machine.db` under `root`, importing a Cord 2.x install first if
    /// there is one.
    pub fn open(root: PathBuf) -> Result<Self, String> {
        if data_dir::has_unimported_legacy_db(&root) {
            let old = root.join("cord.db");
            let report = import::run(&root).map_err(|e| {
                format!("Cord could not bring over the notes in {}. They are untouched.\n\n{e}", old.display())
            })?;
            eprintln!(
                "[core] imported {} user(s), {} vault(s), {} note(s); {} image file(s) were already missing; {} note(s) had no vault or owner",
                report.users,
                report.vaults,
                report.notes,
                report.missing_files.len(),
                report.not_imported_notes
            );
        }
        let layout = DataLayout::new(root);
        let machine = store::open_machine(&layout).map_err(err)?;
        let device_id = device::device_id(&machine, now()).map_err(err)?;
        Ok(Self { layout, machine: Mutex::new(machine), device_id, session: Mutex::new(None) })
    }

    pub fn accounts<T>(&self, f: impl FnOnce(&Accounts<'_>) -> cord_core::Result<T>) -> Result<T, String> {
        let conn = self.machine.lock().map_err(err)?;
        f(&Accounts::new(&conn, &self.layout)).map_err(err)
    }

    /// Runs `f` on the signed-in user's data.
    pub fn session<T>(&self, f: impl FnOnce(&mut Session) -> cord_core::Result<T>) -> Result<T, String> {
        let mut guard = self.session.lock().map_err(err)?;
        let s = guard.as_mut().ok_or_else(not_signed_in)?;
        f(s).map_err(err)
    }

    pub fn user_id(&self) -> Option<String> {
        self.session.lock().ok()?.as_ref().map(|s| s.user_id().to_owned())
    }

    /// The signed-in user's id, or the "Not authenticated" error.
    pub fn me(&self) -> Result<String, String> {
        self.user_id().ok_or_else(not_signed_in)
    }

    /// Opens `user_id`'s files; a previous user's session is closed first.
    pub fn sign_in(&self, user_id: &str) -> Result<(), String> {
        let mut guard = self.session.lock().map_err(err)?;
        *guard = None;
        let (session, report) = Session::open(&self.layout, &self.device_id, user_id, None).map_err(err)?;
        if !report.failed.is_empty() {
            eprintln!("[core] could not index {} note(s)", report.failed.len());
        }
        *guard = Some(session);
        Ok(())
    }

    pub fn sign_out(&self) {
        if let Ok(mut guard) = self.session.lock() {
            *guard = None;
        }
    }
}

/// Runs `f` off the main thread and returns its result as JSON.
pub async fn run<T, F>(core: &Shared, f: F) -> Result<Value, String>
where
    T: Serialize + Send + 'static,
    F: FnOnce(&Core) -> Result<T, String> + Send + 'static,
{
    let core = Arc::clone(core);
    tauri::async_runtime::spawn_blocking(move || {
        let value = f(&core)?;
        serde_json::to_value(value).map_err(err)
    })
    .await
    .map_err(err)?
}

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn not_signed_in() -> String {
    "Not authenticated".to_owned()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cord_core::model::NewVault;
    use cord_core::services::vaults;

    fn open() -> (tempfile::TempDir, Core) {
        let d = tempfile::tempdir().unwrap();
        let core = Core::open(d.path().to_path_buf()).unwrap();
        (d, core)
    }

    fn vault(name: &str) -> NewVault {
        NewVault { name: name.into(), ..Default::default() }
    }

    #[test]
    fn imports_an_old_install_once() {
        let d = tempfile::tempdir().unwrap();
        crate::ipc_tests::old_install(d.path());
        let old = std::fs::read(d.path().join("cord.db")).unwrap();
        drop(Core::open(d.path().to_path_buf()).unwrap());
        assert!(d.path().join("machine.db").is_file());
        assert!(d.path().join("users/u1/cord.db").is_file());
        assert_eq!(std::fs::read(d.path().join("cord.db")).unwrap(), old, "the old file is untouched");
        // Opening again does not import again.
        let core = Core::open(d.path().to_path_buf()).unwrap();
        core.sign_in("u1").unwrap();
        assert_eq!(core.session(|s| vaults::list(s)).unwrap().len(), 1);
    }

    #[test]
    fn a_failed_import_says_where_the_old_notes_are() {
        let d = tempfile::tempdir().unwrap();
        crate::ipc_tests::old_install(d.path());
        let conn = cord_core::rusqlite::Connection::open(d.path().join("cord.db")).unwrap();
        conn.execute("UPDATE notes SET body_json = '{broken'", []).unwrap();
        drop(conn);
        let e = Core::open(d.path().to_path_buf()).err().unwrap();
        assert!(e.contains("untouched") && e.contains("cord.db"), "{e}");
        assert!(!d.path().join("machine.db").exists());
    }

    #[test]
    fn data_needs_a_signed_in_user() {
        let (_d, core) = open();
        assert_eq!(core.session(|s| vaults::list(s)).unwrap_err(), "Not authenticated");
        let user = core.accounts(|a| a.fast().register("ola", "pw")).unwrap();
        core.sign_in(&user.id).unwrap();
        assert_eq!(core.user_id().as_deref(), Some(user.id.as_str()));
        core.session(|s| vaults::create(s, vault("V"))).unwrap();
        assert_eq!(core.session(|s| vaults::list(s)).unwrap().len(), 1);
        core.sign_out();
        assert!(core.session(|s| vaults::list(s)).is_err());
    }

    #[test]
    fn each_user_sees_only_their_own_data() {
        let (_d, core) = open();
        let a = core.accounts(|acc| acc.fast().register("a", "pw")).unwrap();
        let b = core.accounts(|acc| acc.fast().register("b", "pw")).unwrap();
        core.sign_in(&a.id).unwrap();
        core.session(|s| vaults::create(s, vault("A's"))).unwrap();
        core.sign_in(&b.id).unwrap();
        assert!(core.session(|s| vaults::list(s)).unwrap().is_empty());
        core.sign_in(&a.id).unwrap();
        assert_eq!(core.session(|s| vaults::list(s)).unwrap().len(), 1);
    }
}
