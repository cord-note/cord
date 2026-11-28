mod common;

use cord_core::sync::wire::{Hello, PROTOCOL};
use serde_json::json;

#[tokio::test]
async fn hello_names_the_protocol() {
    let s = common::start().await;
    let hello: Hello = s.http.get(s.url("/v1/hello")).send().await.unwrap().json().await.unwrap();
    assert_eq!(hello.protocol, PROTOCOL);
    assert!(!hello.server_id.is_empty());
}

#[tokio::test]
async fn an_invite_works_once() {
    let s = common::start().await;
    let code = s.invite();
    let body = |name: &str| json!({ "code": code, "username": name, "password": "pw-test-1", "deviceName": "t" });
    let first = s.http.post(s.url("/v1/invites/redeem")).json(&body("ola")).send().await.unwrap();
    assert_eq!(first.status(), 200);
    let second = s.http.post(s.url("/v1/invites/redeem")).json(&body("kim")).send().await.unwrap();
    assert_eq!(second.status(), 403);
}

#[tokio::test]
async fn requests_need_a_live_token() {
    let s = common::start().await;
    assert_eq!(s.http.get(s.url("/v1/vaults")).send().await.unwrap().status(), 401);
    let me = s.account("ola").await;
    let list = s.http.get(s.url("/v1/vaults")).bearer_auth(&me.token).send().await.unwrap();
    assert_eq!(list.status(), 200);
    let out = s.http.post(s.url("/v1/logout")).bearer_auth(&me.token).send().await.unwrap();
    assert_eq!(out.status(), 200);
    assert_eq!(s.http.get(s.url("/v1/vaults")).bearer_auth(&me.token).send().await.unwrap().status(), 401);
}

#[tokio::test]
async fn login_gives_a_second_device_its_own_token() {
    let s = common::start().await;
    let me = s.account("ola").await;
    let body = json!({ "username": "ola", "password": "pw-test-1", "deviceName": "phone" });
    let r = s.http.post(s.url("/v1/login")).json(&body).send().await.unwrap();
    assert_eq!(r.status(), 200);
    let other: cord_core::sync::wire::SignedIn = r.json().await.unwrap();
    assert_eq!(other.user_id, me.user_id);
    assert_ne!(other.token, me.token);
    let wrong = json!({ "username": "ola", "password": "nope", "deviceName": "phone" });
    assert_eq!(s.http.post(s.url("/v1/login")).json(&wrong).send().await.unwrap().status(), 401);
}
