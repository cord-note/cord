//! The tools agents call. Every call runs on cord-core through the same `Core`
//! the app uses, on a blocking thread, as the signed-in user.

use std::collections::HashSet;
use std::sync::Arc;

use cord_core::agents::{self, Activity};
use cord_core::doc::markdown::to_markdown;
use cord_core::session::Session;
use cord_core::services::{annotations, fields, notes, queries, tags, vaults, views};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::*;
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::core::Shared;

/// Tools that change data. They are only offered while editing is on.
pub const WRITE_TOOLS: [&str; 6] = ["create_note", "append_to_note", "set_field", "tag", "untag", "move_to_trash"];

/// What one server may touch: a snapshot of the user's agent settings.
#[derive(Debug, Clone)]
pub struct Access {
    pub vaults: HashSet<String>,
    pub edit: bool,
}

#[derive(Clone)]
pub struct CordMcp {
    core: Shared,
    events: Option<tauri::AppHandle>,
    user: String,
    access: Arc<Access>,
    pub(crate) tool_router: ToolRouter<CordMcp>,
}

#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    /// Words to look for in titles and text.
    pub query: String,
    /// Only this vault. All allowed vaults when left out.
    pub vault_id: Option<String>,
}

#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "camelCase")]
pub struct NoteParams {
    pub note_id: String,
}

#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "camelCase")]
pub struct VaultParams {
    pub vault_id: String,
}

#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "camelCase")]
pub struct TagParams {
    pub tag_id: String,
}

#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteParams {
    pub vault_id: String,
    pub title: String,
    /// The note's text as Markdown. `[[Title]]` links to an existing note.
    pub markdown: Option<String>,
    /// Tag names; missing tags are created.
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "camelCase")]
pub struct AppendParams {
    pub note_id: String,
    /// Markdown added after the note's last block.
    pub markdown: String,
}

#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "camelCase")]
pub struct SetFieldParams {
    pub field_id: String,
    /// A note id, or a block id from read_note (the ^id at a block's end).
    pub target_id: String,
    /// Text, number, true/false, a select option id, a list of option ids,
    /// or a date as YYYY-MM-DD. null clears it.
    pub value: Value,
}

#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "camelCase")]
pub struct TagTargetParams {
    /// A note id, or a block id from read_note.
    pub target_id: String,
    /// The tag's name. Tagging with a new name creates the tag.
    pub tag: String,
}

fn not_found(what: &str) -> cord_core::Error {
    cord_core::Error::NotFound(what.to_owned())
}

impl Access {
    /// A vault agents may not see is reported exactly like one that doesn't exist.
    fn vault(&self, id: &str) -> cord_core::Result<()> {
        if self.vaults.contains(id) {
            Ok(())
        } else {
            Err(not_found(&format!("vault {id}")))
        }
    }
}

struct Target {
    kind: &'static str,
    note_id: String,
    vault_id: String,
}

/// A note id or a block id, in a vault agents may see.
fn find_target(s: &Session, a: &Access, id: &str) -> cord_core::Result<Target> {
    if let Some(n) = notes::get(s, id)? {
        a.vault(&n.meta.vault_id).map_err(|_| not_found(id))?;
        return Ok(Target { kind: "note", note_id: n.meta.id, vault_id: n.meta.vault_id });
    }
    let block = queries::resolve_ref(s, id)?.ok_or_else(|| not_found(id))?;
    let note = notes::get(s, &block.note_id)?.ok_or_else(|| not_found(id))?;
    a.vault(&note.meta.vault_id).map_err(|_| not_found(id))?;
    Ok(Target { kind: "block", note_id: note.meta.id, vault_id: note.meta.vault_id })
}

/// Markdown as blocks, with `[[Title]]` resolved against the vault's notes.
fn markdown_blocks(s: &Session, vault_id: &str, md: &str) -> cord_core::Result<Vec<Value>> {
    let titles: Vec<(String, String)> = notes::list(s, vault_id)?.into_iter().map(|n| (n.id, n.title)).collect();
    let resolve = |title: &str| titles.iter().find(|(_, t)| t.eq_ignore_ascii_case(title)).cloned();
    Ok(cord_core::doc::markdown::from_markdown(md, &resolve))
}

#[tool_router]
impl CordMcp {
    pub fn new(core: Shared, events: Option<tauri::AppHandle>, user: String, access: Arc<Access>) -> Self {
        let mut tool_router = Self::tool_router();
        if !access.edit {
            for name in WRITE_TOOLS {
                tool_router.remove_route(name);
            }
        }
        Self { core, events, user, access, tool_router }
    }

    // ── Read tools ───────────────────────────────────────────────────────────

    #[tool(description = "List the vaults (notebooks) you may read.")]
    async fn list_vaults(&self) -> Result<CallToolResult, McpError> {
        let r = self.do_list_vaults().await;
        self.finish("list_vaults", None, r)
    }

    #[tool(description = "Search notes by words in their title or text. Returns note ids and titles; use read_note for the text.")]
    async fn search(&self, Parameters(p): Parameters<SearchParams>) -> Result<CallToolResult, McpError> {
        let q = p.query.clone();
        let r = self.do_search(p).await;
        self.finish("search", Some(&q), r)
    }

    #[tool(description = "Read a note: title, tags, tag field values, and its text as Markdown. Each block ends with ^blockId.")]
    async fn read_note(&self, Parameters(p): Parameters<NoteParams>) -> Result<CallToolResult, McpError> {
        let id = p.note_id.clone();
        let r = self.do_read_note(p).await;
        self.finish("read_note", Some(&id), r)
    }

    #[tool(description = "Notes that link to a note with a wiki link.")]
    async fn backlinks(&self, Parameters(p): Parameters<NoteParams>) -> Result<CallToolResult, McpError> {
        let id = p.note_id.clone();
        let r = self.do_backlinks(p).await;
        self.finish("backlinks", Some(&id), r)
    }

    #[tool(description = "The tags of a vault, with each tag's fields (name, type, select options).")]
    async fn list_tags(&self, Parameters(p): Parameters<VaultParams>) -> Result<CallToolResult, McpError> {
        let id = p.vault_id.clone();
        let r = self.do_list_tags(p).await;
        self.finish("list_tags", Some(&id), r)
    }

    #[tool(description = "Everything carrying a tag (notes and blocks) with its field values, like a table.")]
    async fn tag_table(&self, Parameters(p): Parameters<TagParams>) -> Result<CallToolResult, McpError> {
        let id = p.tag_id.clone();
        let r = self.do_tag_table(p).await;
        self.finish("tag_table", Some(&id), r)
    }

    // ── Write tools (removed while editing is off) ───────────────────────────

    #[tool(description = "Create a note in a vault, with Markdown text and tags.")]
    async fn create_note(&self, Parameters(p): Parameters<CreateNoteParams>) -> Result<CallToolResult, McpError> {
        let title = p.title.clone();
        let r = self.do_create_note(p).await;
        // Log the new note's id, so the activity list can link to it.
        let target = r.as_ref().ok().and_then(|v| v["noteId"].as_str().map(str::to_owned)).unwrap_or(title);
        self.finish("create_note", Some(&target), r)
    }

    #[tool(description = "Add Markdown to the end of a note.")]
    async fn append_to_note(&self, Parameters(p): Parameters<AppendParams>) -> Result<CallToolResult, McpError> {
        let id = p.note_id.clone();
        let r = self.do_append(p).await;
        self.finish("append_to_note", Some(&id), r)
    }

    #[tool(description = "Set a tag field's value on a note or block (see list_tags for fields). null clears it.")]
    async fn set_field(&self, Parameters(p): Parameters<SetFieldParams>) -> Result<CallToolResult, McpError> {
        let id = p.target_id.clone();
        let r = self.do_set_field(p).await;
        self.finish("set_field", Some(&id), r)
    }

    #[tool(description = "Tag a note or a block. A new tag name creates the tag.")]
    async fn tag(&self, Parameters(p): Parameters<TagTargetParams>) -> Result<CallToolResult, McpError> {
        let id = p.target_id.clone();
        let r = self.do_tag(p).await;
        self.finish("tag", Some(&id), r)
    }

    #[tool(description = "Remove a tag from a note or a block.")]
    async fn untag(&self, Parameters(p): Parameters<TagTargetParams>) -> Result<CallToolResult, McpError> {
        let id = p.target_id.clone();
        let r = self.do_untag(p).await;
        self.finish("untag", Some(&id), r)
    }

    #[tool(description = "Move a note to the trash. It can be restored in Cord.")]
    async fn move_to_trash(&self, Parameters(p): Parameters<NoteParams>) -> Result<CallToolResult, McpError> {
        let id = p.note_id.clone();
        let r = self.do_move_to_trash(p).await;
        self.finish("move_to_trash", Some(&id), r)
    }
}

impl CordMcp {
    /// Run `f` on the user's data, off the async runtime. Fails once the
    /// user has locked or signed out.
    async fn with_session<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Session, &Access) -> cord_core::Result<T> + Send + 'static,
    ) -> Result<T, McpError> {
        let (core, user, access) = (self.core.clone(), self.user.clone(), self.access.clone());
        tokio::task::spawn_blocking(move || {
            if core.user_id().as_deref() != Some(user.as_str()) {
                return Err("Cord is locked. Unlock it, then try again.".to_owned());
            }
            core.session(|s| f(s, &access))
        })
        .await
        .map_err(|e| McpError::internal_error(e.to_string(), None))?
        .map_err(|e| McpError::invalid_params(e, None))
    }

    /// Log the call and turn its result into tool output.
    fn finish(&self, tool: &str, target: Option<&str>, result: Result<Value, McpError>) -> Result<CallToolResult, McpError> {
        let entry = Activity {
            at: now_ms(),
            tool: tool.to_owned(),
            target: target.map(str::to_owned),
            ok: result.is_ok(),
            error: result.as_ref().err().map(|e| e.message.to_string()),
        };
        let _ = agents::log_activity(&self.core.layout, &self.user, &entry);
        self.emit("agent-activity", json!(entry));
        let value = result?;
        let text = serde_json::to_string_pretty(&value).unwrap_or_default();
        Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
    }

    /// Tell the window that data changed outside it. No window in tests.
    fn emit(&self, event: &str, payload: Value) {
        if let Some(app) = &self.events {
            use tauri::Emitter;
            let _ = app.emit(event, payload);
        }
    }

    pub(crate) async fn do_list_vaults(&self) -> Result<Value, McpError> {
        self.with_session(|s, a| {
            Ok(json!(vaults::list(s)?
                .into_iter()
                .filter(|v| a.vaults.contains(&v.id))
                .map(|v| json!({ "id": v.id, "name": v.name, "description": v.description }))
                .collect::<Vec<_>>()))
        })
        .await
    }

    pub(crate) async fn do_search(&self, p: SearchParams) -> Result<Value, McpError> {
        self.with_session(move |s, a| {
            let ids: Vec<String> = match p.vault_id {
                Some(v) => {
                    a.vault(&v)?;
                    vec![v]
                }
                None => a.vaults.iter().cloned().collect(),
            };
            let mut out = Vec::new();
            for v in ids {
                for n in queries::search(s, &v, &p.query)? {
                    out.push(json!({ "noteId": n.id, "title": n.title, "vaultId": n.vault_id, "updatedAt": n.updated_at }));
                }
            }
            Ok(json!(out))
        })
        .await
    }

    pub(crate) async fn do_read_note(&self, p: NoteParams) -> Result<Value, McpError> {
        self.with_session(move |s, a| {
            let note = notes::get(s, &p.note_id)?.ok_or_else(|| not_found(&format!("note {}", p.note_id)))?;
            a.vault(&note.meta.vault_id).map_err(|_| not_found(&format!("note {}", p.note_id)))?;
            let doc: Value = serde_json::from_str(&note.body_json).unwrap_or_else(|_| json!({ "type": "doc" }));
            let tag_names: Vec<String> = tags::for_note(s, &p.note_id)?.into_iter().map(|t| t.name).collect();
            let nf = fields::for_note(s, &p.note_id)?;
            Ok(json!({
                "noteId": note.meta.id, "vaultId": note.meta.vault_id, "title": note.meta.title,
                "kind": note.meta.kind, "inTrash": note.meta.deleted_at.is_some(), "updatedAt": note.meta.updated_at,
                "tags": tag_names, "fields": nf.fields, "values": nf.values, "markdown": to_markdown(&doc),
            }))
        })
        .await
    }

    pub(crate) async fn do_backlinks(&self, p: NoteParams) -> Result<Value, McpError> {
        self.with_session(move |s, a| {
            let note = notes::get(s, &p.note_id)?.ok_or_else(|| not_found(&format!("note {}", p.note_id)))?;
            a.vault(&note.meta.vault_id).map_err(|_| not_found(&format!("note {}", p.note_id)))?;
            let mut out = Vec::new();
            for l in queries::links(s, &p.note_id)?.backlinks {
                if let Some(from) = notes::get(s, &l.from_note_id)? {
                    if a.vaults.contains(&from.meta.vault_id) && from.meta.deleted_at.is_none() {
                        out.push(json!({ "noteId": from.meta.id, "title": from.meta.title }));
                    }
                }
            }
            Ok(json!(out))
        })
        .await
    }

    pub(crate) async fn do_list_tags(&self, p: VaultParams) -> Result<Value, McpError> {
        self.with_session(move |s, a| {
            a.vault(&p.vault_id)?;
            let mut out = Vec::new();
            for t in tags::list(s, &p.vault_id)? {
                let f = fields::list(s, &t.id)?;
                out.push(json!({ "id": t.id, "name": t.name, "fields": f }));
            }
            Ok(json!(out))
        })
        .await
    }

    pub(crate) async fn do_tag_table(&self, p: TagParams) -> Result<Value, McpError> {
        self.with_session(move |s, a| {
            let tag = tags::require_live(s, &p.tag_id)?;
            a.vault(&tag.vault_id).map_err(|_| not_found(&format!("tag {}", p.tag_id)))?;
            Ok(json!({ "tag": tag.name, "fields": fields::list(s, &p.tag_id)?, "rows": views::rows(s, &p.tag_id)? }))
        })
        .await
    }

    pub(crate) async fn do_create_note(&self, p: CreateNoteParams) -> Result<Value, McpError> {
        let (id, vault) = self
            .with_session(move |s, a| {
                a.vault(&p.vault_id)?;
                let body = match p.markdown.as_deref().map(|md| markdown_blocks(s, &p.vault_id, md)).transpose()? {
                    Some(blocks) if !blocks.is_empty() => Some(json!({ "type": "doc", "content": blocks })),
                    _ => None,
                };
                let note = notes::create(
                    s,
                    cord_core::model::NewNote { vault_id: p.vault_id.clone(), title: Some(p.title), body, ..Default::default() },
                )?;
                for name in p.tags.unwrap_or_default() {
                    let t = tags::create(s, cord_core::model::NewTag { vault_id: p.vault_id.clone(), name, color: None })?;
                    tags::attach(s, &note.meta.id, &t.id)?;
                }
                Ok((note.meta.id, p.vault_id))
            })
            .await?;
        self.emit("notes-changed", json!({ "vaultId": vault }));
        Ok(json!({ "noteId": id }))
    }

    pub(crate) async fn do_append(&self, p: AppendParams) -> Result<Value, McpError> {
        let (update, note_id, vault_id) = self
            .with_session(move |s, a| {
                let note = notes::get(s, &p.note_id)?.ok_or_else(|| not_found(&format!("note {}", p.note_id)))?;
                a.vault(&note.meta.vault_id).map_err(|_| not_found(&format!("note {}", p.note_id)))?;
                let mut doc = json!({ "type": "doc", "content": markdown_blocks(s, &note.meta.vault_id, &p.markdown)? });
                cord_core::doc::ids::mint_block_ids(&mut doc);
                let blocks = doc["content"].as_array().cloned().unwrap_or_default();
                let state = notes::body_state(s, &p.note_id)?.ok_or_else(|| not_found(&format!("note {}", p.note_id)))?;
                let update = cord_core::doc::yjs::append_blocks(&state, &blocks)?;
                notes::apply_body_update(s, &p.note_id, &update)?;
                Ok((update, note.meta.id, note.meta.vault_id))
            })
            .await?;
        // An open editor merges the same update, so the text appears live.
        self.emit("note-body-changed", json!({ "noteId": note_id, "update": update }));
        self.emit("notes-changed", json!({ "vaultId": vault_id }));
        Ok(json!({ "noteId": note_id }))
    }

    pub(crate) async fn do_set_field(&self, p: SetFieldParams) -> Result<Value, McpError> {
        let vault = self
            .with_session(move |s, a| {
                let field = fields::require(s, &p.field_id)?;
                a.vault(&field.vault_id).map_err(|_| not_found(&format!("field {}", p.field_id)))?;
                let target = find_target(s, a, &p.target_id)?;
                if p.value.is_null() {
                    fields::clear_value(s, &p.field_id, &p.target_id)?;
                } else {
                    fields::set_value(
                        s,
                        cord_core::model::SetValue {
                            field_id: p.field_id,
                            target_id: p.target_id,
                            target_kind: target.kind.into(),
                            note_id: target.note_id,
                            value: p.value,
                        },
                    )?;
                }
                Ok(target.vault_id)
            })
            .await?;
        self.emit("notes-changed", json!({ "vaultId": vault }));
        Ok(json!({ "ok": true }))
    }

    pub(crate) async fn do_tag(&self, p: TagTargetParams) -> Result<Value, McpError> {
        let vault = self
            .with_session(move |s, a| {
                let target = find_target(s, a, &p.target_id)?;
                let t = tags::create(s, cord_core::model::NewTag { vault_id: target.vault_id.clone(), name: p.tag, color: None })?;
                match target.kind {
                    "note" => tags::attach(s, &target.note_id, &t.id)?,
                    _ => annotations::attach_tag(s, &p.target_id, &target.note_id, &t.id)?,
                }
                Ok(target.vault_id)
            })
            .await?;
        self.emit("notes-changed", json!({ "vaultId": vault }));
        Ok(json!({ "ok": true }))
    }

    pub(crate) async fn do_untag(&self, p: TagTargetParams) -> Result<Value, McpError> {
        let vault = self
            .with_session(move |s, a| {
                let target = find_target(s, a, &p.target_id)?;
                let wanted = p.tag.trim().to_lowercase();
                let Some(t) = tags::list(s, &target.vault_id)?.into_iter().find(|t| t.name.to_lowercase() == wanted) else {
                    return Ok(target.vault_id); // Not tagged: nothing to do.
                };
                match target.kind {
                    "note" => tags::detach(s, &target.note_id, &t.id)?,
                    _ => annotations::detach_tag(s, &p.target_id, &t.id)?,
                }
                Ok(target.vault_id)
            })
            .await?;
        self.emit("notes-changed", json!({ "vaultId": vault }));
        Ok(json!({ "ok": true }))
    }

    pub(crate) async fn do_move_to_trash(&self, p: NoteParams) -> Result<Value, McpError> {
        let vault = self
            .with_session(move |s, a| {
                let note = notes::get(s, &p.note_id)?.ok_or_else(|| not_found(&format!("note {}", p.note_id)))?;
                a.vault(&note.meta.vault_id).map_err(|_| not_found(&format!("note {}", p.note_id)))?;
                notes::delete(s, &p.note_id)?;
                Ok(note.meta.vault_id)
            })
            .await?;
        self.emit("notes-changed", json!({ "vaultId": vault }));
        Ok(json!({ "ok": true }))
    }
}

// The per-session router, so write tools removed in `new` stay removed.
#[tool_handler(router = self.tool_router)]
impl ServerHandler for CordMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("cord", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "Cord is a local note-taking app. Notes live in vaults; tags can carry fields \
                 (like a database). Use search, then read_note. Block ids appear as ^id at the \
                 end of each block and can be passed to set_field, tag and untag."
                    .to_owned(),
            )
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::core::Core;
    use cord_core::model::{NewNote, NewTag, NewVault};

    /// A signed-in user with two vaults: "Open" (allowed) and "Private" (not).
    pub(crate) struct World {
        pub _dir: tempfile::TempDir,
        pub core: Shared,
        pub user: String,
        pub open: String,
        pub private: String,
        pub note: String,
        pub secret: String,
    }

    pub(crate) fn world() -> World {
        let dir = tempfile::tempdir().unwrap();
        let core: Shared = Arc::new(Core::open(dir.path().to_path_buf()).unwrap());
        let user = core.accounts(|a| a.fast().register("ola", "pw-long-enough")).unwrap().id;
        core.sign_in(&user).unwrap();
        let (open, private, note, secret) = core
            .session(|s| {
                let open = vaults::create(s, NewVault { name: "Open".into(), ..Default::default() })?.id;
                let private = vaults::create(s, NewVault { name: "Private".into(), ..Default::default() })?.id;
                let body = json!({ "type": "doc", "content": [
                    { "type": "paragraph", "attrs": { "blockId": "b1" }, "content": [{ "type": "text", "text": "pelican plans" }] }
                ]});
                let note = notes::create(s, NewNote { vault_id: open.clone(), title: Some("Birds".into()), body: Some(body), ..Default::default() })?
                    .meta
                    .id;
                let secret = notes::create(s, NewNote { vault_id: private.clone(), title: Some("Diary".into()), ..Default::default() })?.meta.id;
                let t = tags::create(s, NewTag { vault_id: open.clone(), name: "task".into(), color: None })?;
                tags::attach(s, &note, &t.id)?;
                Ok((open, private, note, secret))
            })
            .unwrap();
        World { _dir: dir, core, user, open, private, note, secret }
    }

    pub(crate) fn server(w: &World, edit: bool) -> CordMcp {
        let access = Access { vaults: [w.open.clone()].into_iter().collect(), edit };
        CordMcp::new(w.core.clone(), None, w.user.clone(), Arc::new(access))
    }

    #[test]
    fn arguments_are_camel_case() {
        let w = world();
        let tools = server(&w, true).tool_router.list_all();
        let read = tools.iter().find(|t| t.name == "read_note").unwrap();
        assert!(read.input_schema["properties"].get("noteId").is_some());
        let tag = tools.iter().find(|t| t.name == "tag").unwrap();
        assert!(tag.input_schema["properties"].get("targetId").is_some());
    }

    #[tokio::test]
    async fn reads_only_allowed_vaults() {
        let w = world();
        let s = server(&w, false);
        let vaults = s.do_list_vaults().await.unwrap();
        assert_eq!(vaults.as_array().unwrap().len(), 1);
        assert_eq!(vaults[0]["name"], "Open");

        let found = s.do_search(SearchParams { query: "pelican".into(), vault_id: None }).await.unwrap();
        assert_eq!(found[0]["noteId"], w.note.as_str());
        assert!(s.do_search(SearchParams { query: "x".into(), vault_id: Some(w.private.clone()) }).await.is_err());

        let note = s.do_read_note(NoteParams { note_id: w.note.clone() }).await.unwrap();
        assert_eq!(note["title"], "Birds");
        assert!(note["markdown"].as_str().unwrap().contains("pelican plans ^b1"));
        assert_eq!(note["tags"][0], "task");
        let hidden = s.do_read_note(NoteParams { note_id: w.secret.clone() }).await.unwrap_err();
        assert!(hidden.message.contains("not found"), "a private note reads as missing: {}", hidden.message);
    }

    #[tokio::test]
    async fn lists_tags_and_tag_tables() {
        let w = world();
        let s = server(&w, false);
        let t = s.do_list_tags(VaultParams { vault_id: w.open.clone() }).await.unwrap();
        assert_eq!(t[0]["name"], "task");
        let table = s.do_tag_table(TagParams { tag_id: t[0]["id"].as_str().unwrap().into() }).await.unwrap();
        assert_eq!(table["rows"][0]["title"], "Birds");
    }

    #[test]
    fn write_tools_are_hidden_until_editing_is_on() {
        let w = world();
        let names = |s: &CordMcp| s.tool_router.list_all().into_iter().map(|t| t.name.to_string()).collect::<Vec<_>>();
        let read_only = names(&server(&w, false));
        assert!(read_only.contains(&"search".to_string()));
        assert!(!read_only.iter().any(|n| WRITE_TOOLS.contains(&n.as_str())));
        assert!(names(&server(&w, true)).contains(&"create_note".to_string()));
    }

    #[tokio::test]
    async fn writes_go_through_the_normal_path() {
        let w = world();
        let s = server(&w, true);
        let created = s
            .do_create_note(CreateNoteParams {
                vault_id: w.open.clone(),
                title: "Trip".into(),
                markdown: Some("Pack **boots**. See [[Birds]].".into()),
                tags: Some(vec!["task".into(), "travel".into()]),
            })
            .await
            .unwrap();
        let id = created["noteId"].as_str().unwrap().to_owned();
        let read = s.do_read_note(NoteParams { note_id: id.clone() }).await.unwrap();
        assert!(read["markdown"].as_str().unwrap().contains("Pack **boots**. See [[Birds]]."), "{}", read["markdown"]);
        assert_eq!(read["tags"].as_array().unwrap().len(), 2, "an unknown tag name is created");

        s.do_append(AppendParams { note_id: id.clone(), markdown: "- one more".into() }).await.unwrap();
        let read = s.do_read_note(NoteParams { note_id: id.clone() }).await.unwrap();
        let md = read["markdown"].as_str().unwrap();
        assert!(md.find("Pack").unwrap() < md.find("- one more").unwrap(), "appended at the end");

        s.do_tag(TagTargetParams { target_id: "b1".into(), tag: "idea".into() }).await.unwrap();
        s.do_untag(TagTargetParams { target_id: "b1".into(), tag: "idea".into() }).await.unwrap();
        s.do_move_to_trash(NoteParams { note_id: id.clone() }).await.unwrap();
        assert_eq!(s.do_read_note(NoteParams { note_id: id }).await.unwrap()["inTrash"], true);

        let refused = s
            .do_create_note(CreateNoteParams { vault_id: w.private.clone(), title: "x".into(), markdown: None, tags: None })
            .await;
        assert!(refused.is_err(), "no writes into a hidden vault");
    }

    #[tokio::test]
    async fn set_field_checks_the_value() {
        let w = world();
        let s = server(&w, true);
        let open = w.open.clone();
        let field = w
            .core
            .session(|sess| {
                let t = tags::list(sess, &open)?.remove(0);
                fields::create(sess, cord_core::model::NewField { tag_id: t.id, name: "Done".into(), kind: "checkbox".into(), options: vec![] })
            })
            .unwrap();
        s.do_set_field(SetFieldParams { field_id: field.id.clone(), target_id: w.note.clone(), value: json!(true) }).await.unwrap();
        assert!(s.do_set_field(SetFieldParams { field_id: field.id.clone(), target_id: w.note.clone(), value: json!("yes") }).await.is_err());
        let read = s.do_read_note(NoteParams { note_id: w.note.clone() }).await.unwrap();
        assert_eq!(read["values"][0]["value"], true);
    }

    #[tokio::test]
    async fn every_call_is_logged() {
        let w = world();
        let s = server(&w, false);
        let _ = s.read_note(Parameters(NoteParams { note_id: w.note.clone() })).await;
        let _ = s.read_note(Parameters(NoteParams { note_id: "nope".into() })).await;
        let log = agents::activity(&w.core.layout, &w.user).unwrap();
        assert_eq!((log.len(), log[0].ok, log[1].ok), (2, false, true));
    }
}
