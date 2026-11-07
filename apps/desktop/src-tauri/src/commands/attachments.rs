use base64::Engine;
use cord_core::services::attachments;
use serde_json::Value;
use tauri::State;

use crate::core::{run, Shared};
use crate::dto::CreateAttachmentIn;

#[tauri::command]
pub async fn attachments_create(core: State<'_, Shared>, data: CreateAttachmentIn) -> Result<Value, String> {
    run(&core, move |c| {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.data_base64.as_bytes())
            .map_err(|e| format!("The attachment is not base64: {e}"))?;
        c.session(|s| attachments::create(s, &data.vault_id, &data.mime, &bytes))
    })
    .await
}
