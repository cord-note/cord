use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use super::notes::{list_item, LIST_COLUMNS};
use crate::doc::helpers::find_top_level_block;
use crate::model::{Block, BlockRefTarget, NoteLink, NoteLinks, NoteListItem, UnlinkedMention};
use crate::session::Session;
use crate::Result;

const TRIGRAM_MIN_CHARS: usize = 3;
const MENTION_CONTEXT_CHARS: usize = 40;

/// Title or body match among live notes, pinned first, then most recent.
pub fn search(s: &Session, vault_id: &str, q: &str) -> Result<Vec<NoteListItem>> {
    let like = like_pattern(q);
    // Both branches bind the same three parameters; `?3 IS NOT NULL` only uses ?3.
    let body = if q.chars().count() >= TRIGRAM_MIN_CHARS {
        "SELECT b.note_id FROM idx.blocks_fts f JOIN idx.blocks b ON b.rowid = f.rowid
         WHERE f.text MATCH ?3 AND b.vault_id = ?1"
    } else {
        "SELECT b.note_id FROM idx.blocks b WHERE b.vault_id = ?1 AND b.text LIKE ?2 ESCAPE '\\' AND ?3 IS NOT NULL"
    };
    let sql = format!(
        "SELECT {LIST_COLUMNS} FROM notes n
         WHERE n.vault_id = ?1 AND n.deleted_at IS NULL AND n.purged_at IS NULL
           AND (n.title LIKE ?2 ESCAPE '\\' OR n.id IN ({body}))
         ORDER BY n.is_pinned DESC, n.updated_at DESC"
    );
    let mut st = s.conn().prepare(&sql)?;
    let rows = st.query_map(params![vault_id, like, fts_phrase(q)], list_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Wiki links from and to a note, live notes in its vault only.
pub fn links(s: &Session, note_id: &str) -> Result<NoteLinks> {
    let live = "x.deleted_at IS NULL AND x.purged_at IS NULL AND x.vault_id = (SELECT vault_id FROM notes WHERE id = ?1)";
    let read = |sql: String| -> Result<Vec<NoteLink>> {
        let mut st = s.conn().prepare(&sql)?;
        let rows = st.query_map([note_id], |r| {
            let (from, to): (String, String) = (r.get(0)?, r.get(1)?);
            Ok(NoteLink { id: format!("{from}:{to}"), from_note_id: from, to_note_id: to })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    };
    Ok(NoteLinks {
        outbound: read(format!(
            "SELECT l.from_note_id, l.to_note_id FROM idx.note_links l JOIN notes x ON x.id = l.to_note_id
             WHERE l.from_note_id = ?1 AND {live} ORDER BY l.to_note_id"
        ))?,
        backlinks: read(format!(
            "SELECT l.from_note_id, l.to_note_id FROM idx.note_links l JOIN notes x ON x.id = l.from_note_id
             WHERE l.to_note_id = ?1 AND {live} ORDER BY l.from_note_id"
        ))?,
    })
}

/// Live notes whose text names this note's title, one hit per note.
pub fn unlinked_mentions(s: &Session, note_id: &str) -> Result<Vec<UnlinkedMention>> {
    let target: Option<(String, String)> = s
        .conn()
        .query_row("SELECT title, vault_id FROM notes WHERE id = ?1", [note_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let Some((title, vault_id)) = target.filter(|(t, _)| !t.is_empty()) else {
        return Ok(Vec::new());
    };
    let mut st = s.conn().prepare(
        "SELECT b.note_id, b.id, b.text, n.title FROM idx.blocks b JOIN notes n ON n.id = b.note_id
         WHERE b.vault_id = ?1 AND n.deleted_at IS NULL AND n.purged_at IS NULL
           AND b.note_id != ?2 AND b.text LIKE ?3 ESCAPE '\\'
         ORDER BY b.note_id, b.sort",
    )?;
    let rows = st.query_map(params![vault_id, note_id, like_pattern(&title)], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
    })?;
    let needle: Vec<char> = title.chars().collect();
    let mut out: Vec<UnlinkedMention> = Vec::new();
    for row in rows {
        let (note, block, text, note_title) = row?;
        if out.last().is_some_and(|m| m.note_id == note) {
            continue;
        }
        let hay: Vec<char> = text.chars().collect();
        let Some(at) = find_ci(&hay, &needle) else { continue };
        let start = at.saturating_sub(MENTION_CONTEXT_CHARS);
        let end = (at + needle.len() + MENTION_CONTEXT_CHARS).min(hay.len());
        out.push(UnlinkedMention { note_id: note, note_title, block_id: block, excerpt: hay[start..end].iter().collect() });
    }
    Ok(out)
}

pub fn blocks_for_note(s: &Session, note_id: &str) -> Result<Vec<Block>> {
    let mut st = s.conn().prepare(
        "SELECT id, note_id, vault_id, type, sort, level, text, ref_block_id FROM idx.blocks WHERE note_id = ?1 ORDER BY sort",
    )?;
    let rows = st.query_map([note_id], |r| {
        Ok(Block {
            id: r.get(0)?,
            note_id: r.get(1)?,
            vault_id: r.get(2)?,
            kind: r.get(3)?,
            sort: r.get(4)?,
            level: r.get(5)?,
            text: r.get(6)?,
            ref_block_id: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A transclusion's source. Synthetic ids and notes in the trash resolve to nothing.
pub fn resolve_ref(s: &Session, block_id: &str) -> Result<Option<BlockRefTarget>> {
    if block_id.contains(':') {
        return Ok(None); // synthetic ids move with their position
    }
    let row: Option<(String, String, String, String)> = s
        .conn()
        .query_row(
            "SELECT b.note_id, b.type, n.title, d.body_json FROM idx.blocks b
             JOIN notes n ON n.id = b.note_id JOIN idx.note_docs d ON d.note_id = b.note_id
             WHERE b.id = ?1 AND n.deleted_at IS NULL AND n.purged_at IS NULL",
            [block_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((note_id, kind, note_title, body)) = row else { return Ok(None) };
    let doc: Value = serde_json::from_str(&body).map_err(|e| crate::Error::BadDoc(e.to_string()))?;
    Ok(find_top_level_block(&doc, block_id).map(|node| BlockRefTarget {
        block_id: block_id.to_owned(),
        note_id,
        note_title,
        kind,
        content_json: node.to_string(),
    }))
}

fn like_pattern(query: &str) -> String {
    let mut out = String::with_capacity(query.len() + 2);
    out.push('%');
    for ch in query.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('%');
    out
}

fn fts_phrase(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}

/// Char index of `needle` in `hay`, ignoring case.
fn find_ci(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    let eq = |a: char, b: char| a.to_lowercase().eq(b.to_lowercase());
    (0..=hay.len() - needle.len()).find(|&i| needle.iter().zip(&hay[i..]).all(|(n, h)| eq(*n, *h)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NewNote;
    use crate::services::notes;
    use crate::session::test_session;
    use serde_json::json;

    fn note(s: &mut Session, title: &str, content: Value) -> String {
        let body = json!({ "type": "doc", "content": content });
        notes::create(s, NewNote { vault_id: "v1".into(), title: Some(title.into()), body: Some(body), ..Default::default() })
            .unwrap()
            .meta
            .id
    }

    fn para(id: &str, text: &str) -> Value {
        json!({ "type": "paragraph", "attrs": { "blockId": id }, "content": [{ "type": "text", "text": text }] })
    }

    fn mention(id: &str) -> Value {
        json!({ "type": "paragraph", "attrs": { "blockId": format!("m-{id}") }, "content": [{ "type": "mention", "attrs": { "id": id, "label": "x" } }] })
    }

    #[test]
    fn searches_titles_and_bodies_with_short_and_long_queries() {
        let (_d, mut s) = test_session();
        note(&mut s, "Groceries", json!([para("a", "milk and eggs")]));
        note(&mut s, "Ideas", json!([para("b", "a 100% new idea")]));
        let titles = |q: &str| search(&s, "v1", q).unwrap().into_iter().map(|n| n.title).collect::<Vec<_>>();
        assert_eq!(titles("eggs"), ["Groceries"]);
        assert_eq!(titles("gro"), ["Groceries"]);
        assert_eq!(titles("mi"), ["Groceries"]);
        assert_eq!(titles("0%"), ["Ideas"]);
        assert!(titles("nothing").is_empty());
    }

    #[test]
    fn search_skips_deleted_notes() {
        let (_d, mut s) = test_session();
        let id = note(&mut s, "Hidden", json!([para("a", "findme")]));
        notes::delete(&mut s, &id).unwrap();
        assert!(search(&s, "v1", "findme").unwrap().is_empty());
    }

    #[test]
    fn links_only_point_at_live_notes() {
        let (_d, mut s) = test_session();
        let target = note(&mut s, "Target", json!([para("t", "x")]));
        let source = note(&mut s, "Source", json!([mention(&target), mention("missing")]));
        let l = links(&s, &source).unwrap();
        assert_eq!(l.outbound.iter().map(|x| x.to_note_id.as_str()).collect::<Vec<_>>(), [target.as_str()]);
        assert_eq!(links(&s, &target).unwrap().backlinks.len(), 1);
        notes::delete(&mut s, &target).unwrap();
        assert!(links(&s, &source).unwrap().outbound.is_empty());
    }

    #[test]
    fn finds_unlinked_mentions_with_an_excerpt() {
        let (_d, mut s) = test_session();
        let target = note(&mut s, "Rust", json!([para("t", "self")]));
        note(&mut s, "Other", json!([para("o1", "I like rust a lot"), para("o2", "more RUST")]));
        let hits = unlinked_mentions(&s, &target).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].block_id.as_str(), hits[0].excerpt.as_str()), ("o1", "I like rust a lot"));
    }

    #[test]
    fn lists_blocks_and_resolves_refs() {
        let (_d, mut s) = test_session();
        let id = note(&mut s, "Src", json!([para("real", "quoted"), { "type": "bulletList" }]));
        let blocks = blocks_for_note(&s, &id).unwrap();
        let synthetic = format!("{id}:1");
        assert_eq!(blocks.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(), ["real", synthetic.as_str()]);

        let target = resolve_ref(&s, "real").unwrap().unwrap();
        assert_eq!((target.note_title.as_str(), target.kind.as_str()), ("Src", "paragraph"));
        assert!(target.content_json.contains("quoted"));
        assert!(resolve_ref(&s, &format!("{id}:1")).unwrap().is_none());
        notes::delete(&mut s, &id).unwrap();
        assert!(resolve_ref(&s, "real").unwrap().is_none());
    }
}
