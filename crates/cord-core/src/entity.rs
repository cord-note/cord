//! Every synced entity, where it lives, and the only functions that apply a
//! value to it. Local writes and (later) the sync receiver both go through here.

use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::clock;
use crate::doc::yjs::merge_update;
use crate::hlc::Hlc;
use crate::index::reindex_note;
use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entity {
    Vault,
    Note,
    Tag,
    NoteTag,
    BlockTag,
    BlockLink,
    Attachment,
}

impl Entity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Vault => "vault",
            Self::Note => "note",
            Self::Tag => "tag",
            Self::NoteTag => "note_tag",
            Self::BlockTag => "block_tag",
            Self::BlockLink => "block_link",
            Self::Attachment => "attachment",
        }
    }

    fn table(self) -> &'static str {
        match self {
            Self::Vault => "vaults",
            Self::Note => "notes",
            Self::Tag => "tags",
            Self::NoteTag => "note_tags",
            Self::BlockTag => "block_tags",
            Self::BlockLink => "block_links",
            Self::Attachment => "attachments",
        }
    }

    /// Key columns. A composite key is joined with ':' in the entity id.
    fn key(self) -> &'static [&'static str] {
        match self {
            Self::NoteTag => &["note_id", "tag_id"],
            Self::BlockTag => &["block_id", "tag_id"],
            _ => &["id"],
        }
    }

    /// Fields that change after create, each with its own clock.
    pub fn fields(self) -> &'static [&'static str] {
        match self {
            Self::Vault => &["name", "description", "color", "archived_at"],
            Self::Note => &["title", "kind", "is_pinned", "deleted_at", "purged_at"],
            Self::Tag => &["name", "color", "deleted_at"],
            Self::NoteTag | Self::BlockTag => &["removed_at"],
            Self::BlockLink | Self::Attachment => &["deleted_at"],
        }
    }

    /// Columns set once, at create.
    fn fixed(self) -> &'static [&'static str] {
        match self {
            Self::Vault => &["created_at", "updated_at"],
            Self::Note => &["vault_id", "created_at", "updated_at"],
            Self::Tag => &["vault_id", "created_at"],
            Self::NoteTag => &["vault_id", "created_at"],
            Self::BlockTag => &["note_id", "vault_id", "created_at"],
            Self::BlockLink => &["vault_id", "from_block_id", "from_note_id", "to_note_id", "to_block_id", "created_at"],
            Self::Attachment => &["vault_id", "sha256", "mime", "size", "created_at"],
        }
    }
}

/// `"a"` or `"a:b"` for a composite key.
pub fn entity_id(parts: &[&str]) -> String {
    parts.join(":")
}

/// Insert a row unless it exists, and give each field the create's stamp.
/// Returns false when the row was already there (a repeated create).
pub fn apply_create(conn: &Connection, entity: Entity, row: &Value, hlc: &Hlc) -> Result<bool> {
    let map = row.as_object().ok_or_else(|| Error::BadField("create row is not an object".into()))?;
    let allowed = |c: &str| entity.key().contains(&c) || entity.fields().contains(&c) || entity.fixed().contains(&c);
    if let Some(bad) = map.keys().find(|k| !allowed(k)) {
        return Err(Error::BadField(format!("{}.{bad}", entity.as_str())));
    }
    let id = row_id(entity, row)?;
    if let Some(note) = owning_note_of_row(entity, map) {
        if is_purged(conn, &note)? {
            return Ok(false);
        }
    }
    let cols: Vec<&str> = map.keys().map(String::as_str).collect();
    let marks: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT DO NOTHING",
        entity.table(),
        cols.join(", "),
        marks.join(", ")
    );
    let values = map.values().map(sql_value).collect::<Result<Vec<_>>>()?;
    if conn.execute(&sql, params_from_iter(values))? == 0 {
        return Ok(false);
    }
    for field in entity.fields() {
        clock::set_if_newer(conn, &id, field, hlc)?;
    }
    Ok(true)
}

/// Last-edit-wins write of one field. Returns false when an older stamp lost
/// or the owning note is purged.
pub fn apply_field(conn: &Connection, entity: Entity, entity_id: &str, field: &str, value: &Value, hlc: &Hlc) -> Result<bool> {
    if !entity.fields().contains(&field) {
        return Err(Error::BadField(format!("{}.{field}", entity.as_str())));
    }
    let keys = key_values(entity, entity_id)?;
    let exists = format!("SELECT 1 FROM {} WHERE {}", entity.table(), where_key(entity, 1));
    if conn.query_row(&exists, params_from_iter(keys.clone()), |_| Ok(())).optional()?.is_none() {
        return Err(Error::MissingRow(format!("{} {entity_id}", entity.as_str())));
    }
    if let Some(note) = owning_note(conn, entity, entity_id)? {
        if is_purged(conn, &note)? {
            return Ok(false);
        }
    }
    if !clock::set_if_newer(conn, entity_id, field, hlc)? {
        return Ok(false);
    }
    let stamp = hlc.wall as i64;
    let bumps = matches!(entity, Entity::Note | Entity::Vault);
    let sql = if bumps {
        format!("UPDATE {} SET {field} = ?1, updated_at = max(updated_at, ?2) WHERE {}", entity.table(), where_key(entity, 3))
    } else {
        format!("UPDATE {} SET {field} = ?1 WHERE {}", entity.table(), where_key(entity, 2))
    };
    let mut values = vec![sql_value(value)?];
    if bumps {
        values.push(SqlValue::Integer(stamp));
    }
    values.extend(keys);
    conn.execute(&sql, params_from_iter(values))?;
    if entity == Entity::Note && field == "purged_at" && !value.is_null() {
        purge_effects(conn, entity_id, stamp)?;
    }
    Ok(true)
}

/// Merge a Yjs update into a note's body and reindex it. Returns false when
/// the note is purged.
pub fn apply_body(conn: &Connection, note_id: &str, update: &[u8], hlc: &Hlc) -> Result<bool> {
    if is_purged(conn, note_id)? {
        return Ok(false);
    }
    let previous: Option<(Vec<u8>, i64)> = conn
        .query_row("SELECT yjs_state, updated_at FROM note_bodies WHERE note_id = ?1", [note_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let stamp = hlc.wall as i64;
    // A first update may be incremental; merging it with itself yields a full state.
    let (state, at) = match previous {
        Some((old, at)) => (merge_update(&old, update)?, stamp.max(at + 1)),
        None => (merge_update(update, update)?, stamp),
    };
    conn.execute(
        "INSERT INTO note_bodies (note_id, yjs_state, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (note_id) DO UPDATE SET yjs_state = excluded.yjs_state, updated_at = excluded.updated_at",
        params![note_id, state, at],
    )?;
    conn.execute("UPDATE notes SET updated_at = max(updated_at, ?1) WHERE id = ?2", params![stamp, note_id])?;
    reindex_note(conn, note_id)?;
    Ok(true)
}

/// The entity id a create row describes.
pub fn row_id(entity: Entity, row: &Value) -> Result<String> {
    let parts = entity
        .key()
        .iter()
        .map(|k| row.get(*k).and_then(Value::as_str).ok_or_else(|| Error::BadField(format!("{}.{k} missing", entity.as_str()))))
        .collect::<Result<Vec<_>>>()?;
    Ok(entity_id(&parts))
}

fn key_values(entity: Entity, entity_id: &str) -> Result<Vec<SqlValue>> {
    let parts: Vec<&str> = entity_id.split(':').collect();
    if parts.len() != entity.key().len() || parts.iter().any(|p| p.is_empty()) {
        return Err(Error::BadId(entity_id.to_owned()));
    }
    Ok(parts.into_iter().map(|p| SqlValue::Text(p.to_owned())).collect())
}

/// `a = ?n AND b = ?n+1`, numbering from `first`.
fn where_key(entity: Entity, first: usize) -> String {
    entity
        .key()
        .iter()
        .enumerate()
        .map(|(i, k)| format!("{k} = ?{}", first + i))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn sql_value(v: &Value) -> Result<SqlValue> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or_default()),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        _ => return Err(Error::BadField("a column value must be a scalar".into())),
    })
}

/// The note whose purge also freezes this row, if any.
fn owning_note(conn: &Connection, entity: Entity, entity_id: &str) -> Result<Option<String>> {
    Ok(match entity {
        Entity::Note => Some(entity_id.to_owned()),
        Entity::NoteTag => entity_id.split(':').next().map(str::to_owned),
        Entity::BlockTag => {
            let (block, tag) = entity_id.split_once(':').unwrap_or((entity_id, ""));
            conn.query_row("SELECT note_id FROM block_tags WHERE block_id = ?1 AND tag_id = ?2", [block, tag], |r| r.get(0))
                .optional()?
        }
        Entity::BlockLink => conn
            .query_row("SELECT from_note_id FROM block_links WHERE id = ?1", [entity_id], |r| r.get(0))
            .optional()?,
        _ => None,
    })
}

fn owning_note_of_row(entity: Entity, row: &Map<String, Value>) -> Option<String> {
    let col = match entity {
        Entity::NoteTag | Entity::BlockTag => "note_id",
        Entity::BlockLink => "from_note_id",
        _ => return None,
    };
    row.get(col).and_then(Value::as_str).map(str::to_owned)
}

fn is_purged(conn: &Connection, note_id: &str) -> Result<bool> {
    let purged: Option<Option<i64>> = conn
        .query_row("SELECT purged_at FROM notes WHERE id = ?1", [note_id], |r| r.get(0))
        .optional()?;
    Ok(matches!(purged, Some(Some(_))))
}

/// What purging a note means, applied the same way on every device.
fn purge_effects(conn: &Connection, note_id: &str, at: i64) -> Result<()> {
    conn.execute("UPDATE notes SET title = '' WHERE id = ?1", [note_id])?;
    conn.execute("DELETE FROM note_bodies WHERE note_id = ?1", [note_id])?;
    conn.execute("UPDATE note_tags SET removed_at = ?2 WHERE note_id = ?1 AND removed_at IS NULL", params![note_id, at])?;
    conn.execute("UPDATE block_tags SET removed_at = ?2 WHERE note_id = ?1 AND removed_at IS NULL", params![note_id, at])?;
    conn.execute("UPDATE block_links SET deleted_at = ?2 WHERE from_note_id = ?1 AND deleted_at IS NULL", params![note_id, at])?;
    reindex_note(conn, note_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::yjs::{json_to_state, state_to_json};
    use crate::layout::DataLayout;
    use crate::store::{open_user, UserDb};
    use serde_json::json;

    fn open() -> (tempfile::TempDir, UserDb) {
        let dir = tempfile::tempdir().unwrap();
        let db = open_user(&DataLayout::new(dir.path()), "u1", None).unwrap();
        (dir, db)
    }

    fn h(wall: u64, counter: u32) -> Hlc {
        Hlc { wall, counter, device: "dev".into() }
    }

    fn note(c: &Connection, id: &str, at: u64) {
        let row = json!({ "id": id, "vault_id": "v1", "title": "T", "kind": "note", "is_pinned": false, "created_at": 1, "updated_at": 1 });
        assert!(apply_create(c, Entity::Note, &row, &h(at, 0)).unwrap());
    }

    fn title(c: &Connection, id: &str) -> String {
        c.query_row("SELECT title FROM notes WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    fn body(text: &str) -> Vec<u8> {
        json_to_state(&json!({ "type": "doc", "content": [
            { "type": "paragraph", "attrs": { "blockId": "b1" }, "content": [{ "type": "text", "text": text }] }
        ]})).unwrap()
    }

    #[test]
    fn create_is_idempotent_and_sets_every_field_clock() {
        let (_d, db) = open();
        let c = &db.conn;
        note(c, "n1", 10);
        let again = json!({ "id": "n1", "vault_id": "v1", "title": "Other", "created_at": 1, "updated_at": 1 });
        assert!(!apply_create(c, Entity::Note, &again, &h(20, 0)).unwrap());
        assert_eq!(title(c, "n1"), "T");
        for f in Entity::Note.fields() {
            assert_eq!(clock::get(c, "n1", f).unwrap(), Some(h(10, 0)), "{f}");
        }
    }

    #[test]
    fn create_rejects_unknown_columns() {
        let (_d, db) = open();
        let row = json!({ "id": "n1", "vault_id": "v1", "secret": 1, "created_at": 1, "updated_at": 1 });
        assert!(matches!(apply_create(&db.conn, Entity::Note, &row, &h(1, 0)), Err(Error::BadField(_))));
    }

    #[test]
    fn newer_field_wins_and_older_loses() {
        let (_d, db) = open();
        let c = &db.conn;
        note(c, "n1", 10);
        assert!(apply_field(c, Entity::Note, "n1", "title", &json!("new"), &h(30, 0)).unwrap());
        assert!(!apply_field(c, Entity::Note, "n1", "title", &json!("old"), &h(20, 0)).unwrap());
        assert_eq!(title(c, "n1"), "new");
        let updated: i64 = c.query_row("SELECT updated_at FROM notes WHERE id = 'n1'", [], |r| r.get(0)).unwrap();
        assert_eq!(updated, 30);
    }

    #[test]
    fn booleans_and_nulls_reach_the_column() {
        let (_d, db) = open();
        let c = &db.conn;
        note(c, "n1", 10);
        apply_field(c, Entity::Note, "n1", "is_pinned", &json!(true), &h(11, 0)).unwrap();
        apply_field(c, Entity::Note, "n1", "deleted_at", &json!(99), &h(12, 0)).unwrap();
        apply_field(c, Entity::Note, "n1", "deleted_at", &Value::Null, &h(13, 0)).unwrap();
        let (pinned, deleted): (i64, Option<i64>) = c
            .query_row("SELECT is_pinned, deleted_at FROM notes WHERE id = 'n1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((pinned, deleted), (1, None));
    }

    #[test]
    fn unknown_fields_and_missing_rows_are_errors_without_a_clock() {
        let (_d, db) = open();
        let c = &db.conn;
        note(c, "n1", 10);
        assert!(matches!(apply_field(c, Entity::Note, "n1", "vault_id", &json!("v2"), &h(11, 0)), Err(Error::BadField(_))));
        assert!(matches!(apply_field(c, Entity::Note, "nope", "title", &json!("x"), &h(11, 0)), Err(Error::MissingRow(_))));
        assert_eq!(clock::get(c, "nope", "title").unwrap(), None);
    }

    #[test]
    fn composite_rows_use_joined_ids() {
        let (_d, db) = open();
        let c = &db.conn;
        note(c, "n1", 10);
        let row = json!({ "note_id": "n1", "tag_id": "t1", "vault_id": "v1", "created_at": 1 });
        assert_eq!(row_id(Entity::NoteTag, &row).unwrap(), "n1:t1");
        apply_create(c, Entity::NoteTag, &row, &h(11, 0)).unwrap();
        assert!(apply_field(c, Entity::NoteTag, "n1:t1", "removed_at", &json!(5), &h(12, 0)).unwrap());
        let removed: Option<i64> = c.query_row("SELECT removed_at FROM note_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(removed, Some(5));
    }

    #[test]
    fn body_updates_merge_and_reindex() {
        let (_d, db) = open();
        let c = &db.conn;
        note(c, "n1", 10);
        assert!(apply_body(c, "n1", &body("first"), &h(11, 0)).unwrap());
        let text: String = c.query_row("SELECT text FROM idx.blocks WHERE note_id = 'n1'", [], |r| r.get(0)).unwrap();
        assert_eq!(text, "first");
        let state: Vec<u8> = c.query_row("SELECT yjs_state FROM note_bodies", [], |r| r.get(0)).unwrap();
        assert_eq!(state_to_json(&state).unwrap()["content"][0]["content"][0]["text"], "first");
    }

    #[test]
    fn purge_wipes_the_note_and_ignores_everything_after() {
        let (_d, db) = open();
        let c = &db.conn;
        note(c, "n1", 10);
        apply_body(c, "n1", &body("secret"), &h(11, 0)).unwrap();
        let tag = json!({ "note_id": "n1", "tag_id": "t1", "vault_id": "v1", "created_at": 1 });
        apply_create(c, Entity::NoteTag, &tag, &h(12, 0)).unwrap();

        assert!(apply_field(c, Entity::Note, "n1", "purged_at", &json!(50), &h(50, 0)).unwrap());
        assert_eq!(title(c, "n1"), "");
        let bodies: i64 = c.query_row("SELECT count(*) FROM note_bodies", [], |r| r.get(0)).unwrap();
        let blocks: i64 = c.query_row("SELECT count(*) FROM idx.blocks", [], |r| r.get(0)).unwrap();
        let removed: Option<i64> = c.query_row("SELECT removed_at FROM note_tags", [], |r| r.get(0)).unwrap();
        assert_eq!((bodies, blocks, removed), (0, 0, Some(50)));

        assert!(!apply_field(c, Entity::Note, "n1", "title", &json!("back"), &h(60, 0)).unwrap());
        assert!(!apply_field(c, Entity::NoteTag, "n1:t1", "removed_at", &Value::Null, &h(61, 0)).unwrap());
        assert!(!apply_body(c, "n1", &body("again"), &h(62, 0)).unwrap());
        let late = json!({ "note_id": "n1", "tag_id": "t2", "vault_id": "v1", "created_at": 1 });
        assert!(!apply_create(c, Entity::NoteTag, &late, &h(63, 0)).unwrap());
        assert_eq!(title(c, "n1"), "");
    }
}
