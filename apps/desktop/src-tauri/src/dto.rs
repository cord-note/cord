//! What crosses the IPC boundary where it differs from cord-core's own types.

use cord_core::model::{
    BlockAnnotation, BlockLink, NewBlockLink, NewNote, NewTag, NewVault, NoteChanges, Tag, TagChanges, VaultChanges,
};
use serde::{Deserialize, Deserializer, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultIn {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
}

impl VaultIn {
    pub fn new_vault(self) -> NewVault {
        NewVault { name: self.name.unwrap_or_default(), description: self.description, color: self.color }
    }

    pub fn changes(self) -> VaultChanges {
        VaultChanges { name: self.name, description: self.description, color: self.color }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteIn {
    pub vault_id: String,
    pub title: Option<String>,
    pub body_json: Option<String>,
    pub kind: Option<String>,
}

impl CreateNoteIn {
    pub fn new_note(self) -> Result<NewNote, String> {
        let body = match self.body_json {
            Some(text) => Some(serde_json::from_str(&text).map_err(|e| format!("bodyJson is not JSON: {e}"))?),
            None => None,
        };
        Ok(NewNote { vault_id: self.vault_id, title: self.title, kind: self.kind, body })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteIn {
    pub title: Option<String>,
    pub is_pinned: Option<bool>,
    pub body_json: Option<String>,
}

impl UpdateNoteIn {
    pub fn changes(self) -> Result<NoteChanges, String> {
        if self.body_json.is_some() {
            return Err("Note bodies change through notes_apply_body_update, not bodyJson".into());
        }
        Ok(NoteChanges { title: self.title, is_pinned: self.is_pinned })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagIn {
    pub vault_id: String,
    pub name: String,
    pub color: Option<String>,
}

impl From<CreateTagIn> for NewTag {
    fn from(t: CreateTagIn) -> Self {
        NewTag { vault_id: t.vault_id, name: t.name, color: t.color }
    }
}

#[derive(Deserialize)]
pub struct UpdateTagIn {
    pub name: Option<String>,
    /// Missing: unchanged. null: cleared.
    #[serde(default, deserialize_with = "present")]
    pub color: Option<Option<String>>,
}

impl From<UpdateTagIn> for TagChanges {
    fn from(t: UpdateTagIn) -> Self {
        TagChanges { name: t.name, color: t.color }
    }
}

/// A field that is present (even as null) becomes Some.
fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFragmentLinkIn {
    pub from_fragment_id: String,
    pub from_note_id: String,
    pub vault_id: String,
    pub to_note_id: Option<String>,
    pub to_fragment_id: Option<String>,
}

impl From<CreateFragmentLinkIn> for NewBlockLink {
    fn from(l: CreateFragmentLinkIn) -> Self {
        NewBlockLink {
            vault_id: l.vault_id,
            from_block_id: l.from_fragment_id,
            from_note_id: l.from_note_id,
            to_note_id: l.to_note_id,
            to_block_id: l.to_fragment_id,
        }
    }
}

/// The renderer's FragmentLink: block links under their old names.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FragmentLinkOut {
    pub id: String,
    pub from_fragment_id: String,
    pub to_note_id: Option<String>,
    pub to_fragment_id: Option<String>,
    pub vault_id: String,
    pub created_at: i64,
}

impl From<BlockLink> for FragmentLinkOut {
    fn from(l: BlockLink) -> Self {
        Self {
            id: l.id,
            from_fragment_id: l.from_block_id,
            to_note_id: l.to_note_id,
            to_fragment_id: l.to_block_id,
            vault_id: l.vault_id,
            created_at: l.created_at,
        }
    }
}

#[derive(Serialize)]
pub struct FragmentAnnotationOut {
    pub tags: Vec<Tag>,
    pub links: Vec<FragmentLinkOut>,
    pub backlinks: Vec<FragmentLinkOut>,
}

impl From<BlockAnnotation> for FragmentAnnotationOut {
    fn from(a: BlockAnnotation) -> Self {
        Self {
            tags: a.tags,
            links: a.links.into_iter().map(Into::into).collect(),
            backlinks: a.backlinks.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAttachmentIn {
    pub vault_id: String,
    pub mime: String,
    pub data_base64: String,
}

#[derive(Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockPinIn {
    pub user_id: String,
    pub pin: String,
}

#[derive(Deserialize)]
pub struct SetPinIn {
    pub pin: String,
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct PasswordIn {
    pub password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordIn {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverIn {
    pub username: String,
    pub recovery_key: String,
    pub new_password: String,
}

/// `{ "ok": true }`, the reply of commands that return nothing else.
#[derive(Serialize)]
pub struct Done {
    pub ok: bool,
}

pub const DONE: Done = Done { ok: true };

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tag_colour_tells_missing_from_null() {
        let missing: UpdateTagIn = serde_json::from_value(json!({ "name": "x" })).unwrap();
        let null: UpdateTagIn = serde_json::from_value(json!({ "color": null })).unwrap();
        let set: UpdateTagIn = serde_json::from_value(json!({ "color": "#fff" })).unwrap();
        assert_eq!((missing.color, null.color, set.color), (None, Some(None), Some(Some("#fff".into()))));
    }

    #[test]
    fn block_links_go_out_under_their_old_names() {
        let out = serde_json::to_value(FragmentLinkOut::from(BlockLink {
            id: "l".into(),
            vault_id: "v".into(),
            from_block_id: "b".into(),
            from_note_id: "n".into(),
            to_note_id: None,
            to_block_id: Some("t".into()),
            created_at: 1,
        }))
        .unwrap();
        assert_eq!(
            out,
            json!({ "id": "l", "fromFragmentId": "b", "toNoteId": null, "toFragmentId": "t", "vaultId": "v", "createdAt": 1 })
        );
    }

    #[test]
    fn a_body_in_a_note_update_is_refused() {
        let input: UpdateNoteIn = serde_json::from_value(json!({ "bodyJson": "{}" })).unwrap();
        assert!(input.changes().is_err());
        let ok: UpdateNoteIn = serde_json::from_value(json!({ "title": "T", "isPinned": true })).unwrap();
        let c = ok.changes().unwrap();
        assert_eq!((c.title.as_deref(), c.is_pinned), (Some("T"), Some(true)));
    }

    #[test]
    fn a_new_note_body_must_be_json() {
        let bad: CreateNoteIn = serde_json::from_value(json!({ "vaultId": "v", "bodyJson": "{" })).unwrap();
        assert!(bad.new_note().is_err());
        let good: CreateNoteIn = serde_json::from_value(json!({ "vaultId": "v", "bodyJson": "{\"type\":\"doc\"}" })).unwrap();
        assert_eq!(good.new_note().unwrap().body, Some(json!({ "type": "doc" })));
    }
}
