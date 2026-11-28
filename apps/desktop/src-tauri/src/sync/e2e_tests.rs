//! Two app cores and a real cord-server on a random port.

use std::sync::Arc;
use std::time::Duration;

use cord_core::doc::yjs::append_blocks;
use cord_core::model::{NewNote, NewVault, NoteChanges};
use cord_core::services::{notes, vaults};
use serde_json::json;

use crate::core::{Core, Shared};
use crate::sync::client::{Client, SyncError};
use crate::sync::state::{reconcile, SyncState};
use crate::sync::{actions, engine};

// Fixture password for throwaway accounts in temp folders.
const PW: &str = "pw-test-sync-1";

struct Server {
    _dir: tempfile::TempDir,
    server: cord_server::Shared,
    base: String,
}

async fn server() -> Server {
    let dir = tempfile::tempdir().unwrap();
    let server = cord_server::Server::open(dir.path(), 4).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(cord_server::serve(listener, server.clone()));
    Server { _dir: dir, server, base }
}

impl Server {
    fn invite(&self) -> String {
        let db = self.server.db.lock().unwrap();
        cord_server::auth::create_invite(&db, 7, cord_server::db::now()).unwrap()
    }
}

fn device() -> (tempfile::TempDir, Shared) {
    let dir = tempfile::tempdir().unwrap();
    let core: Shared = Arc::new(Core::open(dir.path().to_path_buf()).unwrap());
    let user = core.accounts(|a| a.fast().register("ola", PW)).unwrap();
    core.sign_in(&user.id).unwrap();
    (dir, core)
}

fn title(core: &Shared, note: &str) -> String {
    core.session(|s| Ok(notes::get(s, note)?.unwrap().meta.title)).unwrap()
}

fn body(core: &Shared, note: &str) -> String {
    core.session(|s| Ok(notes::get(s, note)?.unwrap().body_json)).unwrap()
}

fn append(core: &Shared, note: &str, text: &str) {
    core.session(|s| {
        let state = notes::body_state(s, note)?.unwrap_or_default();
        let block = json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] });
        let update = append_blocks(&state, &[block])?;
        notes::apply_body_update(s, note, &update)
    })
    .unwrap();
}

/// Device A with a linked vault holding one note, device B with that vault pulled.
struct Pair {
    srv: Server,
    _a_dir: tempfile::TempDir,
    a: Shared,
    a_conn: String,
    _b_dir: tempfile::TempDir,
    b: Shared,
    b_conn: String,
    vault: String,
    note: String,
}

async fn pair() -> Pair {
    let srv = server().await;
    let (a_dir, a) = device();
    let (b_dir, b) = device();
    let a_conn = actions::add_server(&a, &srv.base, "ola", PW, Some(&srv.invite()), "laptop").await.unwrap().id;
    let b_conn = actions::add_server(&b, &srv.base, "ola", PW, None, "desktop").await.unwrap().id;

    let (vault, note) = a
        .session(|s| {
            let v = vaults::create(s, NewVault { name: "Shared".into(), ..Default::default() })?;
            let n = notes::create(s, NewNote { vault_id: v.id.clone(), title: Some("Plan".into()), ..Default::default() })?;
            Ok((v.id, n.meta.id))
        })
        .unwrap();
    actions::link_vault(&a, &SyncState::default(), &a_conn, &vault).await.unwrap();
    engine::sync_once(&a, None, &client(&srv, &a, &a_conn), &a_conn).await.unwrap();
    actions::pull_vault(&b, None, &b_conn, &vault).await.unwrap();
    Pair { srv, _a_dir: a_dir, a, a_conn, _b_dir: b_dir, b, b_conn, vault, note }
}

fn client(srv: &Server, core: &Shared, conn: &str) -> Client {
    let token = core
        .session(|s| Ok(cord_core::sync::connections::get(s.conn(), conn)?.unwrap().token))
        .unwrap();
    Client::new(&srv.base, token)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_linked_vault_arrives_on_the_second_device() {
    let p = pair().await;
    assert_eq!(title(&p.b, &p.note), "Plan");
    assert_eq!(body(&p.a, &p.note), body(&p.b, &p.note));
    let listed = actions::server_vaults(&p.b, &p.b_conn).await.unwrap();
    assert_eq!((listed[0].id.as_str(), listed[0].linked), (p.vault.as_str(), true));
    assert!(actions::pull_vault(&p.b, None, &p.b_conn, &p.vault).await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn edits_on_both_devices_end_up_on_both() {
    let p = pair().await;
    append(&p.a, &p.note, "from a");
    append(&p.b, &p.note, "from b");
    p.b.session(|s| notes::update(s, &p.note, NoteChanges { title: Some("Plan v2".into()), ..Default::default() }).map(|_| ()))
        .unwrap();
    let ca = client(&p.srv, &p.a, &p.a_conn);
    let cb = client(&p.srv, &p.b, &p.b_conn);
    engine::sync_once(&p.a, None, &ca, &p.a_conn).await.unwrap();
    engine::sync_once(&p.b, None, &cb, &p.b_conn).await.unwrap();
    engine::sync_once(&p.a, None, &ca, &p.a_conn).await.unwrap();
    let text = body(&p.a, &p.note);
    assert!(text.contains("from a") && text.contains("from b"));
    assert_eq!(text, body(&p.b, &p.note));
    assert_eq!(title(&p.a, &p.note), "Plan v2");
}

#[tokio::test(flavor = "multi_thread")]
async fn offline_edits_wait_in_the_outbox() {
    let p = pair().await;
    append(&p.a, &p.note, "written offline");
    let dead = Client::new("http://127.0.0.1:9", Some("t".into()));
    assert!(matches!(engine::push_all(&p.a, &dead, &p.a_conn).await, Err(SyncError::Offline(_))));
    let owed = p.a.session(|s| Ok(cord_core::sync::outbox::next_batch(s.conn(), &p.a_conn)?.changes.len())).unwrap();
    assert!(owed > 0);
    engine::sync_once(&p.a, None, &client(&p.srv, &p.a, &p.a_conn), &p.a_conn).await.unwrap();
    engine::sync_once(&p.b, None, &client(&p.srv, &p.b, &p.b_conn), &p.b_conn).await.unwrap();
    assert!(body(&p.b, &p.note).contains("written offline"));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_background_task_pulls_live_edits() {
    let p = pair().await;
    let state = SyncState::default();
    reconcile(p.b.clone(), None, &state).await;
    // Let B connect and open its live channel.
    for _ in 0..50 {
        if state.statuses.list().iter().any(|s| s.state == "connected") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    p.a.session(|s| notes::update(s, &p.note, NoteChanges { title: Some("Live".into()), ..Default::default() }).map(|_| ()))
        .unwrap();
    engine::push_all(&p.a, &client(&p.srv, &p.a, &p.a_conn), &p.a_conn).await.unwrap();
    let mut seen = false;
    for _ in 0..50 {
        if title(&p.b, &p.note) == "Live" {
            seen = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    state.stop(&p.b_conn).await;
    assert!(seen, "B did not pick up A's edit within 5 s");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_revoked_token_shows_signed_out_and_keeps_the_outbox() {
    let p = pair().await;
    client(&p.srv, &p.a, &p.a_conn).logout().await.unwrap();
    append(&p.a, &p.note, "after logout");
    let state = SyncState::default();
    reconcile(p.a.clone(), None, &state).await;
    let mut signed_out = false;
    for _ in 0..50 {
        if state.statuses.list().iter().any(|s| s.state == "signedOut") {
            signed_out = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    state.stop(&p.a_conn).await;
    assert!(signed_out);
    let owed = p.a.session(|s| Ok(cord_core::sync::outbox::next_batch(s.conn(), &p.a_conn)?.changes.len())).unwrap();
    assert!(owed > 0);
}
