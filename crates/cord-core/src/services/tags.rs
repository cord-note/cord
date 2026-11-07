use rusqlite::{params, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::entity::{entity_id, Entity};
use crate::model::{NewTag, NoteTagRow, Tag, TagChanges};
use crate::session::{Session, Writer};
use crate::{Error, Result};

/// Copy of `DISTINCT_VAULT_COLORS` (shared/constants/vaultColors.ts).
pub const TAG_COLORS: [&str; 10] = [
    "#4f8ef7", "#4db6ac", "#57a95b", "#bfcc4e", "#ffb74d",
    "#f2603a", "#f06292", "#ba68c8", "#a1887f", "#90a4ae",
];

const COLUMNS: &str = "t.id, t.vault_id, t.name, t.color, t.created_at";

fn tag(r: &Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag { id: r.get(0)?, vault_id: r.get(1)?, name: r.get(2)?, color: r.get(3)?, created_at: r.get(4)? })
}

pub fn list(s: &Session, vault_id: &str) -> Result<Vec<Tag>> {
    let sql = format!("SELECT {COLUMNS} FROM tags t WHERE t.vault_id = ?1 AND t.deleted_at IS NULL ORDER BY t.created_at, t.id");
    let mut st = s.conn().prepare(&sql)?;
    let rows = st.query_map([vault_id], tag)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The live tag with this name (any case), a restored deleted one, or a new one.
pub fn create(s: &mut Session, input: NewTag) -> Result<Tag> {
    let name = clean(&input.name)?;
    let vault = input.vault_id;
    let existing: Option<(String, Option<i64>)> = s
        .conn()
        .query_row(
            "SELECT id, deleted_at FROM tags WHERE vault_id = ?1 AND lower(name) = lower(?2)
             ORDER BY deleted_at IS NOT NULL, id LIMIT 1",
            params![vault, name],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let id = match existing {
        Some((id, None)) => return require_live(s, &id),
        Some((id, Some(_))) => {
            s.write(|w| {
                w.set(Entity::Tag, &vault, &id, "deleted_at", Value::Null)?;
                if let Some(c) = &input.color {
                    w.set(Entity::Tag, &vault, &id, "color", json!(c))?;
                }
                Ok(())
            })?;
            id
        }
        None => {
            let color = match input.color {
                Some(c) => c,
                None => least_used_color(s, &vault)?,
            };
            let id = nanoid::nanoid!();
            s.write(|w| {
                let now = w.now();
                w.create(Entity::Tag, &vault, json!({ "id": id, "vault_id": vault, "name": name, "color": color, "created_at": now }))
            })?;
            id
        }
    };
    require_live(s, &id)
}

pub fn update(s: &mut Session, id: &str, input: TagChanges) -> Result<Tag> {
    let current = require_live(s, id)?;
    let name = input.name.as_deref().map(clean).transpose()?;
    if let Some(n) = &name {
        let clash: Option<String> = s
            .conn()
            .query_row(
                "SELECT id FROM tags WHERE vault_id = ?1 AND lower(name) = lower(?2) AND deleted_at IS NULL AND id != ?3",
                params![current.vault_id, n, id],
                |r| r.get(0),
            )
            .optional()?;
        if clash.is_some() {
            return Err(Error::Invalid(format!("A tag named \"{n}\" already exists")));
        }
    }
    let vault = current.vault_id;
    s.write(|w| {
        if let Some(n) = name {
            w.set(Entity::Tag, &vault, id, "name", json!(n))?;
        }
        if let Some(c) = input.color {
            w.set(Entity::Tag, &vault, id, "color", json!(c))?;
        }
        Ok(())
    })?;
    require_live(s, id)
}

pub fn delete(s: &mut Session, id: &str) -> Result<()> {
    let t = require_live(s, id)?;
    s.write(|w| {
        let now = w.now();
        w.set(Entity::Tag, &t.vault_id, id, "deleted_at", json!(now))
    })?;
    Ok(())
}

pub fn attach(s: &mut Session, note_id: &str, tag_id: &str) -> Result<()> {
    let t = require_live(s, tag_id)?;
    s.write(|w| attach_note_in(w, &t.vault_id, note_id, tag_id))
}

pub fn detach(s: &mut Session, note_id: &str, tag_id: &str) -> Result<()> {
    let vault: Option<String> = s
        .conn()
        .query_row("SELECT vault_id FROM tags WHERE id = ?1", [tag_id], |r| r.get(0))
        .optional()?;
    let Some(vault) = vault else { return Ok(()) };
    s.write(|w| detach_note_in(w, &vault, note_id, tag_id))
}

pub fn for_note(s: &Session, note_id: &str) -> Result<Vec<Tag>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = ?1 AND nt.removed_at IS NULL AND t.deleted_at IS NULL ORDER BY t.name"
    );
    let mut st = s.conn().prepare(&sql)?;
    let rows = st.query_map([note_id], tag)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn note_map(s: &Session, vault_id: &str) -> Result<Vec<NoteTagRow>> {
    let mut st = s.conn().prepare(
        "SELECT nt.note_id, nt.tag_id FROM note_tags nt
         JOIN notes n ON n.id = nt.note_id JOIN tags t ON t.id = nt.tag_id
         WHERE n.vault_id = ?1 AND n.purged_at IS NULL AND nt.removed_at IS NULL AND t.deleted_at IS NULL
         ORDER BY nt.note_id, nt.tag_id",
    )?;
    let rows = st.query_map([vault_id], |r| Ok(NoteTagRow { note_id: r.get(0)?, tag_id: r.get(1)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Fold live tags that share a name (any case) into the one with the lowest
/// id. Deterministic, so devices doing it at once agree. Returns tags folded.
pub fn merge_duplicates(s: &mut Session, vault_id: &str) -> Result<usize> {
    let rows: Vec<(String, String)> = {
        let mut st = s.conn().prepare(
            "SELECT lower(name), id FROM tags WHERE vault_id = ?1 AND deleted_at IS NULL ORDER BY lower(name), id",
        )?;
        let rows = st.query_map([vault_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut folds: Vec<(String, String)> = Vec::new(); // (duplicate, keeper)
    let mut keeper: Option<(String, String)> = None; // (name, id)
    for (name, id) in rows {
        match &keeper {
            Some((k_name, k_id)) if *k_name == name => folds.push((id, k_id.clone())),
            _ => keeper = Some((name, id)),
        }
    }
    if folds.is_empty() {
        return Ok(0);
    }
    s.write(|w| {
        for (dup, keep) in &folds {
            let notes = column(w, "SELECT note_id FROM note_tags WHERE tag_id = ?1 AND removed_at IS NULL ORDER BY note_id", dup)?;
            for note in notes {
                attach_note_in(w, vault_id, &note, keep)?;
                detach_note_in(w, vault_id, &note, dup)?;
            }
            let blocks: Vec<(String, String)> = {
                let mut st = w.conn().prepare(
                    "SELECT block_id, note_id FROM block_tags WHERE tag_id = ?1 AND removed_at IS NULL ORDER BY block_id",
                )?;
                let rows = st.query_map([dup], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect::<rusqlite::Result<_>>()?
            };
            for (block, note) in blocks {
                attach_block_in(w, vault_id, &block, &note, keep)?;
                detach_block_in(w, vault_id, &block, dup)?;
            }
            let now = w.now();
            w.set(Entity::Tag, vault_id, dup, "deleted_at", json!(now))?;
        }
        Ok(())
    })?;
    Ok(folds.len())
}

pub(crate) fn attach_note_in(w: &mut Writer<'_>, vault_id: &str, note_id: &str, tag_id: &str) -> Result<()> {
    let removed: Option<Option<i64>> = w
        .conn()
        .query_row("SELECT removed_at FROM note_tags WHERE note_id = ?1 AND tag_id = ?2", [note_id, tag_id], |r| r.get(0))
        .optional()?;
    match removed {
        None => {
            let now = w.now();
            w.create(Entity::NoteTag, vault_id, json!({ "note_id": note_id, "tag_id": tag_id, "vault_id": vault_id, "created_at": now }))?;
        }
        Some(Some(_)) => {
            w.set(Entity::NoteTag, vault_id, &entity_id(&[note_id, tag_id]), "removed_at", Value::Null)?;
        }
        Some(None) => {}
    }
    Ok(())
}

pub(crate) fn detach_note_in(w: &mut Writer<'_>, vault_id: &str, note_id: &str, tag_id: &str) -> Result<()> {
    let removed: Option<Option<i64>> = w
        .conn()
        .query_row("SELECT removed_at FROM note_tags WHERE note_id = ?1 AND tag_id = ?2", [note_id, tag_id], |r| r.get(0))
        .optional()?;
    if let Some(None) = removed {
        let now = w.now();
        w.set(Entity::NoteTag, vault_id, &entity_id(&[note_id, tag_id]), "removed_at", json!(now))?;
    }
    Ok(())
}

pub(crate) fn attach_block_in(w: &mut Writer<'_>, vault_id: &str, block_id: &str, note_id: &str, tag_id: &str) -> Result<()> {
    let removed: Option<Option<i64>> = w
        .conn()
        .query_row("SELECT removed_at FROM block_tags WHERE block_id = ?1 AND tag_id = ?2", [block_id, tag_id], |r| r.get(0))
        .optional()?;
    match removed {
        None => {
            let now = w.now();
            w.create(Entity::BlockTag, vault_id, json!({
                "block_id": block_id, "tag_id": tag_id, "note_id": note_id, "vault_id": vault_id, "created_at": now,
            }))?;
        }
        Some(Some(_)) => {
            w.set(Entity::BlockTag, vault_id, &entity_id(&[block_id, tag_id]), "removed_at", Value::Null)?;
        }
        Some(None) => {}
    }
    Ok(())
}

pub(crate) fn detach_block_in(w: &mut Writer<'_>, vault_id: &str, block_id: &str, tag_id: &str) -> Result<()> {
    let removed: Option<Option<i64>> = w
        .conn()
        .query_row("SELECT removed_at FROM block_tags WHERE block_id = ?1 AND tag_id = ?2", [block_id, tag_id], |r| r.get(0))
        .optional()?;
    if let Some(None) = removed {
        let now = w.now();
        w.set(Entity::BlockTag, vault_id, &entity_id(&[block_id, tag_id]), "removed_at", json!(now))?;
    }
    Ok(())
}

fn column(w: &Writer<'_>, sql: &str, arg: &str) -> Result<Vec<String>> {
    let mut st = w.conn().prepare(sql)?;
    let rows = st.query_map([arg], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The palette colour fewest live tags use; ties go to palette order.
fn least_used_color(s: &Session, vault_id: &str) -> Result<String> {
    let mut counts = [0usize; TAG_COLORS.len()];
    let mut st = s.conn().prepare("SELECT color FROM tags WHERE vault_id = ?1 AND deleted_at IS NULL")?;
    for color in st.query_map([vault_id], |r| r.get::<_, Option<String>>(0))? {
        if let Some(i) = color?.and_then(|c| TAG_COLORS.iter().position(|p| *p == c)) {
            counts[i] += 1;
        }
    }
    let best = (0..TAG_COLORS.len()).min_by_key(|&i| (counts[i], i)).unwrap_or(0);
    Ok(TAG_COLORS[best].to_owned())
}

pub(crate) fn require_live(s: &Session, id: &str) -> Result<Tag> {
    let sql = format!("SELECT {COLUMNS} FROM tags t WHERE t.id = ?1 AND t.deleted_at IS NULL");
    s.conn().query_row(&sql, [id], tag).optional()?.ok_or_else(|| Error::NotFound(format!("tag {id}")))
}

fn clean(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::Invalid("Tag name cannot be empty".into()));
    }
    Ok(trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NewNote;
    use crate::services::notes;
    use crate::session::test_session;

    fn new(s: &mut Session, name: &str) -> Tag {
        create(s, NewTag { vault_id: "v1".into(), name: name.into(), color: None }).unwrap()
    }

    fn note(s: &mut Session) -> String {
        notes::create(s, NewNote { vault_id: "v1".into(), ..Default::default() }).unwrap().meta.id
    }

    #[test]
    fn create_reuses_live_names_and_restores_deleted_ones() {
        let (_d, mut s) = test_session();
        let a = new(&mut s, " Work ");
        assert_eq!(a.name, "Work");
        assert_eq!(new(&mut s, "work").id, a.id);
        delete(&mut s, &a.id).unwrap();
        assert!(list(&s, "v1").unwrap().is_empty());
        assert_eq!(new(&mut s, "Work").id, a.id, "restored, not recreated");
        assert!(matches!(create(&mut s, NewTag { vault_id: "v1".into(), name: "  ".into(), color: None }), Err(Error::Invalid(_))));
    }

    #[test]
    fn new_tags_take_the_least_used_colour() {
        let (_d, mut s) = test_session();
        assert_eq!(new(&mut s, "a").color.as_deref(), Some(TAG_COLORS[0]));
        assert_eq!(new(&mut s, "b").color.as_deref(), Some(TAG_COLORS[1]));
    }

    #[test]
    fn rename_refuses_a_live_clash_and_colour_can_be_cleared() {
        let (_d, mut s) = test_session();
        let a = new(&mut s, "a");
        new(&mut s, "b");
        assert!(matches!(update(&mut s, &a.id, TagChanges { name: Some("B".into()), ..Default::default() }), Err(Error::Invalid(_))));
        let u = update(&mut s, &a.id, TagChanges { name: Some("c".into()), color: Some(None) }).unwrap();
        assert_eq!((u.name.as_str(), u.color), ("c", None));
    }

    #[test]
    fn attach_and_detach_are_soft_and_repeatable() {
        let (_d, mut s) = test_session();
        let n = note(&mut s);
        let t = new(&mut s, "t");
        attach(&mut s, &n, &t.id).unwrap();
        attach(&mut s, &n, &t.id).unwrap();
        assert_eq!(for_note(&s, &n).unwrap().len(), 1);
        detach(&mut s, &n, &t.id).unwrap();
        assert!(for_note(&s, &n).unwrap().is_empty());
        attach(&mut s, &n, &t.id).unwrap();
        assert_eq!(note_map(&s, "v1").unwrap(), [NoteTagRow { note_id: n, tag_id: t.id }]);
        let rows: i64 = s.conn().query_row("SELECT count(*) FROM note_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1, "one row, flipped, never deleted");
    }

    #[test]
    fn duplicates_from_sync_merge_into_the_lowest_id() {
        let (_d, mut s) = test_session();
        let n = note(&mut s);
        // Two devices made "Work" offline; simulate the second arriving.
        for (id, name) in [("tB", "Work"), ("tA", "work")] {
            s.write(|w| w.create(Entity::Tag, "v1", json!({ "id": id, "vault_id": "v1", "name": name, "created_at": 1 }))).unwrap();
        }
        s.write(|w| {
            attach_note_in(w, "v1", &n, "tB")?;
            attach_block_in(w, "v1", "blk", &n, "tB")
        })
        .unwrap();
        assert_eq!(merge_duplicates(&mut s, "v1").unwrap(), 1);
        assert_eq!(list(&s, "v1").unwrap().iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["tA"]);
        assert_eq!(for_note(&s, &n).unwrap()[0].id, "tA");
        let block_tag: String = s.conn().query_row("SELECT tag_id FROM block_tags WHERE removed_at IS NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(block_tag, "tA");
        assert_eq!(merge_duplicates(&mut s, "v1").unwrap(), 0);
    }
}
