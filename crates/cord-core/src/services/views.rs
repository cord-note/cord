//! Saved table and board views of a tag, and the rows they show.

use std::collections::BTreeMap;

use rusqlite::{OptionalExtension, Row};
use serde_json::{json, Value};

use crate::entity::Entity;
use crate::model::{TagRow, TagView, ViewChanges};
use crate::services::fields::parse_value;
use crate::services::tags::require_live;
use crate::session::Session;
use crate::{Error, Result};

pub const VIEW_KINDS: [&str; 2] = ["table", "board"];

const COLUMNS: &str = "v.id, v.tag_id, v.vault_id, v.kind, v.config, v.created_at";

fn view(r: &Row<'_>) -> rusqlite::Result<TagView> {
    let config: String = r.get(4)?;
    Ok(TagView {
        id: r.get(0)?,
        tag_id: r.get(1)?,
        vault_id: r.get(2)?,
        kind: r.get(3)?,
        config: serde_json::from_str(&config).unwrap_or_else(|_| json!({})),
        created_at: r.get(5)?,
    })
}

/// The id of a tag page's own view. Deterministic, so two devices opening the
/// page for the first time create the same row.
pub fn page_view_id(tag_id: &str) -> String {
    format!("{tag_id}-page")
}

/// The tag page's view, created on first use.
pub fn page(s: &mut Session, tag_id: &str) -> Result<TagView> {
    let id = page_view_id(tag_id);
    if let Some(v) = get(s, &id)? {
        return Ok(v);
    }
    insert(s, tag_id, &id)?;
    require(s, &id)
}

/// A new view for an embed in a note.
pub fn create(s: &mut Session, tag_id: &str) -> Result<TagView> {
    let id = nanoid::nanoid!();
    insert(s, tag_id, &id)?;
    require(s, &id)
}

pub fn get(s: &Session, id: &str) -> Result<Option<TagView>> {
    let sql = format!("SELECT {COLUMNS} FROM tag_views v WHERE v.id = ?1 AND v.deleted_at IS NULL");
    Ok(s.conn().query_row(&sql, [id], view).optional()?)
}

pub fn update(s: &mut Session, id: &str, input: ViewChanges) -> Result<TagView> {
    let v = require(s, id)?;
    if let Some(k) = &input.kind {
        if !VIEW_KINDS.contains(&k.as_str()) {
            return Err(Error::Invalid(format!("unknown view kind: {k}")));
        }
    }
    if let Some(c) = &input.config {
        if !c.is_object() {
            return Err(Error::Invalid("a view's settings must be an object".into()));
        }
    }
    s.write(|w| {
        if let Some(k) = input.kind {
            w.set(Entity::TagView, &v.vault_id, id, "kind", json!(k))?;
        }
        if let Some(c) = input.config {
            w.set(Entity::TagView, &v.vault_id, id, "config", json!(c.to_string()))?;
        }
        Ok(())
    })?;
    require(s, id)
}

pub fn delete(s: &mut Session, id: &str) -> Result<()> {
    let v = require(s, id)?;
    s.write(|w| {
        let now = w.now();
        w.set(Entity::TagView, &v.vault_id, id, "deleted_at", json!(now))
    })?;
    Ok(())
}

/// A tag's live notes, and its live blocks that still exist in a live note,
/// each with its values for the tag's live fields.
pub fn rows(s: &Session, tag_id: &str) -> Result<Vec<TagRow>> {
    let mut st = s.conn().prepare(
        "SELECT 'note', n.id, n.id, n.title, NULL, n.updated_at
         FROM note_tags nt JOIN notes n ON n.id = nt.note_id
         WHERE nt.tag_id = ?1 AND nt.removed_at IS NULL AND n.deleted_at IS NULL AND n.purged_at IS NULL
         UNION ALL
         SELECT 'block', b.id, n.id, n.title, b.text, n.updated_at
         FROM block_tags bt JOIN idx.blocks b ON b.id = bt.block_id AND b.note_id = bt.note_id
         JOIN notes n ON n.id = bt.note_id
         WHERE bt.tag_id = ?1 AND bt.removed_at IS NULL AND n.deleted_at IS NULL AND n.purged_at IS NULL
         ORDER BY 6 DESC, 2",
    )?;
    let mut out: Vec<TagRow> = st
        .query_map([tag_id], |r| {
            Ok(TagRow {
                kind: r.get(0)?,
                target_id: r.get(1)?,
                note_id: r.get(2)?,
                title: r.get(3)?,
                text: r.get(4)?,
                updated_at: r.get(5)?,
                values: BTreeMap::new(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut st = s.conn().prepare(
        "SELECT v.target_id, v.field_id, v.value FROM field_values v JOIN tag_fields f ON f.id = v.field_id
         WHERE f.tag_id = ?1 AND f.deleted_at IS NULL AND v.removed_at IS NULL",
    )?;
    let mut by_target: BTreeMap<String, BTreeMap<String, Value>> = BTreeMap::new();
    for row in st.query_map([tag_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)))? {
        let (target, field, value) = row?;
        by_target.entry(target).or_default().insert(field, parse_value(value.as_deref()));
    }
    for row in &mut out {
        if let Some(values) = by_target.remove(&row.target_id) {
            row.values = values;
        }
    }
    Ok(out)
}

fn insert(s: &mut Session, tag_id: &str, id: &str) -> Result<()> {
    let tag = require_live(s, tag_id)?;
    s.write(|w| {
        let now = w.now();
        w.create(Entity::TagView, &tag.vault_id, json!({
            "id": id, "tag_id": tag.id, "vault_id": tag.vault_id, "kind": "table", "config": "{}", "created_at": now,
        }))
    })?;
    Ok(())
}

fn require(s: &Session, id: &str) -> Result<TagView> {
    get(s, id)?.ok_or_else(|| Error::NotFound(format!("view {id}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{NewField, NewNote, NewTag, SetValue};
    use crate::services::{annotations, fields, notes, tags};
    use crate::session::test_session;

    fn tag(s: &mut Session) -> String {
        tags::create(s, NewTag { vault_id: "v1".into(), name: "task".into(), color: None }).unwrap().id
    }

    #[test]
    fn a_tag_page_has_one_view_that_remembers_its_settings() {
        let (_d, mut s) = test_session();
        let t = tag(&mut s);
        let page_view = page(&mut s, &t).unwrap();
        assert_eq!(page_view.id, format!("{t}-page"));
        assert_eq!(page(&mut s, &t).unwrap().id, page_view.id, "opened twice, created once");

        let config = json!({ "filters": [], "sort": { "fieldId": "__title", "dir": "asc" } });
        let saved = update(&mut s, &page_view.id, ViewChanges { kind: Some("board".into()), config: Some(config.clone()) }).unwrap();
        assert_eq!((saved.kind.as_str(), saved.config), ("board", config));
        assert!(matches!(update(&mut s, &page_view.id, ViewChanges { kind: Some("calendar".into()), ..Default::default() }), Err(Error::Invalid(_))));
        assert!(matches!(update(&mut s, &page_view.id, ViewChanges { config: Some(json!([1])), ..Default::default() }), Err(Error::Invalid(_))));
    }

    #[test]
    fn embeds_get_their_own_views() {
        let (_d, mut s) = test_session();
        let t = tag(&mut s);
        let a = create(&mut s, &t).unwrap();
        let b = create(&mut s, &t).unwrap();
        assert_ne!(a.id, b.id);
        delete(&mut s, &a.id).unwrap();
        assert_eq!(get(&s, &a.id).unwrap(), None);
        assert!(get(&s, &b.id).unwrap().is_some());
    }

    #[test]
    fn rows_are_tagged_live_notes_and_blocks_that_still_exist() {
        let (_d, mut s) = test_session();
        let t = tag(&mut s);
        let body = json!({ "type": "doc", "content": [
            { "type": "paragraph", "attrs": { "blockId": "b1" }, "content": [{ "type": "text", "text": "Buy milk" }] }
        ]});
        let n1 = notes::create(&mut s, NewNote { vault_id: "v1".into(), title: Some("Groceries".into()), body: Some(body), ..Default::default() }).unwrap().meta.id;
        let n2 = notes::create(&mut s, NewNote { vault_id: "v1".into(), title: Some("Trip".into()), ..Default::default() }).unwrap().meta.id;
        tags::attach(&mut s, &n2, &t).unwrap();
        annotations::attach_tag(&mut s, "b1", &n1, &t).unwrap();
        annotations::attach_tag(&mut s, "gone", &n1, &t).unwrap();
        let f = fields::create(&mut s, NewField { tag_id: t.clone(), name: "Done".into(), kind: "checkbox".into(), options: vec![] }).unwrap();
        fields::set_value(&mut s, SetValue { field_id: f.id.clone(), target_id: "b1".into(), target_kind: "block".into(), note_id: n1.clone(), value: json!(true) }).unwrap();

        let r = rows(&s, &t).unwrap();
        assert_eq!(r.len(), 2, "the block that is not in the body is left out: {r:?}");
        let block = r.iter().find(|x| x.kind == "block").unwrap();
        assert_eq!((block.target_id.as_str(), block.title.as_str(), block.text.as_deref()), ("b1", "Groceries", Some("Buy milk")));
        assert_eq!(block.values[&f.id], json!(true));
        let note = r.iter().find(|x| x.kind == "note").unwrap();
        assert_eq!((note.target_id.as_str(), note.title.as_str()), (n2.as_str(), "Trip"));

        notes::delete(&mut s, &n2).unwrap();
        assert_eq!(rows(&s, &t).unwrap().len(), 1, "trashed notes leave the table");
    }
}
