//! The `/v1/` routes. Thin: read the request, call auth or log, reply.

use axum::extract::{DefaultBodyLimit, FromRequestParts, Path, Query, State, WebSocketUpgrade};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use cord_core::sync::wire::{Hello, Login, NewServerVault, PullReply, Push, PushReply, Redeem, SignedIn, VaultInfo, PROTOCOL};
use cord_core::rusqlite::Connection;
use serde::Deserialize;

use crate::db::now;
use crate::error::ApiError;
use crate::{auth, live, log, Shared};

/// 4 MB of payload is about 5.4 MB as base64, plus the JSON around it.
const BODY_LIMIT: usize = 8 * 1024 * 1024;

pub fn router(server: Shared) -> Router {
    Router::new()
        .route("/v1/hello", get(hello))
        .route("/v1/invites/redeem", post(redeem))
        .route("/v1/login", post(login))
        .route("/v1/logout", post(logout))
        .route("/v1/vaults", get(list_vaults).post(create_vault))
        .route("/v1/vaults/{id}/changes", get(pull).post(push))
        .route("/v1/live", get(live_socket))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(server)
}

/// Run database work off the async threads.
async fn with_db<T: Send + 'static>(
    server: &Shared,
    f: impl FnOnce(&Connection) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let server = server.clone();
    tokio::task::spawn_blocking(move || {
        let db = server.db.lock().map_err(|_| ApiError::Internal)?;
        f(&db)
    })
    .await
    .map_err(|_| ApiError::Internal)?
}

/// A signed-in request: the user and the token they used.
pub struct Auth {
    pub user: String,
    pub token: String,
}

impl FromRequestParts<Shared> for Auth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, server: &Shared) -> Result<Self, ApiError> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(ApiError::SignedOut)?
            .to_owned();
        let t = token.clone();
        let user = with_db(server, move |db| Ok(auth::user_for_token(db, &t, now())?)).await?;
        let user = user.ok_or(ApiError::SignedOut)?;
        Ok(Self { user, token })
    }
}

async fn hello(State(server): State<Shared>) -> Json<Hello> {
    Json(Hello { protocol: PROTOCOL, server_id: server.server_id.clone() })
}

async fn redeem(State(server): State<Shared>, Json(req): Json<Redeem>) -> Result<Json<SignedIn>, ApiError> {
    let cost = server.hash_cost;
    let (user_id, token) = with_db(&server, move |db| {
        auth::redeem(db, &req.code, &req.username, &req.password, &req.device_name, cost, now())
    })
    .await?;
    eprintln!("[server] new account {user_id}");
    Ok(Json(SignedIn { token, user_id }))
}

async fn login(State(server): State<Shared>, Json(req): Json<Login>) -> Result<Json<SignedIn>, ApiError> {
    let (user_id, token) =
        with_db(&server, move |db| auth::login(db, &req.username, &req.password, &req.device_name, now())).await?;
    Ok(Json(SignedIn { token, user_id }))
}

async fn logout(State(server): State<Shared>, a: Auth) -> Result<Json<serde_json::Value>, ApiError> {
    with_db(&server, move |db| Ok(auth::logout(db, &a.token, now())?)).await?;
    Ok(Json(serde_json::json!({})))
}

async fn list_vaults(State(server): State<Shared>, a: Auth) -> Result<Json<Vec<VaultInfo>>, ApiError> {
    Ok(Json(with_db(&server, move |db| Ok(log::vaults_for(db, &a.user)?)).await?))
}

async fn create_vault(State(server): State<Shared>, a: Auth, Json(req): Json<NewServerVault>) -> Result<Json<VaultInfo>, ApiError> {
    Ok(Json(with_db(&server, move |db| log::create_vault(db, &a.user, &req.id, &req.name, now())).await?))
}

async fn push(State(server): State<Shared>, a: Auth, Path(vault): Path<String>, Json(req): Json<Push>) -> Result<Json<PushReply>, ApiError> {
    let v = vault.clone();
    let appended = with_db(&server, move |db| log::append(db, &a.user, &v, &req.changes, now())).await?;
    if appended.grew {
        server.live.notify(&vault, appended.seq);
    }
    Ok(Json(appended.reply))
}

#[derive(Deserialize)]
struct After {
    #[serde(default)]
    after: i64,
}

async fn pull(State(server): State<Shared>, a: Auth, Path(vault): Path<String>, Query(q): Query<After>) -> Result<Json<PullReply>, ApiError> {
    let page = with_db(&server, move |db| {
        if log::role(db, &a.user, &vault)?.is_none() {
            return Err(ApiError::Forbidden);
        }
        Ok(log::read_after(db, &vault, q.after)?)
    })
    .await?;
    Ok(Json(PullReply { changes: page.changes, more: page.more }))
}

async fn live_socket(State(server): State<Shared>, a: Auth, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| live::run(socket, server, a.user))
}
