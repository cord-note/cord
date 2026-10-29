//! Port of `shuttle-editor/doc`: pure reads over a stored document.

use serde_json::Value;

/// One top-level node and the block id it carries.
#[derive(Debug, Clone, PartialEq)]
pub struct TopLevelBlock<'a> {
    pub index: usize,
    pub kind: &'a str,
    pub block_id: Option<&'a str>,
    pub node: &'a Value,
}

/// Plain text of a node and its descendants, whitespace collapsed.
pub fn node_text(node: &Value) -> String {
    if !node.is_object() {
        return String::new();
    }
    let mut out = String::new();
    collect(node, &mut out);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The document's top-level nodes, with the block id each one carries.
pub fn top_level_blocks(doc: &Value) -> Vec<TopLevelBlock<'_>> {
    if !doc.is_object() {
        return Vec::new();
    }
    children(doc)
        .enumerate()
        .map(|(index, node)| TopLevelBlock {
            index,
            kind: node.get("type").and_then(Value::as_str).unwrap_or("paragraph"),
            block_id: attr(node, "blockId").and_then(Value::as_str).filter(|s| !s.is_empty()),
            node,
        })
        .collect()
}

/// Note ids targeted by `[[wiki links]]` anywhere in the document, first seen first.
pub fn wiki_link_targets(doc: &Value) -> Vec<String> {
    unique_attr(doc, "mention", "id")
}

/// Link ids of fragment link nodes anywhere in the document, first seen first.
pub fn fragment_link_ids(doc: &Value) -> Vec<String> {
    unique_attr(doc, "fragmentLink", "linkId")
}

/// The top-level node carrying `block_id`, or None.
pub fn find_top_level_block<'a>(doc: &'a Value, block_id: &str) -> Option<&'a Value> {
    if block_id.is_empty() {
        return None;
    }
    top_level_blocks(doc).into_iter().find(|b| b.block_id == Some(block_id)).map(|b| b.node)
}

const INLINE_ATOMS: [&str; 4] = ["mention", "inlineMath", "fragmentLink", "hardBreak"];

fn kind(n: &Value) -> &str {
    n.get("type").and_then(Value::as_str).unwrap_or("")
}

fn children(n: &Value) -> impl Iterator<Item = &Value> {
    n.get("content").and_then(Value::as_array).into_iter().flatten().filter(|k| k.is_object())
}

fn attr<'a>(n: &'a Value, key: &str) -> Option<&'a Value> {
    n.get("attrs")?.get(key)
}

fn attr_str<'a>(n: &'a Value, key: &str) -> &'a str {
    attr(n, key).and_then(Value::as_str).unwrap_or("")
}

fn is_inline(n: &Value) -> bool {
    n.get("text").is_some_and(Value::is_string) || INLINE_ATOMS.contains(&kind(n))
}

fn atom_text(n: &Value) -> &str {
    match kind(n) {
        "mention" => match attr_str(n, "displayText") {
            "" => attr_str(n, "label"),
            shown => shown,
        },
        "inlineMath" | "blockMath" => attr_str(n, "latex"),
        "image" => attr_str(n, "alt"),
        "fragmentLink" => attr_str(n, "label"),
        "hardBreak" => " ",
        _ => "",
    }
}

fn collect(n: &Value, out: &mut String) {
    if let Some(t) = n.get("text").and_then(Value::as_str) {
        out.push_str(t);
        return;
    }
    out.push_str(atom_text(n));
    let inline = children(n).all(is_inline);
    for k in children(n) {
        if !inline {
            out.push(' ');
        }
        collect(k, out);
    }
}

fn unique_attr(doc: &Value, node_type: &str, key: &str) -> Vec<String> {
    let mut seen = Vec::new();
    if doc.is_object() {
        walk(doc, &mut |n| {
            if kind(n) == node_type {
                if let Some(v) = attr(n, key).and_then(Value::as_str).filter(|s| !s.is_empty()) {
                    if !seen.iter().any(|s: &String| s == v) {
                        seen.push(v.to_owned());
                    }
                }
            }
        });
    }
    seen
}

fn walk(n: &Value, visit: &mut impl FnMut(&Value)) {
    visit(n);
    for k in children(n) {
        walk(k, visit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn text(t: &str) -> Value {
        json!({ "type": "text", "text": t })
    }

    #[test]
    fn inline_children_join_without_spaces() {
        let p = json!({ "type": "paragraph", "content": [text("foo"), text("bar")] });
        assert_eq!(node_text(&p), "foobar");
    }

    #[test]
    fn block_children_are_separated_and_whitespace_collapses() {
        let list = json!({ "type": "bulletList", "content": [
            { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("  one ")] }] },
            { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("two\n\tthree")] }] }
        ]});
        assert_eq!(node_text(&list), "one two three");
    }

    #[test]
    fn atoms_contribute_their_text() {
        let p = json!({ "type": "paragraph", "content": [
            text("see "),
            { "type": "mention", "attrs": { "id": "n2", "label": "Label", "displayText": "Shown" } },
            { "type": "mention", "attrs": { "id": "n3", "label": "Only label" } },
            { "type": "hardBreak" },
            { "type": "inlineMath", "attrs": { "latex": "x^2" } },
            { "type": "fragmentLink", "attrs": { "linkId": "l1", "label": "frag" } }
        ]});
        assert_eq!(node_text(&p), "see ShownOnly label x^2frag");
        assert_eq!(node_text(&json!({ "type": "image", "attrs": { "alt": "a cat" } })), "a cat");
        assert_eq!(node_text(&json!({ "type": "blockMath", "attrs": { "latex": "E=mc^2" } })), "E=mc^2");
    }

    #[test]
    fn non_objects_have_no_text() {
        assert_eq!(node_text(&json!("str")), "");
        assert_eq!(node_text(&json!(null)), "");
    }

    #[test]
    fn top_level_blocks_report_ids_and_default_type() {
        let doc = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "blockId": "b1", "level": 1 } },
            { "attrs": { "blockId": "" } },
            "not a node",
            { "type": "bulletList" }
        ]});
        let blocks = top_level_blocks(&doc);
        let summary: Vec<(usize, &str, Option<&str>)> =
            blocks.iter().map(|b| (b.index, b.kind, b.block_id)).collect();
        assert_eq!(summary, [(0, "heading", Some("b1")), (1, "paragraph", None), (2, "bulletList", None)]);
    }

    #[test]
    fn link_targets_are_unique_in_first_seen_order() {
        let doc = json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [
                { "type": "mention", "attrs": { "id": "b" } },
                { "type": "mention", "attrs": { "id": "a" } },
                { "type": "mention", "attrs": { "id": "b" } },
                { "type": "mention", "attrs": { "id": "" } }
            ]},
            { "type": "blockquote", "content": [{ "type": "paragraph", "content": [
                { "type": "mention", "attrs": { "id": "c" } },
                { "type": "fragmentLink", "attrs": { "linkId": "l1" } }
            ]}]}
        ]});
        assert_eq!(wiki_link_targets(&doc), ["b", "a", "c"]);
        assert_eq!(fragment_link_ids(&doc), ["l1"]);
    }

    #[test]
    fn finds_a_top_level_block_by_id() {
        let doc = json!({ "type": "doc", "content": [
            { "type": "paragraph", "attrs": { "blockId": "x" }, "content": [text("first")] },
            { "type": "paragraph", "attrs": { "blockId": "y" }, "content": [text("second")] }
        ]});
        assert_eq!(find_top_level_block(&doc, "y").map(node_text), Some("second".into()));
        assert_eq!(find_top_level_block(&doc, "z"), None);
        assert_eq!(find_top_level_block(&doc, ""), None);
    }
}
