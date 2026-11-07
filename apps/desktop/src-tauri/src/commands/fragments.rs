use std::collections::BTreeMap;

use cord_core::services::annotations;
use serde_json::Value;
use tauri::State;

use crate::core::{run, Shared};
use crate::dto::{CreateFragmentLinkIn, FragmentAnnotationOut, FragmentLinkOut};

#[tauri::command]
pub async fn fragments_get_for_note(core: State<'_, Shared>, note_id: String) -> Result<Value, String> {
    run(&core, move |c| {
        let map = c.session(|s| annotations::for_note(s, &note_id))?;
        Ok(map.into_iter().map(|(k, v)| (k, FragmentAnnotationOut::from(v))).collect::<BTreeMap<_, _>>())
    })
    .await
}

// The vault argument stays for the renderer; the tag's own vault is used.
#[tauri::command]
pub async fn fragments_attach_tag(
    core: State<'_, Shared>,
    block_id: String,
    note_id: String,
    vault_id: String,
    tag_id: String,
) -> Result<Value, String> {
    let _ = vault_id;
    run(&core, move |c| c.session(|s| annotations::attach_tag(s, &block_id, &note_id, &tag_id))).await
}

#[tauri::command]
pub async fn fragments_detach_tag(core: State<'_, Shared>, block_id: String, tag_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| annotations::detach_tag(s, &block_id, &tag_id))).await
}

#[tauri::command]
pub async fn fragments_create_link(core: State<'_, Shared>, data: CreateFragmentLinkIn) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| annotations::create_link(s, data.into())).map(FragmentLinkOut::from)).await
}

#[tauri::command]
pub async fn fragments_delete_link(core: State<'_, Shared>, link_id: String) -> Result<Value, String> {
    run(&core, move |c| c.session(|s| annotations::delete_link(s, &link_id))).await
}
