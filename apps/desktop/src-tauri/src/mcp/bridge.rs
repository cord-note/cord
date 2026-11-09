//! `cord --mcp`: for MCP clients that start a server process (Claude Desktop).
//! Relays JSON-RPC lines between stdin/stdout and the running app's local
//! server, adding the token from `CORD_MCP_TOKEN`. Opens no window.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::mcp::server::PORT_FILE;

pub const CLOSED: &str = "Cord is locked or closed. Open and unlock it, then try again.";
const BAD_TOKEN: &str = "Cord refused the token. Copy a fresh one from Settings → Agents.";

/// Runs until stdin closes; returns the process exit code.
pub fn run() -> i32 {
    tauri::async_runtime::block_on(relay())
}

async fn relay() -> i32 {
    let token = std::env::var("CORD_MCP_TOKEN").unwrap_or_default().trim().to_owned();
    let http = reqwest::Client::new();
    let mut session: Option<String> = None;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut out = tokio::io::stdout();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let replies = match forward(&http, &token, &mut session, &line).await {
            Ok(r) => r,
            Err(msg) => error_reply(&line, &msg).into_iter().collect(),
        };
        for r in replies {
            if out.write_all(format!("{r}\n").as_bytes()).await.is_err() || out.flush().await.is_err() {
                return 1;
            }
        }
    }
    0
}

async fn forward(http: &reqwest::Client, token: &str, session: &mut Option<String>, line: &str) -> Result<Vec<String>, String> {
    let port = read_port().ok_or_else(|| CLOSED.to_owned())?;
    let mut req = http
        .post(format!("http://127.0.0.1:{port}/mcp"))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .bearer_auth(token)
        .body(line.to_owned());
    if let Some(id) = session.as_deref() {
        req = req.header("mcp-session-id", id);
    }
    let resp = req.send().await.map_err(|e| failure(&e))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BAD_TOKEN.to_owned());
    }
    if let Some(id) = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
        *session = Some(id.to_owned());
    }
    let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
    let body = resp.text().await.map_err(|e| failure(&e))?;
    Ok(messages(&content_type, &body))
}

// The client shows stderr in its logs, so the real cause goes there. The URL
// is fixed, so a request that can't be built has a malformed token.
fn failure(e: &reqwest::Error) -> String {
    eprintln!("cord --mcp: {e:?}");
    if e.is_builder() { BAD_TOKEN } else { CLOSED }.to_owned()
}

fn read_port() -> Option<u16> {
    let text = std::fs::read_to_string(cord_core::data_dir::resolve().join(PORT_FILE)).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    u16::try_from(v.get("port")?.as_u64()?).ok()
}

/// The JSON-RPC messages in one HTTP reply: a JSON body, or SSE `data:` lines.
pub fn messages(content_type: &str, body: &str) -> Vec<String> {
    if body.trim().is_empty() {
        return Vec::new();
    }
    if content_type.starts_with("text/event-stream") {
        return body
            .lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(|d| d.trim().to_owned())
            .filter(|d| !d.is_empty())
            .collect();
    }
    vec![body.trim().to_owned()]
}

/// A JSON-RPC error for a request; notifications (no id) get none.
pub fn error_reply(line: &str, message: &str) -> Option<String> {
    let id = serde_json::from_str::<Value>(line).ok()?.get("id")?.clone();
    Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_json_and_event_stream_replies() {
        assert_eq!(messages("application/json", r#"{"jsonrpc":"2.0","id":1,"result":{}}"#), [r#"{"jsonrpc":"2.0","id":1,"result":{}}"#]);
        let sse = "event: message\ndata: {\"id\":1}\n\nevent: message\ndata: {\"id\":2}\n\n";
        assert_eq!(messages("text/event-stream", sse), [r#"{"id":1}"#, r#"{"id":2}"#]);
        assert!(messages("application/json", "").is_empty(), "202 Accepted has no body");
    }

    #[test]
    fn answers_requests_with_an_error_when_cord_is_closed() {
        let reply = error_reply(r#"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#, CLOSED).unwrap();
        let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
        assert_eq!((v["id"].as_i64(), v["error"]["message"].as_str()), (Some(7), Some(CLOSED)));
        assert!(error_reply(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, CLOSED).is_none(), "notifications get no reply");
    }

    #[test]
    fn a_malformed_token_is_reported_as_a_bad_token() {
        let e = reqwest::Client::new().get("http://127.0.0.1/mcp").bearer_auth("bad\ntoken").build().unwrap_err();
        assert_eq!(failure(&e), BAD_TOKEN);
    }
}
