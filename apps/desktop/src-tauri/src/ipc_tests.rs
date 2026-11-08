//! The real commands driven through Tauri's mock IPC, as the renderer calls them.

use std::sync::Arc;

use cord_core::doc::yjs::json_to_state;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::core::{Core, Shared};

struct Harness {
    _dir: tempfile::TempDir,
    _app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
}

fn harness() -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let core: Shared = Arc::new(Core::open(dir.path().to_path_buf()).unwrap());
    let app = with_commands!(mock_builder().manage(core)).build(mock_context(noop_assets())).unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    Harness { _dir: dir, _app: app, webview }
}

fn request(cmd: &str, body: InvokeBody, headers: tauri::http::HeaderMap) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "http://tauri.localhost".parse().unwrap(),
        body,
        headers,
        invoke_key: INVOKE_KEY.to_string(),
    }
}

impl Harness {
    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(&self.webview, request(cmd, InvokeBody::Json(args), Default::default()))
            .map(|b| b.deserialize::<Value>().unwrap())
    }

    fn ok(&self, cmd: &str, args: Value) -> Value {
        self.call(cmd, args).unwrap_or_else(|e| panic!("{cmd} failed: {e}"))
    }

    fn body_state(&self, id: &str) -> Vec<u8> {
        match get_ipc_response(&self.webview, request("notes_body_state", InvokeBody::Json(json!({ "id": id })), Default::default())) {
            Ok(tauri::ipc::InvokeResponseBody::Raw(bytes)) => bytes,
            other => panic!("expected raw bytes, got {other:?}"),
        }
    }

    fn apply_update(&self, id: &str, update: Vec<u8>) -> Result<Value, Value> {
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert("x-note-id", id.parse().unwrap());
        get_ipc_response(&self.webview, request("notes_apply_body_update", InvokeBody::Raw(update), headers))
            .map(|b| b.deserialize::<Value>().unwrap())
    }
}

fn doc(paragraphs: &[(&str, Value)]) -> Value {
    let content: Vec<Value> = paragraphs
        .iter()
        .map(|(id, inline)| json!({ "type": "paragraph", "attrs": { "blockId": id }, "content": inline }))
        .collect();
    json!({ "type": "doc", "content": content })
}

#[test]
fn a_note_round_trip_through_ipc() {
    let h = harness();
    assert_eq!(h.call("vaults_list", json!({})).unwrap_err(), json!("Not authenticated"));

    let user = h.ok("auth_register", json!({ "data": { "username": "ola", "password": "pw-long-enough" } }));
    assert_eq!(user["username"], "ola");
    assert_eq!(h.ok("auth_current", json!({}))["id"], user["id"]);

    let vault = h.ok("vaults_create", json!({ "data": { "name": "Work" } }));
    let vault_id = vault["id"].as_str().unwrap();
    let target = h.ok("notes_create", json!({ "data": { "vaultId": vault_id, "title": "Target" } }));
    let note = h.ok("notes_create", json!({ "data": { "vaultId": vault_id, "title": "Source" } }));
    let id = note["id"].as_str().unwrap();
    assert!(!h.body_state(id).is_empty(), "a new note starts with an empty document");

    // A body with a wiki link to Target, sent the way BodySync sends it.
    let body = doc(&[(
        "b1",
        json!([
            { "type": "text", "text": "pelican " },
            { "type": "mention", "attrs": { "id": target["id"], "label": "Target" } }
        ]),
    )]);
    let saved = h.apply_update(id, json_to_state(&body).unwrap()).unwrap();
    assert_eq!(saved["id"], id);
    assert!(saved["bodyJson"].as_str().unwrap().contains("pelican"));

    let links = h.ok("notes_get_links", json!({ "id": target["id"] }));
    assert_eq!(links["backlinks"][0]["fromNoteId"], id);
    let found = h.ok("notes_search", json!({ "vaultId": vault_id, "query": "pelican" }));
    assert_eq!(found[0]["id"], id);
    let blocks = h.ok("blocks_list_for_note", json!({ "noteId": id }));
    // The new note's own empty paragraph sits beside it, with a minted id.
    assert!(blocks.as_array().unwrap().iter().any(|b| b["id"] == "b1"));
    assert!(blocks.as_array().unwrap().iter().all(|b| !b["id"].as_str().unwrap().contains(':')), "no synthetic ids");

    // Title and pin change by notes_update; a body there is refused.
    let renamed = h.ok("notes_update", json!({ "id": id, "data": { "title": "Renamed", "isPinned": true } }));
    assert_eq!((renamed["title"].as_str(), renamed["isPinned"].as_bool()), (Some("Renamed"), Some(true)));
    assert!(h.call("notes_update", json!({ "id": id, "data": { "bodyJson": "{}" } })).is_err());

    // Tags on the note and on its block, under the old fragment names.
    let tag = h.ok("tags_create", json!({ "data": { "vaultId": vault_id, "name": "idea" } }));
    h.ok("tags_attach", json!({ "noteId": id, "tagId": tag["id"] }));
    assert_eq!(h.ok("tags_get_for_note", json!({ "noteId": id }))[0]["name"], "idea");
    h.ok("fragments_attach_tag", json!({ "blockId": "b1", "noteId": id, "vaultId": vault_id, "tagId": tag["id"] }));
    let link = h.ok("fragments_create_link", json!({ "data": {
        "fromFragmentId": "b1", "fromNoteId": id, "vaultId": vault_id, "toNoteId": target["id"]
    } }));
    assert_eq!(link["fromFragmentId"], "b1");
    let annotations = h.ok("fragments_get_for_note", json!({ "noteId": id }));
    assert_eq!(annotations["b1"]["tags"][0]["name"], "idea");
    assert_eq!(annotations["b1"]["links"][0]["toNoteId"], target["id"]);
    let recoloured = h.ok("tags_update", json!({ "tagId": tag["id"], "data": { "color": "#abc" } }));
    assert_eq!(recoloured["color"], "#abc");

    // Trash and back, then gone for good.
    h.ok("notes_delete", json!({ "id": id }));
    assert_eq!(h.ok("notes_list_deleted", json!({ "vaultId": vault_id }))[0]["id"], id);
    h.ok("notes_restore", json!({ "id": id }));
    h.ok("notes_delete", json!({ "id": id }));
    h.ok("notes_permanent_delete", json!({ "id": id }));
    assert_eq!(h.ok("notes_get", json!({ "id": id })), Value::Null);

    // Locking closes the user's data.
    h.ok("auth_lock", json!({}));
    assert!(h.call("vaults_list", json!({})).is_err());
}

#[test]
fn pin_unlock_reopens_the_same_data() {
    let h = harness();
    let user = h.ok("auth_register", json!({ "data": { "username": "ola", "password": "pw-long-enough" } }));
    h.ok("auth_set_pin", json!({ "data": { "pin": "1234" } }));
    h.ok("vaults_create", json!({ "data": { "name": "Kept" } }));
    h.ok("auth_lock", json!({}));

    let lock = h.ok("auth_lock_screen", json!({}));
    assert_eq!(lock["lastUserId"], user["id"]);
    let wrong = h.ok("auth_unlock_pin", json!({ "data": { "userId": user["id"], "pin": "0000" } }));
    assert_eq!(wrong["ok"], false);
    assert!(h.call("vaults_list", json!({})).is_err(), "a wrong PIN opens nothing");
    let right = h.ok("auth_unlock_pin", json!({ "data": { "userId": user["id"], "pin": "1234" } }));
    assert_eq!(right["ok"], true);
    assert_eq!(h.ok("vaults_list", json!({}))[0]["name"], "Kept");
}

/// A Cord 2.4.1 data folder: user "ola" (password "pw-long-enough", PIN "1234"),
/// a vault and one note whose body says "pelican".
pub(crate) fn old_install(dir: &std::path::Path) {
    use cord_core::accounts::password;
    let conn = cord_core::rusqlite::Connection::open(dir.join("cord.db")).unwrap();
    conn.execute_batch(include_str!("../../../../crates/cord-core/fixtures/legacy/v2.4.1.sql")).unwrap();
    let body = json!({ "type": "doc", "content": [
        { "type": "paragraph", "attrs": { "blockId": "b1" }, "content": [{ "type": "text", "text": "pelican" }] }
    ]});
    conn.execute(
        "INSERT INTO users (id, username, password_hash, pin_hash, created_at) VALUES ('u1', 'ola', ?1, ?2, 1)",
        [password::hash("pw-long-enough", 4).unwrap(), password::hash("1234", 4).unwrap()],
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO app_state VALUES ('last_user_id', 'u1', 1);
         INSERT INTO vaults (id, user_id, name, created_at, updated_at) VALUES ('v1', 'u1', 'Old vault', 1, 1);",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO notes (id, vault_id, title, body_json, created_at, updated_at) VALUES ('n1', 'v1', 'Old note', ?1, 1, 2)",
        [body.to_string()],
    )
    .unwrap();
}

#[test]
fn an_old_install_opens_with_its_pin() {
    let dir = tempfile::tempdir().unwrap();
    old_install(dir.path());
    let core: Shared = Arc::new(Core::open(dir.path().to_path_buf()).unwrap());
    let app = with_commands!(mock_builder().manage(core)).build(mock_context(noop_assets())).unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    let h = Harness { _dir: dir, _app: app, webview };

    assert_eq!(h.ok("auth_lock_screen", json!({}))["lastUserId"], "u1");
    assert_eq!(h.ok("auth_unlock_pin", json!({ "data": { "userId": "u1", "pin": "1234" } }))["ok"], true);
    assert_eq!(h.ok("vaults_list", json!({}))[0]["name"], "Old vault");
    assert_eq!(h.ok("notes_list", json!({ "vaultId": "v1" }))[0]["title"], "Old note");
    assert_eq!(h.ok("notes_search", json!({ "vaultId": "v1", "query": "pelican" }))[0]["id"], "n1");
    assert!(!h.body_state("n1").is_empty());
}

#[test]
fn settings_and_attachments_need_a_user() {
    let h = harness();
    assert!(h.call("settings_read", json!({ "file": "settings" })).is_err());
    h.ok("auth_register", json!({ "data": { "username": "ola", "password": "pw-long-enough" } }));
    assert_eq!(h.ok("settings_read", json!({ "file": "settings" }))["text"], Value::Null);
    h.ok("settings_write", json!({ "file": "settings", "text": "{\"a\":1}" }));
    assert_eq!(h.ok("settings_read", json!({ "file": "settings" }))["text"], "{\"a\":1}");

    let vault = h.ok("vaults_create", json!({ "data": { "name": "V" } }));
    // A 1x1 transparent PNG.
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    let att = h.ok("attachments_create", json!({ "data": { "vaultId": vault["id"], "mime": "image/png", "dataBase64": png } }));
    let core = h.webview.state::<Shared>();
    let res = crate::attachment(Some(&core), att["id"].as_str().unwrap());
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "image/png");
    assert_eq!(crate::attachment(Some(&core), "../machine.db").status(), 404);
    assert!(h.call("attachments_create", json!({ "data": { "vaultId": vault["id"], "mime": "image/png", "dataBase64": "%%%" } })).is_err());
}
