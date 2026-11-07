mod commands;
mod core;
mod dto;

use std::collections::HashMap;
use std::sync::Arc;

use cord_core::data_dir;
use cord_core::services::attachments;
use tauri::http::{header, Response, StatusCode};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::core::{Core, Shared};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Images in notes: `cord-attachment://<id>` reads the signed-in user's file,
        // off the main thread.
        .register_asynchronous_uri_scheme_protocol("cord-attachment", |ctx, request, responder| {
            let id = request.uri().path().trim_start_matches('/').to_owned();
            let core = ctx.app_handle().try_state::<Shared>().map(|s| Arc::clone(&s));
            std::thread::spawn(move || responder.respond(attachment(core.as_ref(), &id)));
        })
        .setup(|app| {
            let root = data_dir::resolve();
            if cfg!(target_os = "linux") {
                let env: HashMap<String, String> = std::env::vars().collect();
                if let Err(e) = data_dir::migrate_legacy(&data_dir::legacy_dir(&env), &root) {
                    eprintln!("[core] could not move ~/.cord: {e}");
                }
            }
            match Core::open(root) {
                Ok(core) => {
                    app.manage::<Shared>(Arc::new(core));
                }
                Err(message) => {
                    app.dialog()
                        .message(message)
                        .title("Cord")
                        .kind(MessageDialogKind::Error)
                        .show(|_| std::process::exit(1));
                }
            }
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
            commands::notes::notes_body_state,
            commands::notes::notes_apply_body_update,
            // blocks
            commands::blocks::blocks_list_for_note,
            commands::blocks::blocks_resolve_ref,
            commands::blocks::blocks_reproject,
            // tags
            commands::tags::tags_list,
            commands::tags::tags_create,
            commands::tags::tags_update,
            commands::tags::tags_delete,
            commands::tags::tags_attach,
            commands::tags::tags_detach,
            commands::tags::tags_get_for_note,
            commands::tags::tags_get_note_map,
            // fragments
            commands::fragments::fragments_get_for_note,
            commands::fragments::fragments_attach_tag,
            commands::fragments::fragments_detach_tag,
            commands::fragments::fragments_create_link,
            commands::fragments::fragments_delete_link,
            // auth
            commands::auth::auth_lock_screen,
            commands::auth::auth_current,
            commands::auth::auth_register,
            commands::auth::auth_login,
            commands::auth::auth_unlock_pin,
            commands::auth::auth_set_pin,
            commands::auth::auth_verify_password,
            commands::auth::auth_change_password,
            commands::auth::auth_issue_recovery_key,
            commands::auth::auth_recover,
            commands::auth::auth_lock,
            // attachments
            commands::attachments::attachments_create,
            // settings
            commands::settings::settings_read,
            commands::settings::settings_write,
            commands::themes::themes_default_dir,
            commands::themes::themes_scan,
            commands::themes::themes_import,
            commands::themes::themes_import_url,
            // app
            commands::app::app_updater_supported,
        ])
        .run(tauri::generate_context!())
        .expect("error running Cord");
}

/// The response for `cord-attachment://<id>`: the signed-in user's file, or 404.
/// Only ids that exist as rows are looked up, so a path-like id never reaches the disk.
fn attachment(core: Option<&Shared>, id: &str) -> Response<Vec<u8>> {
    let status = |code: StatusCode| Response::builder().status(code).body(Vec::new()).unwrap();
    let Some(core) = core else { return status(StatusCode::SERVICE_UNAVAILABLE) };
    match core.session(|s| attachments::read(s, id)) {
        Ok(Some((mime, bytes))) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
            .body(bytes)
            .unwrap(),
        _ => status(StatusCode::NOT_FOUND),
    }
}
