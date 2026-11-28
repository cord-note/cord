mod common;

use cord_core::sync::wire::{PullReply, PushReply, VaultInfo};
use serde_json::json;

#[tokio::test]
async fn push_then_pull_returns_changes_in_order_once() {
    let s = common::start().await;
    let me = s.account("ola").await;
    s.vault(&me, "v1").await;
    let a = common::change("a", "v1", &me.user_id, "A");
    let b = common::change("b", "v1", &me.user_id, "B");
    for _ in 0..2 {
        let r: PushReply = s
            .http
            .post(s.url("/v1/vaults/v1/changes"))
            .bearer_auth(&me.token)
            .json(&json!({ "changes": [a, b] }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(r.accepted, ["a", "b"]);
    }
    let page: PullReply = s
        .http
        .get(s.url("/v1/vaults/v1/changes?after=0"))
        .bearer_auth(&me.token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page.changes.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    assert_eq!(page.changes[1].seq, Some(2));
    assert_eq!(page.changes[0].payload, a.payload);
}

#[tokio::test]
async fn a_rejected_change_comes_back_with_its_reason() {
    let s = common::start().await;
    let me = s.account("ola").await;
    s.vault(&me, "v1").await;
    let mut bad = common::change("bad", "v1", &me.user_id, "x");
    bad.kind = "explode".into();
    let r: PushReply = s
        .http
        .post(s.url("/v1/vaults/v1/changes"))
        .bearer_auth(&me.token)
        .json(&json!({ "changes": [bad, common::change("ok", "v1", &me.user_id, "A")] }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(r.accepted, ["ok"]);
    assert_eq!(r.rejected[0].id, "bad");
}

#[tokio::test]
async fn strangers_can_neither_read_nor_write_until_added() {
    let s = common::start().await;
    let owner = s.account("ola").await;
    let other = s.account("kim").await;
    s.vault(&owner, "v1").await;
    let pull = s.http.get(s.url("/v1/vaults/v1/changes")).bearer_auth(&other.token).send().await.unwrap();
    assert_eq!(pull.status(), 403);
    let push = s
        .http
        .post(s.url("/v1/vaults/v1/changes"))
        .bearer_auth(&other.token)
        .json(&json!({ "changes": [common::change("a", "v1", &other.user_id, "A")] }))
        .send()
        .await
        .unwrap();
    assert_eq!(push.status(), 403);
    cord_server::admin::add_member(s.dir.path(), "v1", "kim", "editor").unwrap();
    let list: Vec<VaultInfo> = s.http.get(s.url("/v1/vaults")).bearer_auth(&other.token).send().await.unwrap().json().await.unwrap();
    assert_eq!(list[0].role, "editor");
}

#[tokio::test]
async fn someone_elses_vault_id_is_refused() {
    let s = common::start().await;
    let owner = s.account("ola").await;
    let other = s.account("kim").await;
    s.vault(&owner, "v1").await;
    let r = s
        .http
        .post(s.url("/v1/vaults"))
        .bearer_auth(&other.token)
        .json(&json!({ "id": "v1", "name": "Mine" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 409);
}
