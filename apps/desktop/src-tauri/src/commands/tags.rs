use cord_core::services::tags;
use serde_json::Value;
use tauri::State;

use crate::core::{run, Shared};
use crate::dto::{CreateTagIn, UpdateTagIn};

#[tauri::command]
pub async fn tags_list(core: State<'_, Shared>, vault_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| tags::list(s, &vault_id))).await
}

#[tauri::command]
pub async fn tags_create(core: State<'_, Shared>, data: CreateTagIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| tags::create(s, data.into()))).await
}

#[tauri::command]
pub async fn tags_update(core: State<'_, Shared>, tag_id: String, data: UpdateTagIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| tags::update(s, &tag_id, data.into()))).await
}

#[tauri::command]
pub async fn tags_delete(core: State<'_, Shared>, tag_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| tags::delete(s, &tag_id))).await
}

#[tauri::command]
pub async fn tags_attach(core: State<'_, Shared>, note_id: String, tag_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| tags::attach(s, &note_id, &tag_id))).await
}

#[tauri::command]
pub async fn tags_detach(core: State<'_, Shared>, note_id: String, tag_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| tags::detach(s, &note_id, &tag_id))).await
}

#[tauri::command]
pub async fn tags_get_for_note(core: State<'_, Shared>, note_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| tags::for_note(s, &note_id))).await
}

#[tauri::command]
pub async fn tags_get_note_map(core: State<'_, Shared>, vault_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| tags::note_map(s, &vault_id))).await
}
