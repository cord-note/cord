//! One indexable row per top-level node.

use std::collections::HashSet;

use serde_json::Value;

use super::helpers::{node_text, top_level_blocks};

#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedBlock {
    /// The node's blockId, or `${noteId}:${sort}` when it has none or repeats one.
    pub id: String,
    /// Synthetic ids move with their position and are not valid blockRef targets.
    pub synthetic: bool,
    pub kind: String,
    pub sort: i64,
    pub level: Option<i64>,
    pub text: String,
    pub ref_block_id: Option<String>,
}

pub fn extract_blocks(doc: &Value, note_id: &str) -> Vec<ExtractedBlock> {
    let mut seen = HashSet::new();
    top_level_blocks(doc)
        .into_iter()
        .map(|b| {
            let real = b.block_id.filter(|id| seen.insert(*id));
            let attrs = b.node.get("attrs");
            let level = (b.kind == "heading").then(|| {
                attrs.and_then(|a| a.get("level")).and_then(Value::as_i64).unwrap_or(1)
            });
            let ref_block_id = (b.kind == "blockRef")
                .then(|| attrs.and_then(|a| a.get("refBlockId")).and_then(Value::as_str))
                .flatten()
                .map(str::to_owned);
            ExtractedBlock {
                id: real.map_or_else(|| format!("{note_id}:{}", b.index), str::to_owned),
                synthetic: real.is_none(),
                kind: b.kind.to_owned(),
                sort: b.index as i64,
                level,
                text: node_text(b.node),
                ref_block_id,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_one_row_per_top_level_node() {
        let doc = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "blockId": "h", "level": 3 }, "content": [{ "type": "text", "text": "Title" }] },
            { "type": "paragraph", "attrs": { "blockId": "p" }, "content": [{ "type": "text", "text": "Body" }] },
            { "type": "blockRef", "attrs": { "blockId": "r", "refBlockId": "other", "refNoteId": "n9" } }
        ]});
        let rows = extract_blocks(&doc, "n1");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], ExtractedBlock {
            id: "h".into(), synthetic: false, kind: "heading".into(), sort: 0,
            level: Some(3), text: "Title".into(), ref_block_id: None,
        });
        assert_eq!(rows[1].level, None);
        assert_eq!(rows[2].ref_block_id.as_deref(), Some("other"));
    }

    #[test]
    fn nodes_without_ids_get_synthetic_ids() {
        let doc = json!({ "type": "doc", "content": [
            { "type": "paragraph", "attrs": { "blockId": "p" } },
            { "type": "bulletList" }
        ]});
        let rows = extract_blocks(&doc, "n1");
        assert_eq!((rows[1].id.as_str(), rows[1].synthetic), ("n1:1", true));
    }

    #[test]
    fn repeated_ids_keep_the_first_and_make_later_ones_synthetic() {
        let doc = json!({ "type": "doc", "content": [
            { "type": "paragraph", "attrs": { "blockId": "dup" } },
            { "type": "paragraph", "attrs": { "blockId": "dup" } }
        ]});
        let rows = extract_blocks(&doc, "n1");
        assert_eq!((rows[0].id.as_str(), rows[0].synthetic), ("dup", false));
        assert_eq!((rows[1].id.as_str(), rows[1].synthetic), ("n1:1", true));
    }

    #[test]
    fn heading_level_defaults_to_one() {
        let doc = json!({ "type": "doc", "content": [{ "type": "heading" }] });
        assert_eq!(extract_blocks(&doc, "n").first().and_then(|b| b.level), Some(1));
    }

    #[test]
    fn an_empty_document_has_no_rows() {
        assert!(extract_blocks(&json!({ "type": "doc", "content": [] }), "n").is_empty());
        assert!(extract_blocks(&json!({}), "n").is_empty());
    }
}
