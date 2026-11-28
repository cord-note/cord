//! Listens for "vault X grew" pings. Ends when the socket closes, which
//! drops `tx`, so the loop reconnects and catches up.

use cord_core::sync::wire::Ping;
use futures_util::StreamExt;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

pub async fn listen(url: String, token: String, tx: mpsc::Sender<Ping>) {
    let Ok(mut req) = url.into_client_request() else { return };
    let Ok(auth) = HeaderValue::from_str(&format!("Bearer {token}")) else { return };
    req.headers_mut().insert("Authorization", auth);
    let Ok((mut ws, _)) = tokio_tungstenite::connect_async(req).await else { return };
    while let Some(msg) = ws.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(ping) = serde_json::from_str::<Ping>(&text) {
                    if tx.send(ping).await.is_err() {
                        return;
                    }
                }
            }
            Ok(Message::Close(_)) | Err(_) => return,
            Ok(_) => {}
        }
    }
}
