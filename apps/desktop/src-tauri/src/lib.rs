mod commands;
mod search;
mod state;

use std::sync::Mutex;

use state::AppState;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Owns the spawned Bun sidecar so it can be killed when the app exits.
///
/// Dropping a `CommandChild` does not terminate the underlying process, so
/// letting the handle fall out of scope orphans the sidecar: it keeps running
/// after the window closes, holds the SQLite file and its port, and locks
/// `target/debug` hard enough to break the next `cargo build`. One leaks per
/// dev run, so they accumulate silently.
struct SidecarProcess(Mutex<Option<CommandChild>>);

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let (port, db_path, child) = start_sidecar(app)?;
            app.manage(AppState::new(port, db_path.as_deref()));
            app.manage(SidecarProcess(Mutex::new(Some(child))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // vaults
            commands::vaults::vaults_list,
            commands::vaults::vaults_create,
            commands::vaults::vaults_update,
            commands::vaults::vaults_archive,
            // notes
            commands::notes::notes_list,
            commands::notes::notes_get,
            commands::notes::notes_create,
            commands::notes::notes_update,
            commands::notes::notes_delete,
            commands::notes::notes_restore,
            commands::notes::notes_list_deleted,
            commands::notes::notes_get_links,
            commands::notes::notes_search,
            commands::notes::notes_permanent_delete,
            commands::notes::notes_unlinked_mentions,
            commands::notes::notes_convert,
            commands::notes::notes_conversion_impact,
            // blocks
            commands::blocks::blocks_list_for_note,
            commands::blocks::blocks_resolve_ref,
            commands::blocks::blocks_reproject,
            // tags
            commands::tags::tags_list,
            commands::tags::tags_create,
            commands::tags::tags_delete,
            commands::tags::tags_attach,
            commands::tags::tags_detach,
            commands::tags::tags_get_for_note,
            commands::tags::tags_get_note_map,
            // links
            commands::links::links_create,
            commands::links::links_delete,
            // fragments
            commands::fragments::fragments_get_for_note,
            commands::fragments::fragments_attach_tag,
            commands::fragments::fragments_detach_tag,
            commands::fragments::fragments_create_link,
            commands::fragments::fragments_delete_link,
            // auth
            commands::auth::auth_has_users,
            commands::auth::auth_register,
            commands::auth::auth_login,
            commands::auth::auth_logout,
            commands::auth::auth_session,
        ])
        .build(tauri::generate_context!())
        .expect("error building Cord");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            shutdown_sidecar(app_handle);
        }
    });
}

/// Terminate the sidecar. Safe to call more than once — the handle is taken.
fn shutdown_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<SidecarProcess>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
}

/// Spawn the Bun sidecar and read the port — and the database path — it prints.
///
/// Returns the child handle alongside both; the caller must keep it alive for
/// the lifetime of the app and kill it on exit (see `SidecarProcess`).
fn start_sidecar(
    app: &tauri::App,
) -> Result<(u16, Option<String>, CommandChild), Box<dyn std::error::Error>> {
    let sidecar_cmd = app.shell().sidecar("cord-sidecar")?;
    let (mut rx, child) = sidecar_cmd.spawn()?;

    // SIDECAR_DB is printed first, so it has always arrived by the time the
    // port ends this loop.
    let mut db_path: Option<String> = None;

    while let Some(event) = rx.blocking_recv() {
        if let tauri_plugin_shell::process::CommandEvent::Stdout(bytes) = event {
            let line = String::from_utf8_lossy(&bytes);
            let line = line.trim();

            if let Some(path) = line.strip_prefix("SIDECAR_DB=") {
                db_path = Some(path.trim().to_owned());
            }

            if let Some(port_str) = line.strip_prefix("SIDECAR_PORT=") {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    return Ok((port, db_path, child));
                }
            }
        }
    }

    // Never emitted a port — kill it rather than leaving it orphaned.
    let _ = child.kill();
    Err("sidecar did not emit SIDECAR_PORT line on stdout".into())
}
