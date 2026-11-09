//! The local MCP server: one per signed-in user who allowed agents, on
//! 127.0.0.1, behind a bearer token, refusing browsers.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{header::AUTHORIZATION, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use cord_core::agents::{self, AgentSettings};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::core::Shared;
use crate::mcp::tools::{Access, CordMcp};

/// Written beside the data while the server runs, for the stdio bridge.
pub const PORT_FILE: &str = "mcp.json";

pub struct Running {
    pub user: String,
    pub settings: AgentSettings,
    pub port: u16,
    pub cancel: CancellationToken,
}

#[derive(Default)]
pub struct McpState {
    running: Mutex<Option<Running>>,
}

impl McpState {
    pub async fn port(&self) -> Option<u16> {
        self.running.lock().await.as_ref().map(|r| r.port)
    }
}

pub async fn start(core: Shared, events: Option<tauri::AppHandle>, user: String, settings: AgentSettings) -> std::io::Result<Running> {
    let cancel = CancellationToken::new();
    let access = Arc::new(Access { vaults: settings.vaults.iter().cloned().collect(), edit: settings.edit });
    let (c, u) = (core.clone(), user.clone());
    let service = StreamableHttpService::new(
        move || Ok(CordMcp::new(c.clone(), events.clone(), u.clone(), access.clone())),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default()
            .with_cancellation_token(cancel.child_token())
            .with_json_response(true)
            // Any request with an Origin header comes from a browser page: refuse it.
            .enforce_origin_validation(),
    );
    let hash = Arc::new(settings.token_hash.clone().unwrap_or_default());
    let router = axum::Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(hash, require_token));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let stop = cancel.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).with_graceful_shutdown(async move { stop.cancelled().await }).await;
    });
    Ok(Running { user, settings, port, cancel })
}

async fn require_token(State(hash): State<Arc<String>>, req: Request, next: Next) -> Response {
    let given = req.headers().get(AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
    match given {
        Some(token) if agents::token_matches(&hash, token) => next.run(req).await,
        _ => StatusCode::UNAUTHORIZED.into_response(),
    }
}

/// Make the running server match who is signed in and what they allowed:
/// start, stop, or restart it. Called every second and after settings change.
pub async fn reconcile(core: Shared, events: Option<tauri::AppHandle>, state: &McpState) {
    let want = core.user_id().and_then(|user| {
        let s = agents::load(&core.layout, &user).ok()?;
        (s.allow && s.token_hash.is_some()).then_some((user, s))
    });
    let mut running = state.running.lock().await;
    let same = match (running.as_ref(), want.as_ref()) {
        (Some(r), Some((u, s))) => &r.user == u && &r.settings == s,
        (None, None) => true,
        _ => false,
    };
    if same {
        return;
    }
    let port_file = core.layout.root().join(PORT_FILE);
    if let Some(r) = running.take() {
        r.cancel.cancel();
        let _ = std::fs::remove_file(&port_file);
    }
    if let Some((user, settings)) = want {
        match start(core.clone(), events.clone(), user, settings).await {
            Ok(r) => {
                let _ = std::fs::write(&port_file, serde_json::json!({ "port": r.port }).to_string());
                *running = Some(r);
            }
            Err(e) => eprintln!("[mcp] could not start the agent server: {e}"),
        }
    }
    // The sidebar and the Agents page show whether the server runs.
    if let Some(app) = &events {
        use tauri::Emitter;
        let _ = app.emit("agents-status", serde_json::json!({ "port": running.as_ref().map(|r| r.port) }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::tools::tests::{world, World};
    use rmcp::model::{CallToolRequestParams, ClientCapabilities, ClientConfig, Implementation};
    use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
    use rmcp::transport::StreamableHttpClientTransport;
    use rmcp::ServiceExt;

    fn settings(w: &World, edit: bool) -> (AgentSettings, String) {
        let token = agents::new_token(&w.core.layout, &w.user).unwrap();
        let mut s = agents::load(&w.core.layout, &w.user).unwrap();
        s.allow = true;
        s.edit = edit;
        s.vaults = vec![w.open.clone()];
        agents::save(&w.core.layout, &w.user, &s).unwrap();
        (s, token)
    }

    #[tokio::test]
    async fn a_client_with_the_token_sees_the_tools() {
        let w = world();
        let (s, token) = settings(&w, false);
        let running = start(w.core.clone(), None, w.user.clone(), s).await.unwrap();
        let url = format!("http://127.0.0.1:{}/mcp", running.port);
        let transport = StreamableHttpClientTransport::from_config(StreamableHttpClientTransportConfig::with_uri(url).auth_header(token));
        let client = ClientConfig::new(ClientCapabilities::default(), Implementation::new("cord-test", "0"))
            .serve(transport)
            .await
            .unwrap();
        let tools = client.list_tools(Default::default()).await.unwrap();
        let names: Vec<String> = tools.tools.iter().map(|t| t.name.to_string()).collect();
        assert!(names.contains(&"read_note".to_string()), "{names:?}");
        assert!(!names.contains(&"create_note".to_string()), "no write tools while editing is off");
        let r = client.call_tool(CallToolRequestParams::new("list_vaults")).await.unwrap();
        assert_ne!(r.is_error, Some(true));
        client.cancel().await.unwrap();
        running.cancel.cancel();
    }

    #[tokio::test]
    async fn the_bridge_survives_a_server_restart() {
        use crate::mcp::bridge::Link;
        let w = world();
        let (s, token) = settings(&w, false);
        let port_file = w._dir.path().join("mcp-test.json");
        let first = start(w.core.clone(), None, w.user.clone(), s.clone()).await.unwrap();
        std::fs::write(&port_file, serde_json::json!({ "port": first.port }).to_string()).unwrap();
        let mut link = Link::new(port_file.clone(), &token);
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}"#;
        assert!(link.forward(init).await.unwrap()[0].contains("\"result\""));
        link.forward(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).await.unwrap();
        let list = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#;
        assert!(link.forward(list).await.unwrap()[0].contains("read_note"));

        // Lock and unlock: a new server on a new port, which knows no sessions.
        first.cancel.cancel();
        let second = start(w.core.clone(), None, w.user.clone(), s).await.unwrap();
        std::fs::write(&port_file, serde_json::json!({ "port": second.port }).to_string()).unwrap();
        let again = link.forward(r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#).await.unwrap();
        assert!(again[0].contains("read_note"), "{again:?}");
        second.cancel.cancel();
    }

    #[tokio::test]
    async fn no_token_or_a_browser_is_refused() {
        let w = world();
        let (s, token) = settings(&w, false);
        let running = start(w.core.clone(), None, w.user.clone(), s).await.unwrap();
        let url = format!("http://127.0.0.1:{}/mcp", running.port);
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}"#;
        let http = reqwest::Client::new();
        let post = |auth: Option<&str>, origin: Option<&str>| {
            let mut r = http
                .post(&url)
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .body(init);
            if let Some(a) = auth {
                r = r.bearer_auth(a);
            }
            if let Some(o) = origin {
                r = r.header("origin", o);
            }
            r.send()
        };
        assert_eq!(post(None, None).await.unwrap().status(), 401);
        assert_eq!(post(Some("wrong"), None).await.unwrap().status(), 401);
        assert!(!post(Some(&token), Some("https://evil.example")).await.unwrap().status().is_success());
        assert!(post(Some(&token), None).await.unwrap().status().is_success());
        running.cancel.cancel();
    }

    #[tokio::test]
    async fn reconcile_follows_the_user_and_the_settings() {
        let w = world();
        let state = McpState::default();
        reconcile(w.core.clone(), None, &state).await;
        assert!(state.port().await.is_none(), "off by default");
        settings(&w, false);
        reconcile(w.core.clone(), None, &state).await;
        let port = state.port().await.expect("running");
        assert!(w.core.layout.root().join(PORT_FILE).is_file());
        reconcile(w.core.clone(), None, &state).await;
        assert_eq!(state.port().await, Some(port), "unchanged settings keep the server");
        w.core.sign_out();
        reconcile(w.core.clone(), None, &state).await;
        assert!(state.port().await.is_none(), "locking stops it");
        assert!(!w.core.layout.root().join(PORT_FILE).exists());
    }
}
