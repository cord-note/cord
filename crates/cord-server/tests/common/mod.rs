#![allow(dead_code)]

use cord_core::changes::PAYLOAD_FORMAT_V1;
use cord_core::hlc::Hlc;
use cord_core::sync::wire::{SignedIn, WireChange};
use cord_server::{auth, db, Server, Shared};
use serde_json::json;

pub struct TestServer {
    pub dir: tempfile::TempDir,
    pub server: Shared,
    pub base: String,
    pub http: reqwest::Client,
}

pub async fn start() -> TestServer {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::open(dir.path(), 4).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(cord_server::serve(listener, server.clone()));
    TestServer { dir, server, base, http: reqwest::Client::new() }
}

impl TestServer {
    pub fn invite(&self) -> String {
        let db = self.server.db.lock().unwrap();
        auth::create_invite(&db, 7, db::now()).unwrap()
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    /// A new account; returns its token and user id.
    pub async fn account(&self, username: &str) -> SignedIn {
        let body = json!({ "code": self.invite(), "username": username, "password": "pw-test-1", "deviceName": "test" });
        let r = self.http.post(self.url("/v1/invites/redeem")).json(&body).send().await.unwrap();
        assert_eq!(r.status(), 200);
        r.json().await.unwrap()
    }

    pub async fn vault(&self, who: &SignedIn, id: &str) {
        let r = self
            .http
            .post(self.url("/v1/vaults"))
            .bearer_auth(&who.token)
            .json(&json!({ "id": id, "name": "Shared" }))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
    }
}

pub fn change(id: &str, vault: &str, user: &str, title: &str) -> WireChange {
    WireChange {
        id: id.into(),
        vault_id: vault.into(),
        entity_type: "note".into(),
        entity_id: "n1".into(),
        kind: "field_set".into(),
        field: Some("title".into()),
        hlc: Hlc { wall: 1, counter: 0, device: "d".into() }.encode(),
        author_device_id: "d".into(),
        author_user_id: user.into(),
        payload: [&[PAYLOAD_FORMAT_V1][..], serde_json::to_string(title).unwrap().as_bytes()].concat(),
        seq: None,
        received_at: None,
    }
}
