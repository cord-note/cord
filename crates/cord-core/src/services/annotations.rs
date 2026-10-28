use std::collections::BTreeMap;

use rusqlite::{OptionalExtension, Row};
use serde_json::json;

use super::tags::{attach_block_in, detach_block_in, require_live};
use crate::entity::Entity;
use crate::model::{BlockAnnotation, BlockLink, NewBlockLink, Tag};
use crate::session::Session;
use crate::{Error, Result};

const LINK_COLUMNS: &str = "id, vault_id, from_block_id, from_note_id, to_note_id, to_block_id, created_at";

fn link(r: &Row<'_>) -> rusqlite::Result<BlockLink> {
    Ok(BlockLink {
        id: r.get(0)?,
        vault_id: r.get(1)?,
        from_block_id: r.get(2)?,
        from_note_id: r.get(3)?,
        to_note_id: r.get(4)?,
        to_block_id: r.get(5)?,
        created_at: r.get(6)?,
    })
}

/// Tags, outgoing links and backlinks of every block in a note that has any.
pub fn for_note(s: &Session, note_id: &str) -> Result<BTreeMap<String, BlockAnnotation>> {
    let mut out: BTreeMap<String, BlockAnnotation> = BTreeMap::new();

    let mut st = s.conn().prepare(
        "SELECT bt.block_id, t.id, t.vault_id, t.name, t.color, t.created_at
         FROM block_tags bt JOIN tags t ON t.id = bt.tag_id
         WHERE bt.note_id = ?1 AND bt.removed_at IS NULL AND t.deleted_at IS NULL ORDER BY t.name",
    )?;
    for row in st.query_map([note_id], |r| {
        Ok((r.get::<_, String>(0)?, Tag { id: r.get(1)?, vault_id: r.get(2)?, name: r.get(3)?, color: r.get(4)?, created_at: r.get(5)? }))
    })? {
        let (block, tag) = row?;
        out.entry(block).or_default().tags.push(tag);
    }

    let sql = format!("SELECT {LINK_COLUMNS} FROM block_links WHERE from_note_id = ?1 AND deleted_at IS NULL ORDER BY created_at, id");
    let mut st = s.conn().prepare(&sql)?;
    for l in st.query_map([note_id], link)? {
        let l = l?;
        out.entry(l.from_block_id.clone()).or_default().links.push(l);
    }

    let sql = format!(
        "SELECT {LINK_COLUMNS} FROM block_links
         WHERE deleted_at IS NULL AND to_block_id IN (SELECT id FROM idx.blocks WHERE note_id = ?1)
         ORDER BY created_at, id"
    );
    let mut st = s.conn().prepare(&sql)?;
    for l in st.query_map([note_id], link)? {
        let l = l?;
        if let Some(to) = l.to_block_id.clone() {
            out.entry(to).or_default().backlinks.push(l);
        }
    }
    Ok(out)
}

pub fn attach_tag(s: &mut Session, block_id: &str, note_id: &str, tag_id: &str) -> Result<()> {
    let t = require_live(s, tag_id)?;
    s.write(|w| attach_block_in(w, &t.vault_id, block_id, note_id, tag_id))
}

pub fn detach_tag(s: &mut Session, block_id: &str, tag_id: &str) -> Result<()> {
    let vault: Option<String> = s
        .conn()
        .query_row("SELECT vault_id FROM block_tags WHERE block_id = ?1 AND tag_id = ?2", [block_id, tag_id], |r| r.get(0))
        .optional()?;
    let Some(vault) = vault else { return Ok(()) };
    s.write(|w| detach_block_in(w, &vault, block_id, tag_id))
}

pub fn create_link(s: &mut Session, input: NewBlockLink) -> Result<BlockLink> {
    if input.to_note_id.is_none() && input.to_block_id.is_none() {
        return Err(Error::Invalid("a block link needs a target note or block".into()));
    }
    let id = nanoid::nanoid!();
    s.write(|w| {
        let now = w.now();
        w.create(Entity::BlockLink, &input.vault_id, json!({
            "id": id, "vault_id": input.vault_id, "from_block_id": input.from_block_id, "from_note_id": input.from_note_id,
            "to_note_id": input.to_note_id, "to_block_id": input.to_block_id, "created_at": now,
        }))
    })?;
    let sql = format!("SELECT {LINK_COLUMNS} FROM block_links WHERE id = ?1");
    s.conn().query_row(&sql, [&id], link).optional()?.ok_or_else(|| Error::NotFound(format!("block link {id}")))
}

pub fn delete_link(s: &mut Session, id: &str) -> Result<()> {
    let vault: Option<String> = s
        .conn()
        .query_row("SELECT vault_id FROM block_links WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?;
    let Some(vault) = vault else { return Ok(()) };
    s.write(|w| {
        let now = w.now();
        w.set(Entity::BlockLink, &vault, id, "deleted_at", json!(now))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{NewNote, NewTag};
    use crate::services::{notes, tags};
    use crate::session::test_session;

    fn note(s: &mut Session, block: &str) -> String {
        let body = json!({ "type": "doc", "content": [{ "type": "paragraph", "attrs": { "blockId": block } }] });
        notes::create(s, NewNote { vault_id: "v1".into(), body: Some(body), ..Default::default() }).unwrap().meta.id
    }

    #[test]
    fn tags_and_links_show_on_their_blocks() {
        let (_d, mut s) = test_session();
        let a = note(&mut s, "ba");
        let b = note(&mut s, "bb");
        let t = tags::create(&mut s, NewTag { vault_id: "v1".into(), name: "t".into(), color: None }).unwrap();
        attach_tag(&mut s, "ba", &a, &t.id).unwrap();
        let l = create_link(&mut s, NewBlockLink {
            vault_id: "v1".into(), from_block_id: "ba".into(), from_note_id: a.clone(),
            to_note_id: None, to_block_id: Some("bb".into()),
        })
        .unwrap();

        let on_a = for_note(&s, &a).unwrap();
        assert_eq!(on_a["ba"].tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["t"]);
        assert_eq!(on_a["ba"].links, [l.clone()]);
        assert_eq!(for_note(&s, &b).unwrap()["bb"].backlinks, [l.clone()]);

        detach_tag(&mut s, "ba", &t.id).unwrap();
        delete_link(&mut s, &l.id).unwrap();
        assert!(for_note(&s, &a).unwrap().is_empty());
        assert!(for_note(&s, &b).unwrap().is_empty());
    }

    #[test]
    fn a_link_needs_a_target() {
        let (_d, mut s) = test_session();
        let a = note(&mut s, "ba");
        let bad = NewBlockLink { vault_id: "v1".into(), from_block_id: "ba".into(), from_note_id: a, ..Default::default() };
        assert!(matches!(create_link(&mut s, bad), Err(Error::Invalid(_))));
    }
}
