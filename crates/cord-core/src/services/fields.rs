//! Fields on tags, and the values notes and blocks give them.

use rusqlite::{OptionalExtension, Row};
use serde_json::{json, Value};

use crate::entity::{entity_id, Entity};
use crate::model::{FieldChanges, FieldValue, NewField, NoteFields, SelectOption, SetValue, TagField};
use crate::services::tags::require_live;
use crate::session::Session;
use crate::{Error, Result};

pub const FIELD_TYPES: [&str; 6] = ["text", "number", "checkbox", "select", "multi_select", "date"];

const COLUMNS: &str = "f.id, f.tag_id, f.vault_id, f.name, f.type, f.options, f.sort, f.created_at";

fn field(r: &Row<'_>) -> rusqlite::Result<TagField> {
    let options: String = r.get(5)?;
    Ok(TagField {
        id: r.get(0)?,
        tag_id: r.get(1)?,
        vault_id: r.get(2)?,
        name: r.get(3)?,
        kind: r.get(4)?,
        // A malformed list reads as no options; the row itself is kept.
        options: serde_json::from_str(&options).unwrap_or_default(),
        sort: r.get(6)?,
        created_at: r.get(7)?,
    })
}

pub fn list(s: &Session, tag_id: &str) -> Result<Vec<TagField>> {
    let sql = format!("SELECT {COLUMNS} FROM tag_fields f WHERE f.tag_id = ?1 AND f.deleted_at IS NULL ORDER BY f.sort, f.created_at, f.id");
    let mut st = s.conn().prepare(&sql)?;
    let rows = st.query_map([tag_id], field)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn create(s: &mut Session, input: NewField) -> Result<TagField> {
    let tag = require_live(s, &input.tag_id)?;
    let name = clean(&input.name)?;
    check_kind(&input.kind)?;
    let options = options_text(&input.options)?;
    let sort: i64 = s.conn().query_row(
        "SELECT coalesce(max(sort), -1) + 1 FROM tag_fields WHERE tag_id = ?1 AND deleted_at IS NULL",
        [&tag.id],
        |r| r.get(0),
    )?;
    let id = nanoid::nanoid!();
    s.write(|w| {
        let now = w.now();
        w.create(Entity::TagField, &tag.vault_id, json!({
            "id": id, "tag_id": tag.id, "vault_id": tag.vault_id, "name": name, "type": input.kind,
            "options": options, "sort": sort, "created_at": now,
        }))
    })?;
    require(s, &id)
}

pub fn update(s: &mut Session, id: &str, input: FieldChanges) -> Result<TagField> {
    let f = require(s, id)?;
    let name = input.name.as_deref().map(clean).transpose()?;
    if let Some(k) = &input.kind {
        check_kind(k)?;
    }
    let options = input.options.as_deref().map(options_text).transpose()?;
    s.write(|w| {
        if let Some(n) = name {
            w.set(Entity::TagField, &f.vault_id, id, "name", json!(n))?;
        }
        if let Some(k) = input.kind {
            w.set(Entity::TagField, &f.vault_id, id, "type", json!(k))?;
        }
        if let Some(o) = options {
            w.set(Entity::TagField, &f.vault_id, id, "options", json!(o))?;
        }
        if let Some(sort) = input.sort {
            w.set(Entity::TagField, &f.vault_id, id, "sort", json!(sort))?;
        }
        Ok(())
    })?;
    require(s, id)
}

pub fn delete(s: &mut Session, id: &str) -> Result<()> {
    let f = require(s, id)?;
    s.write(|w| {
        let now = w.now();
        w.set(Entity::TagField, &f.vault_id, id, "deleted_at", json!(now))
    })?;
    Ok(())
}

/// Set a note's or block's value for a field. The value must fit the field.
pub fn set_value(s: &mut Session, input: SetValue) -> Result<()> {
    let f = require(s, &input.field_id)?;
    if !matches!(input.target_kind.as_str(), "note" | "block") {
        return Err(Error::Invalid(format!("unknown target kind: {}", input.target_kind)));
    }
    if !fits(&f, &input.value) {
        return Err(Error::Invalid(format!("That value doesn't fit the field \"{}\"", f.name)));
    }
    let text = serde_json::to_string(&input.value).map_err(|e| Error::Invalid(e.to_string()))?;
    let key = entity_id(&[&input.field_id, &input.target_id]);
    let existing = removed_at(s, &input.field_id, &input.target_id)?;
    s.write(|w| {
        match existing {
            None => {
                let now = w.now();
                w.create(Entity::FieldValue, &f.vault_id, json!({
                    "field_id": input.field_id, "target_id": input.target_id, "target_kind": input.target_kind,
                    "note_id": input.note_id, "vault_id": f.vault_id, "value": text, "created_at": now,
                }))?;
            }
            Some(removed) => {
                w.set(Entity::FieldValue, &f.vault_id, &key, "value", json!(text))?;
                if removed.is_some() {
                    w.set(Entity::FieldValue, &f.vault_id, &key, "removed_at", Value::Null)?;
                }
            }
        }
        Ok(())
    })
}

pub fn clear_value(s: &mut Session, field_id: &str, target_id: &str) -> Result<()> {
    let f = require(s, field_id)?;
    if let Some(None) = removed_at(s, field_id, target_id)? {
        let key = entity_id(&[field_id, target_id]);
        s.write(|w| {
            let now = w.now();
            w.set(Entity::FieldValue, &f.vault_id, &key, "removed_at", json!(now))
        })?;
    }
    Ok(())
}

/// Fields of the tags on a note or its blocks, and the values that show now:
/// a value shows only while its target carries the field's tag.
pub fn for_note(s: &Session, note_id: &str) -> Result<NoteFields> {
    let sql = format!(
        "SELECT {COLUMNS} FROM tag_fields f JOIN tags t ON t.id = f.tag_id
         WHERE f.deleted_at IS NULL AND t.deleted_at IS NULL AND f.tag_id IN (
           SELECT tag_id FROM note_tags WHERE note_id = ?1 AND removed_at IS NULL
           UNION SELECT tag_id FROM block_tags WHERE note_id = ?1 AND removed_at IS NULL)
         ORDER BY t.name, f.sort, f.id"
    );
    let mut st = s.conn().prepare(&sql)?;
    let fields = st.query_map([note_id], field)?.collect::<rusqlite::Result<Vec<_>>>()?;

    let mut st = s.conn().prepare(
        "SELECT v.field_id, v.target_id, v.target_kind, v.note_id, v.value
         FROM field_values v JOIN tag_fields f ON f.id = v.field_id
         WHERE v.note_id = ?1 AND v.removed_at IS NULL AND f.deleted_at IS NULL AND (
           (v.target_kind = 'note' AND EXISTS (SELECT 1 FROM note_tags nt
              WHERE nt.note_id = v.target_id AND nt.tag_id = f.tag_id AND nt.removed_at IS NULL))
           OR (v.target_kind = 'block' AND EXISTS (SELECT 1 FROM block_tags bt
              WHERE bt.block_id = v.target_id AND bt.tag_id = f.tag_id AND bt.removed_at IS NULL)))
         ORDER BY v.field_id, v.target_id",
    )?;
    let values = st
        .query_map([note_id], |r| {
            let text: Option<String> = r.get(4)?;
            Ok(FieldValue {
                field_id: r.get(0)?,
                target_id: r.get(1)?,
                target_kind: r.get(2)?,
                note_id: r.get(3)?,
                value: parse_value(text.as_deref()),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(NoteFields { fields, values })
}

/// A stored value as JSON; unreadable text reads as null and is kept.
pub(crate) fn parse_value(text: Option<&str>) -> Value {
    text.and_then(|t| serde_json::from_str(t).ok()).unwrap_or(Value::Null)
}

/// Whether a value has the shape the field's type needs right now.
pub fn fits(f: &TagField, v: &Value) -> bool {
    let known = |id: &str| f.options.iter().any(|o| o.id == id);
    match f.kind.as_str() {
        "text" => v.is_string(),
        "number" => v.is_number(),
        "checkbox" => v.is_boolean(),
        "date" => v.as_str().is_some_and(is_date),
        "select" => v.as_str().is_some_and(known),
        "multi_select" => v.as_array().is_some_and(|a| a.iter().all(|x| x.as_str().is_some_and(known))),
        _ => false,
    }
}

/// `YYYY-MM-DD`, optionally followed by `T` and a time.
fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 10
        && b[4] == b'-'
        && b[7] == b'-'
        && [0, 1, 2, 3, 5, 6, 8, 9].iter().all(|&i| b[i].is_ascii_digit())
        && (b.len() == 10 || b[10] == b'T')
}

fn removed_at(s: &Session, field_id: &str, target_id: &str) -> Result<Option<Option<i64>>> {
    Ok(s.conn()
        .query_row(
            "SELECT removed_at FROM field_values WHERE field_id = ?1 AND target_id = ?2",
            [field_id, target_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub(crate) fn require(s: &Session, id: &str) -> Result<TagField> {
    let sql = format!("SELECT {COLUMNS} FROM tag_fields f WHERE f.id = ?1 AND f.deleted_at IS NULL");
    s.conn().query_row(&sql, [id], field).optional()?.ok_or_else(|| Error::NotFound(format!("field {id}")))
}

fn check_kind(kind: &str) -> Result<()> {
    if FIELD_TYPES.contains(&kind) {
        Ok(())
    } else {
        Err(Error::Invalid(format!("unknown field type: {kind}")))
    }
}

fn options_text(options: &[SelectOption]) -> Result<String> {
    let mut seen = std::collections::HashSet::new();
    for o in options {
        if o.id.is_empty() || o.name.trim().is_empty() || !seen.insert(o.id.as_str()) {
            return Err(Error::Invalid("Each option needs a name and its own id".into()));
        }
    }
    serde_json::to_string(options).map_err(|e| Error::Invalid(e.to_string()))
}

fn clean(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::Invalid("A field needs a name".into()));
    }
    Ok(trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{NewNote, NewTag};
    use crate::services::{notes, tags};
    use crate::session::test_session;

    fn setup(s: &mut Session) -> (String, String) {
        let tag = tags::create(s, NewTag { vault_id: "v1".into(), name: "task".into(), color: None }).unwrap();
        let note = notes::create(s, NewNote { vault_id: "v1".into(), title: Some("A".into()), ..Default::default() }).unwrap();
        tags::attach(s, &note.meta.id, &tag.id).unwrap();
        (tag.id, note.meta.id)
    }

    fn status(s: &mut Session, tag: &str) -> TagField {
        let options = vec![
            SelectOption { id: "todo".into(), name: "Todo".into(), color: None },
            SelectOption { id: "done".into(), name: "Done".into(), color: Some("#57a95b".into()) },
        ];
        create(s, NewField { tag_id: tag.into(), name: "Status".into(), kind: "select".into(), options }).unwrap()
    }

    fn set(s: &mut Session, field: &str, note: &str, value: Value) -> Result<()> {
        set_value(s, SetValue { field_id: field.into(), target_id: note.into(), target_kind: "note".into(), note_id: note.into(), value })
    }

    #[test]
    fn creates_lists_updates_and_deletes_fields() {
        let (_d, mut s) = test_session();
        let (tag, _) = setup(&mut s);
        let a = status(&mut s, &tag);
        let b = create(&mut s, NewField { tag_id: tag.clone(), name: " Due ".into(), kind: "date".into(), options: vec![] }).unwrap();
        assert_eq!((b.name.as_str(), b.sort), ("Due", 1));
        assert_eq!(list(&s, &tag).unwrap().iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["Status", "Due"]);

        let renamed = update(&mut s, &a.id, FieldChanges { name: Some("State".into()), sort: Some(5), ..Default::default() }).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.sort), ("State", 5));
        assert!(matches!(update(&mut s, &a.id, FieldChanges { kind: Some("colour".into()), ..Default::default() }), Err(Error::Invalid(_))));
        assert!(matches!(create(&mut s, NewField { tag_id: tag.clone(), name: "".into(), kind: "text".into(), options: vec![] }), Err(Error::Invalid(_))));

        delete(&mut s, &b.id).unwrap();
        assert_eq!(list(&s, &tag).unwrap().len(), 1);
    }

    #[test]
    fn values_must_fit_their_field() {
        let (_d, mut s) = test_session();
        let (tag, note) = setup(&mut s);
        let f = status(&mut s, &tag);
        assert!(matches!(set(&mut s, &f.id, &note, json!("nope")), Err(Error::Invalid(_))), "unknown option");
        assert!(matches!(set(&mut s, &f.id, &note, json!(3)), Err(Error::Invalid(_))));
        set(&mut s, &f.id, &note, json!("todo")).unwrap();

        let due = create(&mut s, NewField { tag_id: tag, name: "Due".into(), kind: "date".into(), options: vec![] }).unwrap();
        set(&mut s, &due.id, &note, json!("2026-12-01")).unwrap();
        set(&mut s, &due.id, &note, json!("2026-12-01T09:30")).unwrap();
        assert!(matches!(set(&mut s, &due.id, &note, json!("tomorrow")), Err(Error::Invalid(_))));
    }

    #[test]
    fn values_show_only_while_the_tag_is_on() {
        let (_d, mut s) = test_session();
        let (tag, note) = setup(&mut s);
        let f = status(&mut s, &tag);
        set(&mut s, &f.id, &note, json!("todo")).unwrap();
        set(&mut s, &f.id, &note, json!("done")).unwrap();
        let shown = for_note(&s, &note).unwrap();
        assert_eq!(shown.fields.len(), 1);
        assert_eq!(shown.values[0].value, json!("done"));

        tags::detach(&mut s, &note, &tag).unwrap();
        let hidden = for_note(&s, &note).unwrap();
        assert!(hidden.fields.is_empty() && hidden.values.is_empty());
        tags::attach(&mut s, &note, &tag).unwrap();
        assert_eq!(for_note(&s, &note).unwrap().values[0].value, json!("done"), "back after re-tagging");

        clear_value(&mut s, &f.id, &note).unwrap();
        assert!(for_note(&s, &note).unwrap().values.is_empty());
        set(&mut s, &f.id, &note, json!("todo")).unwrap();
        assert_eq!(for_note(&s, &note).unwrap().values.len(), 1, "a cleared value can be set again");
    }

    #[test]
    fn two_cells_of_one_row_keep_their_own_clocks() {
        let (_d, mut s) = test_session();
        let (tag, note) = setup(&mut s);
        let a = status(&mut s, &tag);
        let b = create(&mut s, NewField { tag_id: tag, name: "Done".into(), kind: "checkbox".into(), options: vec![] }).unwrap();
        set(&mut s, &a.id, &note, json!("todo")).unwrap();
        set(&mut s, &b.id, &note, json!(true)).unwrap();
        let clocks: i64 = s.conn().query_row("SELECT count(*) FROM field_clocks WHERE field = 'value'", [], |r| r.get(0)).unwrap();
        assert_eq!(clocks, 2);
        assert_eq!(for_note(&s, &note).unwrap().values.len(), 2);
    }

    #[test]
    fn a_value_that_no_longer_fits_is_kept() {
        let (_d, mut s) = test_session();
        let (tag, note) = setup(&mut s);
        let f = create(&mut s, NewField { tag_id: tag, name: "Points".into(), kind: "number".into(), options: vec![] }).unwrap();
        set(&mut s, &f.id, &note, json!(3)).unwrap();
        update(&mut s, &f.id, FieldChanges { kind: Some("text".into()), ..Default::default() }).unwrap();
        assert_eq!(for_note(&s, &note).unwrap().values[0].value, json!(3), "kept; the app shows it blank");
    }

    #[test]
    fn a_purge_removes_the_notes_values() {
        let (_d, mut s) = test_session();
        let (tag, note) = setup(&mut s);
        let f = status(&mut s, &tag);
        set(&mut s, &f.id, &note, json!("todo")).unwrap();
        notes::delete(&mut s, &note).unwrap();
        notes::purge(&mut s, &note).unwrap();
        let live: i64 = s.conn().query_row("SELECT count(*) FROM field_values WHERE removed_at IS NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(live, 0);
    }
}
