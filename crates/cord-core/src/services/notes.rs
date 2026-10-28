use rusqlite::{OptionalExtension, Row};
use serde_json::{json, Value};

use crate::doc::yjs::json_to_state;
use crate::entity::Entity;
use crate::model::{NewNote, Note, NoteChanges, NoteListItem};
use crate::session::Session;
use crate::{Error, Result};

/// What an empty note holds, for both kinds.
pub const EMPTY_DOC_JSON: &str = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;

const KINDS: [&str; 2] = ["note", "notepad"];

/// List-item columns of `notes n`, in the order `list_item` reads them.
pub(crate) const LIST_COLUMNS: &str =
    "n.id, n.vault_id, n.title, n.kind, n.is_pinned, n.created_at, n.updated_at, n.deleted_at";

pub(crate) fn list_item(r: &Row<'_>) -> rusqlite::Result<NoteListItem> {
    Ok(NoteListItem {
        id: r.get(0)?,
        vault_id: r.get(1)?,
        title: r.get(2)?,
        kind: r.get(3)?,
        is_pinned: r.get::<_, i64>(4)? != 0,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
        deleted_at: r.get(7)?,
    })
}

/// Live notes in a vault, least recently updated first (as the sidecar).
pub fn list(s: &Session, vault_id: &str) -> Result<Vec<NoteListItem>> {
    query(s, "n.deleted_at IS NULL ORDER BY n.updated_at, n.id", vault_id)
}

/// The vault's trash: deleted, not yet purged.
pub fn list_deleted(s: &Session, vault_id: &str) -> Result<Vec<NoteListItem>> {
    query(s, "n.deleted_at IS NOT NULL ORDER BY n.deleted_at, n.id", vault_id)
}

fn query(s: &Session, filter: &str, vault_id: &str) -> Result<Vec<NoteListItem>> {
    let sql = format!("SELECT {LIST_COLUMNS} FROM notes n WHERE n.vault_id = ?1 AND n.purged_at IS NULL AND {filter}");
    let mut st = s.conn().prepare(&sql)?;
    let rows = st.query_map([vault_id], list_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A note with its body as JSON. Purged notes do not exist.
pub fn get(s: &Session, id: &str) -> Result<Option<Note>> {
    let sql = format!(
        "SELECT {LIST_COLUMNS}, d.body_json FROM notes n LEFT JOIN idx.note_docs d ON d.note_id = n.id
         WHERE n.id = ?1 AND n.purged_at IS NULL"
    );
    Ok(s.conn()
        .query_row(&sql, [id], |r| {
            Ok(Note { meta: list_item(r)?, body_json: r.get::<_, Option<String>>(8)?.unwrap_or_else(|| EMPTY_DOC_JSON.to_owned()) })
        })
        .optional()?)
}

/// The note's Yjs state, for the editor to load.
pub fn body_state(s: &Session, id: &str) -> Result<Option<Vec<u8>>> {
    Ok(s.conn()
        .query_row("SELECT yjs_state FROM note_bodies WHERE note_id = ?1", [id], |r| r.get(0))
        .optional()?)
}

pub fn create(s: &mut Session, input: NewNote) -> Result<Note> {
    let kind = input.kind.unwrap_or_else(|| "note".into());
    if !KINDS.contains(&kind.as_str()) {
        return Err(Error::Invalid(format!("unknown note kind: {kind}")));
    }
    let body = match input.body {
        Some(doc) => doc,
        None => serde_json::from_str(EMPTY_DOC_JSON).map_err(|e| Error::BadDoc(e.to_string()))?,
    };
    let state = json_to_state(&body)?;
    let id = nanoid::nanoid!();
    let vault = input.vault_id;
    let title = input.title.unwrap_or_default();
    s.write(|w| {
        let now = w.now();
        w.create(Entity::Note, &vault, json!({
            "id": id, "vault_id": vault, "title": title, "kind": kind,
            "is_pinned": false, "created_at": now, "updated_at": now,
        }))?;
        w.body(&vault, &id, &state)
    })?;
    require(s, &id)
}

pub fn update(s: &mut Session, id: &str, input: NoteChanges) -> Result<Note> {
    let (vault, _) = state(s, id)?;
    s.write(|w| {
        if let Some(t) = input.title {
            w.set(Entity::Note, &vault, id, "title", Value::String(t))?;
        }
        if let Some(p) = input.is_pinned {
            w.set(Entity::Note, &vault, id, "is_pinned", Value::Bool(p))?;
        }
        Ok(())
    })?;
    require(s, id)
}

pub fn apply_body_update(s: &mut Session, id: &str, update: &[u8]) -> Result<()> {
    let (vault, _) = state(s, id)?;
    s.write(|w| w.body(&vault, id, update))?;
    Ok(())
}

/// Switch kinds. The body and its block ids are untouched.
pub fn convert(s: &mut Session, id: &str, kind: &str) -> Result<Note> {
    if !KINDS.contains(&kind) {
        return Err(Error::Invalid(format!("unknown note kind: {kind}")));
    }
    let (vault, _) = state(s, id)?;
    s.write(|w| w.set(Entity::Note, &vault, id, "kind", json!(kind)))?;
    require(s, id)
}

pub fn delete(s: &mut Session, id: &str) -> Result<()> {
    let (vault, _) = state(s, id)?;
    s.write(|w| {
        let now = w.now();
        w.set(Entity::Note, &vault, id, "deleted_at", json!(now))
    })?;
    Ok(())
}

pub fn restore(s: &mut Session, id: &str) -> Result<Note> {
    let (vault, _) = state(s, id)?;
    s.write(|w| w.set(Entity::Note, &vault, id, "deleted_at", Value::Null))?;
    require(s, id)
}

/// Empty the note out of the trash, everywhere. Only from the trash.
pub fn purge(s: &mut Session, id: &str) -> Result<()> {
    let (vault, deleted) = state(s, id)?;
    if deleted.is_none() {
        return Err(Error::Invalid(format!("note {id} must be in the trash before it is purged")));
    }
    s.write(|w| {
        let now = w.now();
        w.set(Entity::Note, &vault, id, "purged_at", json!(now))
    })?;
    Ok(())
}

/// The live (non-purged) note's vault and deleted_at.
fn state(s: &Session, id: &str) -> Result<(String, Option<i64>)> {
    s.conn()
        .query_row("SELECT vault_id, deleted_at FROM notes WHERE id = ?1 AND purged_at IS NULL", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("note {id}")))
}

fn require(s: &Session, id: &str) -> Result<Note> {
    get(s, id)?.ok_or_else(|| Error::NotFound(format!("note {id}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::yjs::state_to_json;
    use crate::session::test_session;

    fn new(s: &mut Session, title: &str) -> Note {
        create(s, NewNote { vault_id: "v1".into(), title: Some(title.into()), ..Default::default() }).unwrap()
    }

    fn para(text: &str) -> Value {
        json!({ "type": "doc", "content": [{ "type": "paragraph", "attrs": { "blockId": "b1" }, "content": [{ "type": "text", "text": text }] }] })
    }

    #[test]
    fn creates_an_empty_note_by_default() {
        let (_d, mut s) = test_session();
        let n = new(&mut s, "First");
        assert_eq!((n.meta.title.as_str(), n.meta.kind.as_str(), n.meta.is_pinned), ("First", "note", false));
        assert_eq!(serde_json::from_str::<Value>(&n.body_json).unwrap(), serde_json::from_str::<Value>(EMPTY_DOC_JSON).unwrap());
        assert_eq!(list(&s, "v1").unwrap().len(), 1);
    }

    #[test]
    fn creates_from_json_and_takes_yjs_updates() {
        let (_d, mut s) = test_session();
        let n = create(&mut s, NewNote { vault_id: "v1".into(), body: Some(para("hello")), ..Default::default() }).unwrap();
        assert!(n.body_json.contains("hello"));
        apply_body_update(&mut s, &n.meta.id, &json_to_state(&para("world")).unwrap()).unwrap();
        let state = body_state(&s, &n.meta.id).unwrap().unwrap();
        let text = state_to_json(&state).unwrap().to_string();
        assert!(text.contains("hello") && text.contains("world"), "both inserts survive: {text}");
    }

    #[test]
    fn rejects_bad_kinds() {
        let (_d, mut s) = test_session();
        let bad = NewNote { vault_id: "v1".into(), kind: Some("folder".into()), ..Default::default() };
        assert!(matches!(create(&mut s, bad), Err(Error::Invalid(_))));
        let n = new(&mut s, "x");
        assert!(matches!(convert(&mut s, &n.meta.id, "folder"), Err(Error::Invalid(_))));
        assert_eq!(convert(&mut s, &n.meta.id, "notepad").unwrap().meta.kind, "notepad");
    }

    #[test]
    fn updates_title_and_pin() {
        let (_d, mut s) = test_session();
        let n = new(&mut s, "x");
        let u = update(&mut s, &n.meta.id, NoteChanges { title: Some("y".into()), is_pinned: Some(true) }).unwrap();
        assert_eq!((u.meta.title.as_str(), u.meta.is_pinned), ("y", true));
        assert!(u.meta.updated_at >= n.meta.updated_at);
    }

    #[test]
    fn delete_restore_and_purge() {
        let (_d, mut s) = test_session();
        let n = new(&mut s, "gone");
        let id = n.meta.id.clone();
        assert!(matches!(purge(&mut s, &id), Err(Error::Invalid(_))), "only from the trash");

        delete(&mut s, &id).unwrap();
        assert!(list(&s, "v1").unwrap().is_empty());
        assert_eq!(list_deleted(&s, "v1").unwrap().len(), 1);
        restore(&mut s, &id).unwrap();
        assert_eq!(list(&s, "v1").unwrap().len(), 1);

        delete(&mut s, &id).unwrap();
        purge(&mut s, &id).unwrap();
        assert!(get(&s, &id).unwrap().is_none());
        assert!(list_deleted(&s, "v1").unwrap().is_empty());
        assert!(matches!(restore(&mut s, &id), Err(Error::NotFound(_))));
        assert!(body_state(&s, &id).unwrap().is_none());
    }
}
