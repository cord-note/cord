use std::sync::Arc;

use cord_core::services::{notes, queries};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

use crate::core::{err, run, Shared};
use crate::dto::{CreateNoteIn, UpdateNoteIn};

#[tauri::command]
pub async fn notes_list(core: State<'_, Shared>, vault_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| notes::list(s, &vault_id))).await
}

#[tauri::command]
pub async fn notes_get(core: State<'_, Shared>, id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| notes::get(s, &id))).await
}

#[tauri::command]
pub async fn notes_create(core: State<'_, Shared>, data: CreateNoteIn) -> Result<Value, String> {
    run(&core, move |c| {
        let input = data.new_note()?;
        c.session(|s| notes::create(s, input))
    })
    .await
}

#[tauri::command]
pub async fn notes_update(core: State<'_, Shared>, id: String, data: UpdateNoteIn) -> Result<Value, String> {
    run(&core, move |c| {
        let changes = data.changes()?;
        c.session(|s| notes::update(s, &id, changes))
    })
    .await
}

#[tauri::command]
pub async fn notes_delete(core: State<'_, Shared>, id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| notes::delete(s, &id))).await
}

#[tauri::command]
pub async fn notes_restore(core: State<'_, Shared>, id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| notes::restore(s, &id))).await
}

#[tauri::command]
pub async fn notes_list_deleted(core: State<'_, Shared>, vault_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| notes::list_deleted(s, &vault_id))).await
}

#[tauri::command]
pub async fn notes_get_links(core: State<'_, Shared>, id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| queries::links(s, &id))).await
}

#[tauri::command]
pub async fn notes_search(core: State<'_, Shared>, vault_id: String, query: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| queries::search(s, &vault_id, &query))).await
}

#[tauri::command]
pub async fn notes_permanent_delete(core: State<'_, Shared>, id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| notes::purge(s, &id))).await
}

#[tauri::command]
pub async fn notes_convert(core: State<'_, Shared>, id: String, kind: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| notes::convert(s, &id, &kind))).await
}

// The vault argument stays for the renderer; the note's own vault is used.
#[tauri::command]
pub async fn notes_unlinked_mentions(core: State<'_, Shared>, note_id: String, vault_id: String) -> Result<Value, String> {
    let _ = vault_id;
    run(&core, move |c| c.session(|s| queries::unlinked_mentions(s, &note_id))).await
}

/// The note's Yjs state, raw. Empty when the note has no body yet.
#[tauri::command]
pub async fn notes_body_state(core: State<'_, Shared>, id: String) -> Result<Response, String> {
    let core = Arc::clone(&core);
    let bytes = tauri::async_runtime::spawn_blocking(move || core.session(|s| notes::body_state(s, &id)))
        .await
        .map_err(err)??;
    Ok(Response::new(bytes.unwrap_or_default()))
}

/// A Yjs update as the raw request body, the note id in `x-note-id`. Returns the note.
#[tauri::command]
pub async fn notes_apply_body_update(core: State<'_, Shared>, request: Request<'_>) -> Result<Value, String> {
    let InvokeBody::Raw(update) = request.body() else {
        return Err("notes_apply_body_update expects raw bytes".into());
    };
    let update = update.clone();
    let id = request
        .headers()
        .get("x-note-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-note-id header")?
        .to_owned();
    run(&core, move |c| {
        c.session(|s| {
            notes::apply_body_update(s, &id, &update)?;
            notes::get(s, &id)
        })
    })
    .await
}
