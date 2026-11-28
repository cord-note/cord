mod common;

use std::time::Duration;

use cord_core::sync::wire::Ping;
use futures_util::StreamExt;
use serde_json::json;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn a_push_pings_members_only() {
    let s = common::start().await;
    let owner = s.account("ola").await;
    let other = s.account("kim").await;
    s.vault(&owner, "v1").await;

    let socket = |token: String| {
        let url = s.url("/v1/live").replace("http://", "ws://");
        async move {
            let mut req = url.into_client_request().unwrap();
            req.headers_mut().insert("Authorization", format!("Bearer {token}").parse().unwrap());
            tokio_tungstenite::connect_async(req).await.unwrap().0
        }
    };
    let mut mine = socket(owner.token.clone()).await;
    let mut theirs = socket(other.token.clone()).await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    s.http
        .post(s.url("/v1/vaults/v1/changes"))
        .bearer_auth(&owner.token)
        .json(&json!({ "changes": [common::change("a", "v1", &owner.user_id, "A")] }))
        .send()
        .await
        .unwrap();

    let got = tokio::time::timeout(Duration::from_secs(5), mine.next()).await.unwrap().unwrap().unwrap();
    let Message::Text(text) = got else { panic!("expected text, got {got:?}") };
    assert_eq!(serde_json::from_str::<Ping>(&text).unwrap(), Ping { vault: "v1".into(), seq: 1 });
    assert!(tokio::time::timeout(Duration::from_millis(500), theirs.next()).await.is_err());
}

#[tokio::test]
async fn the_socket_needs_a_token() {
    let s = common::start().await;
    let url = s.url("/v1/live").replace("http://", "ws://");
    assert!(tokio_tungstenite::connect_async(url).await.is_err());
}
