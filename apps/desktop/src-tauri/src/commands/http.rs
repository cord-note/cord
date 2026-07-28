//! Shared forwarding helpers for the Bun sidecar.
//!
//! Every command module used to carry its own copy of these helpers, and none
//! of them inspected the HTTP status. The sidecar reports failures as
//! `{"error": "..."}` with a 4xx/5xx status, so an unchecked `.json()` call
//! deserializes that body happily and hands it back to the renderer as a
//! *successful* invoke result. UI code expecting an array then receives
//! `{error: ...}` and dies on `.map()` — which surfaces as a blank window
//! rather than a handled error.
//!
//! Keeping one status-aware implementation here means a sidecar error always
//! arrives in the renderer as a rejected promise.

use crate::state::AppState;
use reqwest::{Response, StatusCode};
use serde_json::Value;

/// Turn a sidecar response into `Ok(body)` for 2xx, `Err(message)` otherwise.
async fn finish(res: Response) -> Result<Value, String> {
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| e.to_string())?;

    if status.is_success() {
        Ok(body)
    } else {
        Err(error_message(&body, status))
    }
}

/// Prefer the sidecar's own `error` field; fall back to the status code.
fn error_message(body: &Value, status: StatusCode) -> String {
    body.get("error")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("sidecar request failed ({status})"))
}

pub async fn fwd_get(state: &AppState, path: &str) -> Result<Value, String> {
    let res = state
        .http
        .get(state.url(path))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    finish(res).await
}

pub async fn fwd_post(state: &AppState, path: &str, body: Value) -> Result<Value, String> {
    let res = state
        .http
        .post(state.url(path))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    finish(res).await
}

pub async fn fwd_patch(state: &AppState, path: &str, body: Value) -> Result<Value, String> {
    let res = state
        .http
        .patch(state.url(path))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    finish(res).await
}

pub async fn fwd_delete(state: &AppState, path: &str) -> Result<Value, String> {
    let res = state
        .http
        .delete(state.url(path))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    finish(res).await
}
