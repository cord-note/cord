//! Shuttle JSON <-> Markdown, for agents. Markdown is never stored: this is a
//! view for reading, and a way in for writing, which becomes JSON at once.

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde_json::{json, Map, Value};

fn kids(n: &Value) -> &[Value] {
    n.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn attr<'a>(n: &'a Value, key: &str) -> Option<&'a Value> {
    n.get("attrs").and_then(|a| a.get(key))
}

fn kind(n: &Value) -> &str {
    n.get("type").and_then(Value::as_str).unwrap_or("")
}

/// The document as Markdown. Each top-level block ends with ` ^blockId` (on
/// its own line after multi-line blocks), so an agent can name a block.
pub fn to_markdown(doc: &Value) -> String {
    kids(doc)
        .iter()
        .map(|b| {
            let md = block(b);
            match attr(b, "blockId").and_then(Value::as_str) {
                Some(id) if md.contains('\n') || !matches!(kind(b), "paragraph" | "heading") => format!("{md}\n^{id}"),
                Some(id) => format!("{md} ^{id}"),
                None => md,
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn block(n: &Value) -> String {
    match kind(n) {
        "paragraph" => inline(n),
        "heading" => {
            let level = attr(n, "level").and_then(Value::as_u64).unwrap_or(1).clamp(1, 6) as usize;
            format!("{} {}", "#".repeat(level), inline(n))
        }
        "blockquote" => kids(n)
            .iter()
            .map(block)
            .collect::<Vec<_>>()
            .join("\n\n")
            .lines()
            .map(|l| if l.is_empty() { ">".to_owned() } else { format!("> {l}") })
            .collect::<Vec<_>>()
            .join("\n"),
        "codeBlock" => {
            let lang = attr(n, "language").and_then(Value::as_str).unwrap_or("");
            format!("```{lang}\n{}\n```", plain(n))
        }
        "horizontalRule" => "---".into(),
        "bulletList" | "orderedList" | "taskList" => list(n),
        "blockMath" => format!("$$\n{}\n$$", attr(n, "latex").and_then(Value::as_str).unwrap_or("")),
        "table" => table(n),
        "details" => kids(n)
            .iter()
            .map(|c| match kind(c) {
                "detailsSummary" => format!("**{}**", inline(c)),
                _ => kids(c).iter().map(block).collect::<Vec<_>>().join("\n\n"),
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        "image" => "[image]".into(),
        "tagView" => "[tag view]".into(),
        "blockRef" | "youtube" | "twitch" => "[embed]".into(),
        _ => plain(n),
    }
}

fn list(n: &Value) -> String {
    let start = attr(n, "start").and_then(Value::as_u64).unwrap_or(1);
    kids(n)
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let bullet = match kind(n) {
                "orderedList" => format!("{}. ", start + i as u64),
                "taskList" => {
                    if attr(item, "checked").and_then(Value::as_bool).unwrap_or(false) { "- [x] ".into() } else { "- [ ] ".into() }
                }
                _ => "- ".into(),
            };
            let pad = " ".repeat(if kind(n) == "orderedList" { bullet.len() } else { 2 });
            let body = kids(item).iter().map(block).collect::<Vec<_>>().join("\n");
            let mut lines = body.lines();
            let first = lines.next().unwrap_or("");
            let rest: Vec<String> = lines.map(|l| format!("{pad}{l}")).collect();
            std::iter::once(format!("{bullet}{first}")).chain(rest).collect::<Vec<_>>().join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn table(n: &Value) -> String {
    let rows: Vec<Vec<String>> = kids(n)
        .iter()
        .map(|r| kids(r).iter().map(|c| kids(c).iter().map(inline).collect::<Vec<_>>().join(" ").replace('|', "\\|")).collect())
        .collect();
    let Some(first) = rows.first() else { return String::new() };
    let line = |cells: &Vec<String>| format!("| {} |", cells.join(" | "));
    let mut out = vec![line(first), format!("|{}", " --- |".repeat(first.len()))];
    out.extend(rows.iter().skip(1).map(line));
    out.join("\n")
}

/// All text inside, without marks (code blocks, unknown nodes).
fn plain(n: &Value) -> String {
    if let Some(t) = n.get("text").and_then(Value::as_str) {
        return t.to_owned();
    }
    kids(n).iter().map(plain).collect()
}

fn inline(n: &Value) -> String {
    kids(n)
        .iter()
        .map(|c| match kind(c) {
            "text" => {
                let mut s = c.get("text").and_then(Value::as_str).unwrap_or("").to_owned();
                let marks = c.get("marks").and_then(Value::as_array).cloned().unwrap_or_default();
                if marks.iter().any(|m| kind(m) == "code") {
                    return format!("`{s}`");
                }
                for m in &marks {
                    s = match kind(m) {
                        "bold" => format!("**{s}**"),
                        "italic" => format!("*{s}*"),
                        "strike" => format!("~~{s}~~"),
                        "link" => format!("[{s}]({})", attr(m, "href").and_then(Value::as_str).unwrap_or("")),
                        _ => s,
                    };
                }
                s
            }
            "mention" => format!("[[{}]]", attr(c, "label").and_then(Value::as_str).unwrap_or("")),
            "inlineMath" => format!("${}$", attr(c, "latex").and_then(Value::as_str).unwrap_or("")),
            "hardBreak" => "  \n".into(),
            _ => plain(c),
        })
        .collect()
}

/// A node being built: its JSON object and its children so far.
struct Frame {
    node: Map<String, Value>,
    content: Vec<Value>,
    /// Opened for inline content that arrived outside a textblock.
    implicit: bool,
}

impl Frame {
    fn new(kind: &str, attrs: Value) -> Self {
        let mut node = Map::new();
        node.insert("type".into(), Value::String(kind.into()));
        if attrs.as_object().is_some_and(|a| !a.is_empty()) {
            node.insert("attrs".into(), attrs);
        }
        Frame { node, content: Vec::new(), implicit: false }
    }

    fn kind(&self) -> &str {
        self.node.get("type").and_then(Value::as_str).unwrap_or("")
    }

    fn finish(mut self) -> Value {
        if !self.content.is_empty() {
            self.node.insert("content".into(), Value::Array(self.content));
        }
        Value::Object(self.node)
    }
}

const TEXTBLOCKS: [&str; 3] = ["paragraph", "heading", "codeBlock"];

fn close_top(stack: &mut Vec<Frame>) {
    let done = stack.pop().expect("frame");
    stack.last_mut().expect("parent").content.push(done.finish());
}

fn ensure_textblock(stack: &mut Vec<Frame>) {
    if !TEXTBLOCKS.contains(&stack.last().map(Frame::kind).unwrap_or("")) {
        let mut p = Frame::new("paragraph", json!({}));
        p.implicit = true;
        stack.push(p);
    }
}

fn close_implicit(stack: &mut Vec<Frame>) {
    if stack.last().is_some_and(|f| f.implicit) {
        close_top(stack);
    }
}

fn push_inline(stack: &mut Vec<Frame>, node: Value) {
    ensure_textblock(stack);
    stack.last_mut().expect("frame").content.push(node);
}

/// Markdown from an agent as top-level blocks (no ids: the caller mints them).
/// `[[Title]]` becomes a wiki link when `resolve` knows the title; trailing
/// `^blockId` markers copied back from `to_markdown` are dropped.
pub fn from_markdown(md: &str, resolve: &dyn Fn(&str) -> Option<(String, String)>) -> Vec<Value> {
    let opts = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_MATH;
    let mut stack: Vec<Frame> = vec![Frame::new("doc", json!({}))];
    let mut marks: Vec<Value> = Vec::new();
    let mut in_head = false;

    for event in Parser::new_ext(md, opts) {
        match event {
            Event::Start(tag) => {
                let frame = match tag {
                    Tag::Paragraph => Frame::new("paragraph", json!({})),
                    Tag::Heading { level, .. } => Frame::new("heading", json!({ "level": heading_level(level) })),
                    Tag::BlockQuote(_) => Frame::new("blockquote", json!({})),
                    Tag::CodeBlock(k) => {
                        let lang = match k {
                            CodeBlockKind::Fenced(l) => l.to_string(),
                            CodeBlockKind::Indented => String::new(),
                        };
                        Frame::new("codeBlock", if lang.is_empty() { json!({}) } else { json!({ "language": lang }) })
                    }
                    Tag::List(Some(n)) => Frame::new("orderedList", json!({ "start": n })),
                    Tag::List(None) => Frame::new("bulletList", json!({})),
                    Tag::Item => Frame::new("listItem", json!({})),
                    Tag::Table(_) => Frame::new("table", json!({})),
                    Tag::TableHead => {
                        in_head = true;
                        Frame::new("tableRow", json!({}))
                    }
                    Tag::TableRow => Frame::new("tableRow", json!({})),
                    Tag::TableCell => Frame::new(if in_head { "tableHeader" } else { "tableCell" }, json!({})),
                    Tag::Emphasis => {
                        marks.push(json!({ "type": "italic" }));
                        continue;
                    }
                    Tag::Strong => {
                        marks.push(json!({ "type": "bold" }));
                        continue;
                    }
                    Tag::Strikethrough => {
                        marks.push(json!({ "type": "strike" }));
                        continue;
                    }
                    Tag::Link { dest_url, .. } => {
                        marks.push(json!({ "type": "link", "attrs": { "href": dest_url.to_string() } }));
                        continue;
                    }
                    _ => continue,
                };
                close_implicit(&mut stack);
                stack.push(frame);
            }
            Event::End(end) => match end {
                TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link => {
                    marks.pop();
                }
                TagEnd::Paragraph
                | TagEnd::Heading(_)
                | TagEnd::BlockQuote(_)
                | TagEnd::CodeBlock
                | TagEnd::List(_)
                | TagEnd::Item
                | TagEnd::Table
                | TagEnd::TableHead
                | TagEnd::TableRow
                | TagEnd::TableCell => {
                    close_implicit(&mut stack);
                    if end == TagEnd::TableHead {
                        in_head = false;
                    }
                    if stack.len() > 1 {
                        close_top(&mut stack);
                    }
                }
                _ => {}
            },
            Event::TaskListMarker(checked) => {
                close_implicit(&mut stack);
                // In a loose list the marker arrives inside the item's paragraph.
                if let Some(i) = stack.iter().rposition(|f| f.kind() == "listItem") {
                    stack[i].node.insert("type".into(), json!("taskItem"));
                    stack[i].node.insert("attrs".into(), json!({ "checked": checked }));
                    if i >= 1 {
                        stack[i - 1].node.insert("type".into(), json!("taskList"));
                    }
                }
            }
            Event::Text(text) => {
                if stack.last().map(Frame::kind) == Some("codeBlock") {
                    let t = text.strip_suffix('\n').unwrap_or(&text).to_owned();
                    stack.last_mut().expect("frame").content.push(json!({ "type": "text", "text": t }));
                } else {
                    // Wiki links are found later: the parser splits text at brackets.
                    let mut n = json!({ "type": "text", "text": text.to_string() });
                    if !marks.is_empty() {
                        n["marks"] = Value::Array(marks.clone());
                    }
                    push_inline(&mut stack, n);
                }
            }
            Event::Code(code) => {
                let mut m = marks.clone();
                m.push(json!({ "type": "code" }));
                push_inline(&mut stack, json!({ "type": "text", "text": code.to_string(), "marks": m }));
            }
            Event::InlineMath(latex) => {
                push_inline(&mut stack, json!({ "type": "inlineMath", "attrs": { "latex": latex.to_string() } }));
            }
            Event::DisplayMath(latex) => {
                // A display formula is a block of its own.
                if stack.last().map(Frame::kind) == Some("paragraph") {
                    close_top(&mut stack);
                }
                stack
                    .last_mut()
                    .expect("frame")
                    .content
                    .push(json!({ "type": "blockMath", "attrs": { "latex": latex.trim().to_owned() } }));
            }
            Event::SoftBreak => push_inline(&mut stack, json!({ "type": "text", "text": " " })),
            Event::HardBreak => push_inline(&mut stack, json!({ "type": "hardBreak" })),
            Event::Rule => {
                close_implicit(&mut stack);
                stack.last_mut().expect("frame").content.push(json!({ "type": "horizontalRule" }));
            }
            Event::Html(h) | Event::InlineHtml(h) => push_inline(&mut stack, json!({ "type": "text", "text": h.to_string() })),
            _ => {}
        }
    }
    while stack.len() > 1 {
        close_top(&mut stack);
    }
    let mut blocks = stack.pop().expect("doc").content;
    for b in &mut blocks {
        join_text(b, resolve);
        strip_marker(b);
    }
    // A paragraph that held only a marker, or a formula's leftover, is gone.
    blocks.retain(|b| kind(b) != "paragraph" || !kids(b).is_empty());
    blocks
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

/// Join neighbouring text with the same marks, then turn `[[Title]]` in it
/// into wiki links. Code blocks are left as they are.
fn join_text(node: &mut Value, resolve: &dyn Fn(&str) -> Option<(String, String)>) {
    if kind(node) == "codeBlock" {
        return;
    }
    let Some(content) = node.get_mut("content").and_then(Value::as_array_mut) else { return };
    let mut joined: Vec<Value> = Vec::new();
    for child in content.drain(..) {
        let is_text = kind(&child) == "text";
        if let Some(prev) = joined.last_mut() {
            if is_text && kind(prev) == "text" && prev.get("marks") == child.get("marks") {
                let more = child["text"].as_str().unwrap_or("").to_owned();
                let text = format!("{}{more}", prev["text"].as_str().unwrap_or(""));
                prev["text"] = Value::String(text);
                continue;
            }
        }
        joined.push(child);
    }
    for mut child in joined {
        if kind(&child) == "text" {
            let marks: Vec<Value> = child.get("marks").and_then(Value::as_array).cloned().unwrap_or_default();
            let is_code = marks.iter().any(|m| kind(m) == "code");
            let text = child["text"].as_str().unwrap_or("").to_owned();
            if !is_code {
                content.extend(inline_text(&text, &marks, resolve));
                continue;
            }
        } else {
            join_text(&mut child, resolve);
        }
        content.push(child);
    }
}

/// Text with `[[Title]]` / `[[Title|alias]]` turned into wiki links the
/// resolver knows; unknown titles stay as text.
fn inline_text(text: &str, marks: &[Value], resolve: &dyn Fn(&str) -> Option<(String, String)>) -> Vec<Value> {
    let link = regex::Regex::new(r"\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]").expect("valid regex");
    let mut out = Vec::new();
    let mut last = 0;
    let push_text = |out: &mut Vec<Value>, s: &str| {
        if s.is_empty() {
            return;
        }
        let mut n = json!({ "type": "text", "text": s });
        if !marks.is_empty() {
            n["marks"] = Value::Array(marks.to_vec());
        }
        out.push(n);
    };
    for m in link.captures_iter(text) {
        let whole = m.get(0).expect("match");
        let title = m.get(1).map_or("", |t| t.as_str()).trim();
        if let Some((id, real_title)) = resolve(title) {
            push_text(&mut out, &text[last..whole.start()]);
            let label = m.get(2).map_or(real_title, |a| a.as_str().trim().to_owned());
            out.push(json!({ "type": "mention", "attrs": { "id": id, "label": label } }));
            last = whole.end();
        }
    }
    push_text(&mut out, &text[last..]);
    out
}

/// Drop a trailing ` ^blockId` that `to_markdown` wrote and an agent copied back.
fn strip_marker(block: &mut Value) {
    let marker = regex::Regex::new(r"\s*\^[A-Za-z0-9_-]{4,}\s*$").expect("valid regex");
    let Some(content) = block.get_mut("content").and_then(Value::as_array_mut) else { return };
    if let Some(last) = content.last_mut() {
        if let Some(t) = last.get("text").and_then(Value::as_str) {
            let cleaned = marker.replace(t, "").into_owned();
            if cleaned.is_empty() {
                content.pop();
            } else {
                last["text"] = Value::String(cleaned);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(text: &str) -> Value {
        json!({ "type": "text", "text": text })
    }
    fn marked(text: &str, mark: Value) -> Value {
        json!({ "type": "text", "text": text, "marks": [mark] })
    }

    #[test]
    fn writes_blocks_with_their_ids() {
        let doc = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "level": 2, "blockId": "h1" }, "content": [t("Plan")] },
            { "type": "paragraph", "attrs": { "blockId": "p1" }, "content": [
                t("Ship "), marked("now", json!({ "type": "bold" })), t(" with "),
                marked("docs", json!({ "type": "link", "attrs": { "href": "https://x.dev" } })), t(" and "),
                { "type": "mention", "attrs": { "id": "n2", "label": "Release" } }
            ] },
            { "type": "bulletList", "attrs": { "blockId": "l1" }, "content": [
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [t("one")] }] },
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [t("two")] },
                    { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", "content": [t("deep")] }] }] }] }
            ] },
            { "type": "taskList", "attrs": { "blockId": "t1" }, "content": [
                { "type": "taskItem", "attrs": { "checked": true }, "content": [{ "type": "paragraph", "content": [t("done")] }] }
            ] },
            { "type": "codeBlock", "attrs": { "blockId": "c1", "language": "rust" }, "content": [t("fn main() {}")] },
            { "type": "image", "attrs": { "blockId": "i1", "src": "attachment:a1" } },
            { "type": "tagView", "attrs": { "blockId": "tv1", "viewId": "v1" } }
        ]});
        assert_eq!(
            to_markdown(&doc),
            [
                "## Plan ^h1",
                "Ship **now** with [docs](https://x.dev) and [[Release]] ^p1",
                "- one\n- two\n  - deep\n^l1",
                "- [x] done\n^t1",
                "```rust\nfn main() {}\n```\n^c1",
                "[image]\n^i1",
                "[tag view]\n^tv1",
            ]
            .join("\n\n")
        );
    }

    #[test]
    fn writes_tables_quotes_math_and_rules() {
        let cell = |kind: &str, text: &str| json!({ "type": kind, "content": [{ "type": "paragraph", "content": [t(text)] }] });
        let doc = json!({ "type": "doc", "content": [
            { "type": "table", "content": [
                { "type": "tableRow", "content": [cell("tableHeader", "A"), cell("tableHeader", "B")] },
                { "type": "tableRow", "content": [cell("tableCell", "1"), cell("tableCell", "2")] }
            ] },
            { "type": "blockquote", "content": [{ "type": "paragraph", "content": [t("quoted")] }] },
            { "type": "blockMath", "attrs": { "latex": "E=mc^2" } },
            { "type": "paragraph", "content": [t("x "), { "type": "inlineMath", "attrs": { "latex": "a+b" } }] },
            { "type": "horizontalRule" }
        ]});
        assert_eq!(to_markdown(&doc), "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n\n$$\nE=mc^2\n$$\n\nx $a+b$\n\n---");
    }

    fn resolve(title: &str) -> Option<(String, String)> {
        title.eq_ignore_ascii_case("release").then(|| ("n2".to_owned(), "Release".to_owned()))
    }

    #[test]
    fn reads_markdown_into_blocks() {
        // A different bullet character starts a new list.
        let md = "## Plan ^h9Kq2xYzA1\n\nShip **now** with [docs](https://x.dev), [[release]] and [[Nowhere]].\n\n- one\n- two\n\n* [x] done\n* [ ] todo\n\n```rust\nfn main() {}\n```\n\n> quoted\n\n---";
        let blocks = from_markdown(md, &resolve);
        let types: Vec<&str> = blocks.iter().map(kind).collect();
        assert_eq!(types, ["heading", "paragraph", "bulletList", "taskList", "codeBlock", "blockquote", "horizontalRule"]);
        assert_eq!(blocks[0]["attrs"]["level"], 2);
        assert_eq!(plain(&blocks[0]), "Plan", "the block marker is dropped");
        let p = blocks[1]["content"].as_array().unwrap();
        assert!(p.iter().any(|n| n["marks"][0]["type"] == "bold" && n["text"] == "now"));
        assert!(p.iter().any(|n| n["marks"][0]["attrs"]["href"] == "https://x.dev"));
        assert!(p.iter().any(|n| n["type"] == "mention" && n["attrs"]["id"] == "n2" && n["attrs"]["label"] == "Release"));
        assert!(plain(&blocks[1]).contains("[[Nowhere]]"), "an unknown title stays text");
        assert_eq!(blocks[3]["content"][0]["attrs"]["checked"], true);
        assert_eq!(blocks[3]["content"][1]["type"], "taskItem");
        assert_eq!(blocks[4]["attrs"]["language"], "rust");
        assert_eq!(plain(&blocks[4]), "fn main() {}");
    }

    #[test]
    fn a_loose_task_list_is_still_a_task_list() {
        let blocks = from_markdown("- [x] done\n\n- [ ] todo", &resolve);
        assert_eq!(blocks[0]["type"], "taskList");
        assert_eq!(blocks[0]["content"][0]["type"], "taskItem");
        assert_eq!(blocks[0]["content"][0]["content"][0]["type"], "paragraph");
        assert_eq!(blocks[0]["content"][1]["attrs"]["checked"], false);
    }

    #[test]
    fn round_trips_what_it_writes() {
        let md = "# Title\n\n1. first\n2. second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$\nE=mc^2\n$$";
        let doc = json!({ "type": "doc", "content": from_markdown(md, &resolve) });
        assert_eq!(to_markdown(&doc), md);
    }
}
