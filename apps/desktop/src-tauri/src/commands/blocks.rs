use cord_core::index::reindex_note;
use cord_core::services::queries;
use serde_json::Value;
use tauri::State;

use crate::core::{run, Shared};

#[tauri::command]
pub async fn blocks_list_for_note(core: State<'_, Shared>, note_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| queries::blocks_for_note(s, &note_id))).await
}

#[tauri::command]
pub async fn blocks_resolve_ref(core: State<'_, Shared>, block_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| queries::resolve_ref(s, &block_id))).await
}

#[tauri::command]
pub async fn blocks_reproject(core: State<'_, Shared>, note_id: String) -> Result<Value, String> {
    run(&core, move |c| {
        c.session(|s| {
            reindex_note(s.conn(), &note_id)?;
            queries::blocks_for_note(s, &note_id)
        })
    })
    .await
}
