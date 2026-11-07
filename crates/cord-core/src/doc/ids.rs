//! Block ids for content that reaches the editor through Yjs.
//!
//! Shuttle's UniqueID only mints ids on local edits, so a document created or
//! imported here must already carry them, or its blocks can never be tagged,
//! linked or transcluded.

use serde_json::Value;

/// Copy of `BLOCK_TYPES` in Shuttle (src/extensions/blockTypes.ts).
pub const BLOCK_TYPES: [&str; 15] = [
    "paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock",
    "blockMath", "horizontalRule", "image", "youtube", "twitch", "table", "details", "blockRef",
];

/// Gives every block-type node without a `blockId` a new one, the way
/// Shuttle's UniqueID would (nanoid, 10 characters). Returns how many it minted.
pub fn mint_block_ids(node: &mut Value) -> usize {
    let mut minted = 0;
    let Some(obj) = node.as_object_mut() else { return 0 };
    let is_block = obj.get("type").and_then(Value::as_str).is_some_and(|t| BLOCK_TYPES.contains(&t));
    if is_block {
        let attrs = obj.entry("attrs").or_insert_with(|| Value::Object(Default::default()));
        if let Some(attrs) = attrs.as_object_mut() {
            let has_id = attrs.get("blockId").and_then(Value::as_str).is_some_and(|s| !s.is_empty());
            if !has_id {
                attrs.insert("blockId".into(), Value::String(nanoid::nanoid!(10)));
                minted += 1;
            }
        }
    }
    if let Some(Value::Array(children)) = obj.get_mut("content") {
        for child in children {
            minted += mint_block_ids(child);
        }
    }
    minted
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fills_missing_ids_and_keeps_existing_ones() {
        let mut doc = json!({ "type": "doc", "content": [
            { "type": "paragraph" },
            { "type": "heading", "attrs": { "level": 2, "blockId": "keep" } },
            { "type": "bulletList", "attrs": { "blockId": "" }, "content": [
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "x" }] }] }
            ] }
        ] });
        assert_eq!(mint_block_ids(&mut doc), 3);
        let c = &doc["content"];
        assert_eq!(c[0]["attrs"]["blockId"].as_str().unwrap().len(), 10);
        assert_eq!(c[1]["attrs"]["blockId"], "keep");
        assert_eq!(c[1]["attrs"]["level"], 2);
        assert!(c[2]["attrs"]["blockId"].as_str().is_some_and(|s| !s.is_empty()));
        assert!(c[2]["content"][0]["attrs"].is_null(), "listItem is not a block type");
        assert!(c[2]["content"][0]["content"][0]["attrs"]["blockId"].is_string(), "nested paragraphs get ids too");
        assert!(c[2]["content"][0]["content"][0]["content"][0]["attrs"].is_null(), "text nodes are left alone");
        assert_eq!(mint_block_ids(&mut doc), 0, "running it again changes nothing");
    }
}
