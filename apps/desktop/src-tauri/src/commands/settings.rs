use cord_core::settings_files;
use serde_json::{json, Value};
use tauri::State;

use crate::core::{err, run, Shared};
use crate::dto::DONE;

#[tauri::command]
pub async fn settings_read(core: State<'_, Shared>, file: String) -> Result<Value, String> {
    run(&core, move |c| {
        let id = c.me()?;
        let text = settings_files::read(&c.layout, &id, &file).map_err(err)?;
        Ok(json!({ "text": text }))
    })
    .await
}

#[tauri::command]
pub async fn settings_write(core: State<'_, Shared>, file: String, text: String) -> Result<Value, String> {
    run(&core, move |c| {
        let id = c.me()?;
        settings_files::write(&c.layout, &id, &file, &text).map_err(err)?;
        Ok(DONE)
    })
    .await
}
