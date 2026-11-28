//! The `/v1/` requests, and what their failures mean to the sync loop.

use std::fmt;
use std::time::Duration;

use cord_core::sync::wire::{
    ErrorReply, Hello, Login, NewServerVault, PullReply, Push, PushReply, Redeem, SignedIn, VaultInfo, WireChange, PROTOCOL,
};
use reqwest::{RequestBuilder, StatusCode};
use serde::de::DeserializeOwned;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncError {
    /// Server unreachable or failing; retry later.
    Offline(String),
    /// Token missing, expired or revoked.
    SignedOut,
    /// Not (or no longer) a member of the vault.
    Forbidden,
    NotFound,
    /// The server speaks another protocol version.
    UpdateNeeded { server_newer: bool },
    /// The server refused the request; retrying will not help.
    Refused(String),
    /// Something failed on this device.
    Local(String),
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Offline(m) => write!(f, "server unreachable: {m}"),
            Self::SignedOut => f.write_str("signed out of the server"),
            Self::Forbidden => f.write_str("not allowed on this server"),
            Self::NotFound => f.write_str("not found on the server"),
            Self::UpdateNeeded { server_newer: true } => f.write_str("update Cord to sync with this server"),
            Self::UpdateNeeded { server_newer: false } => f.write_str("this server needs updating"),
            Self::Refused(m) => write!(f, "the server refused: {m}"),
            Self::Local(m) => f.write_str(m),
        }
    }
}

impl From<String> for SyncError {
    fn from(m: String) -> Self {
        Self::Local(m)
    }
}

pub struct Client {
    http: reqwest::Client,
    base: String,
    token: Option<String>,
}

impl Client {
    pub fn new(base: &str, token: Option<String>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("the HTTP client builds");
        Self { http, base: base.trim_end_matches('/').to_owned(), token }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    /// The websocket address for the live channel.
    pub fn live_url(&self) -> String {
        let url = self.url("/v1/live");
        match url.strip_prefix("https://") {
            Some(rest) => format!("wss://{rest}"),
            None => url.replacen("http://", "ws://", 1),
        }
    }

    pub fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    async fn send<T: DeserializeOwned>(&self, req: RequestBuilder) -> Result<T, SyncError> {
        let req = match &self.token {
            Some(t) => req.bearer_auth(t),
            None => req,
        };
        let r = req.send().await.map_err(|e| SyncError::Offline(e.without_url().to_string()))?;
        let status = r.status();
        if status.is_success() {
            return r.json().await.map_err(|e| SyncError::Refused(format!("unreadable reply: {e}")));
        }
        match status {
            StatusCode::UNAUTHORIZED => Err(SyncError::SignedOut),
            StatusCode::FORBIDDEN => Err(SyncError::Forbidden),
            StatusCode::NOT_FOUND => Err(SyncError::NotFound),
            s => {
                let message = r.json::<ErrorReply>().await.map(|e| e.error).unwrap_or_else(|_| s.to_string());
                if s.is_server_error() { Err(SyncError::Offline(message)) } else { Err(SyncError::Refused(message)) }
            }
        }
    }

    /// The server's hello, refused when the protocol versions differ.
    pub async fn hello(&self) -> Result<Hello, SyncError> {
        let hello: Hello = self.send(self.http.get(self.url("/v1/hello"))).await?;
        if hello.protocol != PROTOCOL {
            return Err(SyncError::UpdateNeeded { server_newer: hello.protocol > PROTOCOL });
        }
        Ok(hello)
    }

    pub async fn redeem(&self, code: &str, username: &str, password: &str, device_name: &str) -> Result<SignedIn, SyncError> {
        let body = Redeem { code: code.into(), username: username.into(), password: password.into(), device_name: device_name.into() };
        self.send(self.http.post(self.url("/v1/invites/redeem")).json(&body)).await
    }

    pub async fn login(&self, username: &str, password: &str, device_name: &str) -> Result<SignedIn, SyncError> {
        let body = Login { username: username.into(), password: password.into(), device_name: device_name.into() };
        self.send(self.http.post(self.url("/v1/login")).json(&body)).await
    }

    pub async fn logout(&self) -> Result<(), SyncError> {
        let _: serde_json::Value = self.send(self.http.post(self.url("/v1/logout"))).await?;
        Ok(())
    }

    pub async fn vaults(&self) -> Result<Vec<VaultInfo>, SyncError> {
        self.send(self.http.get(self.url("/v1/vaults"))).await
    }

    pub async fn create_vault(&self, id: &str, name: &str) -> Result<VaultInfo, SyncError> {
        let body = NewServerVault { id: id.into(), name: name.into() };
        self.send(self.http.post(self.url("/v1/vaults")).json(&body)).await
    }

    pub async fn push(&self, vault: &str, changes: Vec<WireChange>) -> Result<PushReply, SyncError> {
        self.send(self.http.post(self.url(&format!("/v1/vaults/{vault}/changes"))).json(&Push { changes })).await
    }

    pub async fn pull(&self, vault: &str, after: i64) -> Result<PullReply, SyncError> {
        self.send(self.http.get(self.url(&format!("/v1/vaults/{vault}/changes?after={after}")))).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_url_follows_the_scheme() {
        assert_eq!(Client::new("https://a.org/", None).live_url(), "wss://a.org/v1/live");
        assert_eq!(Client::new("http://localhost:8787", None).live_url(), "ws://localhost:8787/v1/live");
    }

    #[tokio::test]
    async fn an_unreachable_server_is_offline() {
        // Port 9 (discard) is not served on test machines.
        let c = Client::new("http://127.0.0.1:9", None);
        assert!(matches!(c.hello().await, Err(SyncError::Offline(_))));
    }
}
