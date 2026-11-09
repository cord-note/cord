use cord_core::services::{fields, views};
use serde_json::Value;
use tauri::State;

use crate::core::{run, Shared};
use crate::dto::{CreateFieldIn, SetValueIn, UpdateFieldIn, UpdateViewIn};

#[tauri::command]
pub async fn tag_fields_list(core: State<'_, Shared>, tag_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| fields::list(s, &tag_id))).await
}

#[tauri::command]
pub async fn tag_fields_create(core: State<'_, Shared>, data: CreateFieldIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| fields::create(s, data.into()))).await
}

#[tauri::command]
pub async fn tag_fields_update(core: State<'_, Shared>, field_id: String, data: UpdateFieldIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| fields::update(s, &field_id, data.into()))).await
}

#[tauri::command]
pub async fn tag_fields_delete(core: State<'_, Shared>, field_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| fields::delete(s, &field_id))).await
}

#[tauri::command]
pub async fn field_values_set(core: State<'_, Shared>, data: SetValueIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| fields::set_value(s, data.into()))).await
}

#[tauri::command]
pub async fn field_values_clear(core: State<'_, Shared>, field_id: String, target_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| fields::clear_value(s, &field_id, &target_id))).await
}

#[tauri::command]
pub async fn field_values_for_note(core: State<'_, Shared>, note_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| fields::for_note(s, &note_id))).await
}

#[tauri::command]
pub async fn tag_views_page(core: State<'_, Shared>, tag_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| views::page(s, &tag_id))).await
}

#[tauri::command]
pub async fn tag_views_get(core: State<'_, Shared>, view_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| views::get(s, &view_id))).await
}

#[tauri::command]
pub async fn tag_views_create(core: State<'_, Shared>, tag_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| views::create(s, &tag_id))).await
}

#[tauri::command]
pub async fn tag_views_update(core: State<'_, Shared>, view_id: String, data: UpdateViewIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| views::update(s, &view_id, data.into()))).await
}

#[tauri::command]
pub async fn tag_views_delete(core: State<'_, Shared>, view_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| views::delete(s, &view_id))).await
}

#[tauri::command]
pub async fn tag_rows(core: State<'_, Shared>, tag_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| views::rows(s, &tag_id))).await
}
