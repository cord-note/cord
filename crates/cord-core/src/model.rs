//! Values handed across the IPC boundary (camelCase JSON, as the TS types),
//! and the plain inputs services take.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItem {
    pub id: String,
    pub vault_id: String,
    pub title: String,
    pub kind: String,
    pub is_pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    #[serde(flatten)]
    pub meta: NoteListItem,
    pub body_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLink {
    pub id: String,
    pub from_note_id: String,
    pub to_note_id: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct NoteLinks {
    pub outbound: Vec<NoteLink>,
    pub backlinks: Vec<NoteLink>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkedMention {
    pub note_id: String,
    pub note_title: String,
    pub excerpt: String,
    pub block_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: String,
    pub note_id: String,
    pub vault_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub sort: i64,
    pub level: Option<i64>,
    pub text: String,
    pub ref_block_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockRefTarget {
    pub block_id: String,
    pub note_id: String,
    pub note_title: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub content_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub vault_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTagRow {
    pub note_id: String,
    pub tag_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockLink {
    pub id: String,
    pub vault_id: String,
    pub from_block_id: String,
    pub from_note_id: String,
    pub to_note_id: Option<String>,
    pub to_block_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct BlockAnnotation {
    pub tags: Vec<Tag>,
    pub links: Vec<BlockLink>,
    pub backlinks: Vec<BlockLink>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub vault_id: String,
    pub mime: String,
    pub size: i64,
    pub sha256: String,
    pub created_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct NewVault {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct VaultChanges {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct NewNote {
    pub vault_id: String,
    pub title: Option<String>,
    pub kind: Option<String>,
    /// Tiptap JSON; an empty paragraph when None.
    pub body: Option<Value>,
}

#[derive(Debug, Clone, Default)]
pub struct NoteChanges {
    pub title: Option<String>,
    pub is_pinned: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct NewTag {
    pub vault_id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TagChanges {
    pub name: Option<String>,
    /// Some(None) clears the colour.
    pub color: Option<Option<String>>,
}

#[derive(Debug, Clone, Default)]
pub struct NewBlockLink {
    pub vault_id: String,
    pub from_block_id: String,
    pub from_note_id: String,
    pub to_note_id: Option<String>,
    pub to_block_id: Option<String>,
}
