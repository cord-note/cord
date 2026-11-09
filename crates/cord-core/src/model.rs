//! Values handed across the IPC boundary (camelCase JSON, as the TS types),
//! and the plain inputs services take.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
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

/// One choice of a select field. Its id survives renames.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectOption {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagField {
    pub id: String,
    pub tag_id: String,
    pub vault_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub options: Vec<SelectOption>,
    pub sort: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default)]
pub struct NewField {
    pub tag_id: String,
    pub name: String,
    pub kind: String,
    pub options: Vec<SelectOption>,
}

#[derive(Debug, Clone, Default)]
pub struct FieldChanges {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub options: Option<Vec<SelectOption>>,
    pub sort: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldValue {
    pub field_id: String,
    pub target_id: String,
    pub target_kind: String,
    pub note_id: String,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct SetValue {
    pub field_id: String,
    pub target_id: String,
    pub target_kind: String,
    pub note_id: String,
    pub value: Value,
}

/// The fields of every tag on a note or its blocks, and the values shown now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFields {
    pub fields: Vec<TagField>,
    pub values: Vec<FieldValue>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagView {
    pub id: String,
    pub tag_id: String,
    pub vault_id: String,
    pub kind: String,
    pub config: Value,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default)]
pub struct ViewChanges {
    pub kind: Option<String>,
    pub config: Option<Value>,
}

/// One row of a tag's table: a tagged note, or a tagged block in a live note.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRow {
    pub kind: String,
    pub target_id: String,
    pub note_id: String,
    pub title: String,
    pub text: Option<String>,
    pub updated_at: i64,
    pub values: BTreeMap<String, Value>,
}
