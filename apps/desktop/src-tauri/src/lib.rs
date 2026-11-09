mod commands;
mod core;
mod dto;
pub mod mcp;

use std::collections::HashMap;
use std::sync::Arc;

use cord_core::data_dir;
use cord_core::services::attachments;
use tauri::http::{header, Response, StatusCode};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::core::{Core, Shared};

/// Registers every command on `$builder`; shared by the app and the IPC tests.
macro_rules! with_commands {
    ($builder:expr) => {
        $builder.invoke_handler(tauri::generate_handler![
            // vaults
            $crate::commands::vaults::vaults_list,
            $crate::commands::vaults::vaults_create,
            $crate::commands::vaults::vaults_update,
            $crate::commands::vaults::vaults_archive,
            // notes
            $crate::commands::notes::notes_list,
            $crate::commands::notes::notes_get,
            $crate::commands::notes::notes_create,
            $crate::commands::notes::notes_update,
            $crate::commands::notes::notes_delete,
            $crate::commands::notes::notes_restore,
            $crate::commands::notes::notes_list_deleted,
            $crate::commands::notes::notes_get_links,
            $crate::commands::notes::notes_search,
            $crate::commands::notes::notes_permanent_delete,
            $crate::commands::notes::notes_unlinked_mentions,
            $crate::commands::notes::notes_convert,
            $crate::commands::notes::notes_body_state,
            $crate::commands::notes::notes_apply_body_update,
            // blocks
            $crate::commands::blocks::blocks_list_for_note,
            $crate::commands::blocks::blocks_resolve_ref,
            $crate::commands::blocks::blocks_reproject,
            // tags
            $crate::commands::tags::tags_list,
            $crate::commands::tags::tags_create,
            $crate::commands::tags::tags_update,
            $crate::commands::tags::tags_delete,
            $crate::commands::tags::tags_attach,
            $crate::commands::tags::tags_detach,
            $crate::commands::tags::tags_get_for_note,
            $crate::commands::tags::tags_get_note_map,
            $crate::commands::fields::tag_fields_list,
            $crate::commands::fields::tag_fields_create,
            $crate::commands::fields::tag_fields_update,
            $crate::commands::fields::tag_fields_delete,
            $crate::commands::fields::field_values_set,
            $crate::commands::fields::field_values_clear,
            $crate::commands::fields::field_values_for_note,
            $crate::commands::fields::tag_views_page,
            $crate::commands::fields::tag_views_get,
            $crate::commands::fields::tag_views_create,
            $crate::commands::fields::tag_views_update,
            $crate::commands::fields::tag_views_delete,
            $crate::commands::fields::tag_rows,
            // fragments
            $crate::commands::fragments::fragments_get_for_note,
            $crate::commands::fragments::fragments_attach_tag,
            $crate::commands::fragments::fragments_detach_tag,
            $crate::commands::fragments::fragments_create_link,
            $crate::commands::fragments::fragments_delete_link,
            // auth
            $crate::commands::auth::auth_lock_screen,
            $crate::commands::auth::auth_current,
            $crate::commands::auth::auth_register,
            $crate::commands::auth::auth_login,
            $crate::commands::auth::auth_unlock_pin,
            $crate::commands::auth::auth_set_pin,
            $crate::commands::auth::auth_verify_password,
            $crate::commands::auth::auth_change_password,
            $crate::commands::auth::auth_issue_recovery_key,
            $crate::commands::auth::auth_recover,
            $crate::commands::auth::auth_lock,
            // attachments
            $crate::commands::attachments::attachments_create,
            // settings
            $crate::commands::settings::settings_read,
            $crate::commands::settings::settings_write,
            $crate::commands::themes::themes_default_dir,
            $crate::commands::themes::themes_scan,
            $crate::commands::themes::themes_import,
            $crate::commands::themes::themes_import_url,
            // app
            $crate::commands::app::app_updater_supported,
        ])
    };
}

// After the macro, which it uses.
#[cfg(test)]
mod ipc_tests;

pub fn run() {
    let builder = tauri::Builder::default()
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
        });
    with_commands!(builder)
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
