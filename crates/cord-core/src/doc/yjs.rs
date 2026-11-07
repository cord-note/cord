//! Shuttle JSON <-> Yjs state, laid out the way `@tiptap/y-tiptap` does it.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Map, Value};
use yrs::types::text::YChange;
use yrs::types::Attrs;
use yrs::updates::decoder::Decode;
use yrs::{
    Any, Doc, Out, ReadTxn, StateVector, Text, Transact, TransactionMut, Update, Xml,
    XmlElementPrelim, XmlElementRef, XmlFragment, XmlOut, XmlTextPrelim, XmlTextRef,
};

use crate::{Error, Result};

/// The XML fragment Tiptap's Collaboration extension binds to.
pub const FRAGMENT: &str = "default";

/// Encode a document as a full Yjs state.
pub fn json_to_state(doc: &Value) -> Result<Vec<u8>> {
    let ydoc = Doc::new();
    let frag = ydoc.get_or_insert_xml_fragment(FRAGMENT);
    {
        let mut txn = ydoc.transact_mut();
        write_children(&mut txn, &frag, &kids(doc))?;
    }
    let txn = ydoc.transact();
    Ok(txn.encode_state_as_update_v1(&StateVector::default()))
}

/// Decode a Yjs state into canonical document JSON.
pub fn state_to_json(state: &[u8]) -> Result<Value> {
    let ydoc = Doc::new();
    let frag = ydoc.get_or_insert_xml_fragment(FRAGMENT);
    apply(&ydoc, state)?;
    let txn = ydoc.transact();
    Ok(json!({ "type": "doc", "content": read_children(&txn, &frag)? }))
}

/// Apply an update to a state and return the merged state. Order-independent.
pub fn merge_update(state: &[u8], update: &[u8]) -> Result<Vec<u8>> {
    let ydoc = Doc::new();
    apply(&ydoc, state)?;
    apply(&ydoc, update)?;
    let txn = ydoc.transact();
    Ok(txn.encode_state_as_update_v1(&StateVector::default()))
}

fn bad(msg: impl ToString) -> Error {
    Error::BadDoc(msg.to_string())
}

fn apply(ydoc: &Doc, bytes: &[u8]) -> Result<()> {
    let update = Update::decode_v1(bytes).map_err(bad)?;
    ydoc.transact_mut().apply_update(update).map_err(bad)
}

fn kids(v: &Value) -> Vec<&Value> {
    v.get("content")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter(|n| n.is_object()).collect())
        .unwrap_or_default()
}

fn is_text(n: &Value) -> bool {
    n.get("text").is_some_and(Value::is_string)
}

fn to_any(v: &Value) -> Result<Any> {
    serde_json::from_value(v.clone()).map_err(bad)
}

fn from_any(a: &Any) -> Result<Value> {
    serde_json::to_value(a).map_err(bad)
}

/// Runs of text become one XmlText; every other node becomes an element.
fn write_children<F: XmlFragment>(txn: &mut TransactionMut, parent: &F, nodes: &[&Value]) -> Result<()> {
    let mut i = 0;
    while i < nodes.len() {
        if is_text(nodes[i]) {
            let xt: XmlTextRef = parent.push_back(txn, XmlTextPrelim::new(""));
            while i < nodes.len() && is_text(nodes[i]) {
                let text = nodes[i]["text"].as_str().unwrap_or_default();
                let len = xt.len(txn);
                xt.insert_with_attributes(txn, len, text, marks_to_attrs(nodes[i])?);
                i += 1;
            }
        } else {
            write_element(txn, parent, nodes[i])?;
            i += 1;
        }
    }
    Ok(())
}

fn write_element<F: XmlFragment>(txn: &mut TransactionMut, parent: &F, node: &Value) -> Result<()> {
    let tag = node.get("type").and_then(Value::as_str).ok_or_else(|| bad("node without a type"))?;
    let el: XmlElementRef = parent.push_back(txn, XmlElementPrelim::empty(tag));
    if let Some(attrs) = node.get("attrs").and_then(Value::as_object) {
        for (k, v) in attrs {
            if !v.is_null() {
                el.insert_attribute(txn, k.as_str(), to_any(v)?);
            }
        }
    }
    write_children(txn, &el, &kids(node))
}

/// `{markName: markAttrs}`, `{}` for a mark without attrs, as y-tiptap writes.
fn marks_to_attrs(n: &Value) -> Result<Attrs> {
    let mut attrs: Attrs = HashMap::new();
    for m in n.get("marks").and_then(Value::as_array).into_iter().flatten() {
        let ty = m.get("type").and_then(Value::as_str).ok_or_else(|| bad("mark without a type"))?;
        let a = m.get("attrs").cloned().unwrap_or_else(|| json!({}));
        attrs.insert(Arc::from(ty), to_any(&a)?);
    }
    Ok(attrs)
}

fn read_children<T: ReadTxn, F: XmlFragment>(txn: &T, parent: &F) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for child in parent.children(txn) {
        match child {
            XmlOut::Element(el) => out.push(read_element(txn, &el)?),
            XmlOut::Text(xt) => out.extend(read_text(txn, &xt)?),
            XmlOut::Fragment(_) => return Err(bad("nested fragment")),
        }
    }
    Ok(out)
}

fn read_element<T: ReadTxn>(txn: &T, el: &XmlElementRef) -> Result<Value> {
    let mut node = Map::new();
    node.insert("type".into(), Value::String(el.tag().to_string()));
    let mut attrs = Map::new();
    for (k, v) in el.attributes(txn) {
        match v {
            Out::Any(a) => {
                attrs.insert(k.to_string(), from_any(&a)?);
            }
            _ => return Err(bad("attribute is not a plain value")),
        }
    }
    if !attrs.is_empty() {
        node.insert("attrs".into(), Value::Object(attrs));
    }
    let content = read_children(txn, el)?;
    if !content.is_empty() {
        node.insert("content".into(), Value::Array(content));
    }
    Ok(Value::Object(node))
}

fn read_text<T: ReadTxn>(txn: &T, xt: &XmlTextRef) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for d in xt.diff(txn, YChange::identity) {
        let Out::Any(Any::String(text)) = d.insert else {
            return Err(bad("embed inside text"));
        };
        let mut node = Map::new();
        node.insert("type".into(), json!("text"));
        node.insert("text".into(), Value::String(text.to_string()));
        let mut marks: Vec<(String, Value)> = Vec::new();
        for (k, v) in d.attributes.iter().flat_map(|a| a.iter()) {
            marks.push((mark_name(k).to_owned(), from_any(v)?));
        }
        marks.sort_by(|a, b| a.0.cmp(&b.0));
        if !marks.is_empty() {
            let marks = marks.into_iter().map(|(t, a)| json!({ "type": t, "attrs": a })).collect();
            node.insert("marks".into(), Value::Array(marks));
        }
        out.push(Value::Object(node));
    }
    Ok(out)
}

/// y-tiptap stores overlapping marks of one type as `name--XXXXXXXX`.
fn mark_name(attr: &str) -> &str {
    if attr.len() > 10 {
        let (head, tail) = attr.split_at(attr.len() - 10);
        let hashed = tail.starts_with("--")
            && tail[2..].bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'/' | b'='));
        if hashed {
            return head;
        }
    }
    attr
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_into_the_canonical_shape() {
        let input = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "level": 2, "blockId": "b1", "textAlign": null },
              "content": [{ "type": "text", "text": "Hi" }] },
            { "type": "paragraph", "attrs": { "blockId": "b2" }, "content": [
                { "type": "text", "text": "bold", "marks": [{ "type": "bold" }] },
                { "type": "text", "text": " plain " },
                { "type": "text", "text": "link", "marks": [
                    { "type": "link", "attrs": { "href": "https://x" } }, { "type": "italic" } ] },
                { "type": "mention", "attrs": { "id": "n2", "label": "Other" } },
                { "type": "text", "text": " end" }
            ]},
            { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph" }] }] }
        ]});
        let expected = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "level": 2, "blockId": "b1" },
              "content": [{ "type": "text", "text": "Hi" }] },
            { "type": "paragraph", "attrs": { "blockId": "b2" }, "content": [
                { "type": "text", "text": "bold", "marks": [{ "type": "bold", "attrs": {} }] },
                { "type": "text", "text": " plain " },
                { "type": "text", "text": "link", "marks": [
                    { "type": "italic", "attrs": {} }, { "type": "link", "attrs": { "href": "https://x" } } ] },
                { "type": "mention", "attrs": { "id": "n2", "label": "Other" } },
                { "type": "text", "text": " end" }
            ]},
            { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph" }] }] }
        ]});
        assert_eq!(state_to_json(&json_to_state(&input).unwrap()).unwrap(), expected);
    }

    #[test]
    fn adjacent_text_with_the_same_marks_merges() {
        let input = json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [
            { "type": "text", "text": "a", "marks": [{ "type": "bold" }] },
            { "type": "text", "text": "b", "marks": [{ "type": "bold" }] }
        ]}]});
        let out = state_to_json(&json_to_state(&input).unwrap()).unwrap();
        assert_eq!(out["content"][0]["content"], json!([
            { "type": "text", "text": "ab", "marks": [{ "type": "bold", "attrs": {} }] }
        ]));
    }

    #[test]
    fn array_and_number_attrs_survive() {
        let input = json!({ "type": "doc", "content": [{ "type": "table", "content": [{ "type": "tableRow", "content": [
            { "type": "tableCell", "attrs": { "colspan": 1, "rowspan": 1, "colwidth": [120, 80] },
              "content": [{ "type": "paragraph" }] }
        ]}]}]});
        let out = state_to_json(&json_to_state(&input).unwrap()).unwrap();
        assert_eq!(out["content"][0]["content"][0]["content"][0]["attrs"], json!({ "colspan": 1, "rowspan": 1, "colwidth": [120, 80] }));
    }

    #[test]
    fn concurrent_edits_merge_the_same_in_either_order() {
        let base = json_to_state(&json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [{ "type": "text", "text": "hello" }] }
        ]})).unwrap();
        let a = edit(&base, 101, 0, ">");
        let b = edit(&base, 102, 5, "!");
        let ab = merge_update(&merge_update(&base, &a).unwrap(), &b).unwrap();
        let ba = merge_update(&merge_update(&base, &b).unwrap(), &a).unwrap();
        let text = |s: &[u8]| state_to_json(s).unwrap()["content"][0]["content"][0]["text"].clone();
        assert_eq!(text(&ab), json!(">hello!"));
        assert_eq!(text(&ab), text(&ba));
    }

    #[test]
    fn hashed_mark_names_read_back_plain() {
        assert_eq!(mark_name("comment--Ab3+/=9z"), "comment");
        assert_eq!(mark_name("bold"), "bold");
        assert_eq!(mark_name("a--short"), "a--short");
    }

    #[test]
    fn garbage_is_a_bad_doc_not_a_panic() {
        assert!(matches!(state_to_json(&[1, 2, 3]), Err(Error::BadDoc(_))));
        assert!(matches!(json_to_state(&json!({ "type": "doc", "content": [{ "attrs": {} }] })), Err(Error::BadDoc(_))));
    }

    use std::path::PathBuf;

    fn fixtures() -> Vec<(String, PathBuf)> {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/docs");
        let mut names: Vec<(String, PathBuf)> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| {
                let name = e.unwrap().file_name().into_string().unwrap();
                name.strip_suffix(".input.json").map(|n| (n.to_owned(), dir.clone()))
            })
            .collect();
        names.sort();
        names
    }

    fn read_json(path: PathBuf) -> Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    /// Regenerates `.ybin` and `.expected.json`. Run on purpose only:
    /// `cargo test write_fixtures -- --ignored`, then review the diff.
    #[test]
    #[ignore]
    fn write_fixtures() {
        for (name, dir) in fixtures() {
            let state = json_to_state(&read_json(dir.join(format!("{name}.input.json")))).unwrap();
            std::fs::write(dir.join(format!("{name}.ybin")), &state).unwrap();
            let pretty = serde_json::to_string_pretty(&state_to_json(&state).unwrap()).unwrap();
            std::fs::write(dir.join(format!("{name}.expected.json")), pretty + "\n").unwrap();
        }
    }

    #[test]
    fn fixtures_decode_to_their_expected_json() {
        let all = fixtures();
        assert_eq!(all.len(), 5);
        for (name, dir) in all {
            let expected = read_json(dir.join(format!("{name}.expected.json")));
            let stored = std::fs::read(dir.join(format!("{name}.ybin"))).unwrap();
            assert_eq!(state_to_json(&stored).unwrap(), expected, "{name}.ybin");
            let fresh = json_to_state(&read_json(dir.join(format!("{name}.input.json")))).unwrap();
            assert_eq!(state_to_json(&fresh).unwrap(), expected, "{name}.input.json");
        }
    }

    /// Insert `s` at `at` in the first paragraph, as another client would.
    fn edit(base: &[u8], client: u64, at: u32, s: &str) -> Vec<u8> {
        let d = Doc::with_client_id(client);
        let frag = d.get_or_insert_xml_fragment(FRAGMENT);
        d.transact_mut().apply_update(Update::decode_v1(base).unwrap()).unwrap();
        let before = d.transact().state_vector();
        {
            let mut t = d.transact_mut();
            let p = frag.get(&t, 0).unwrap().into_xml_element().unwrap();
            let xt = p.get(&t, 0).unwrap().into_xml_text().unwrap();
            xt.insert(&mut t, at, s);
        }
        let t = d.transact();
        t.encode_state_as_update_v1(&before)
    }
}
