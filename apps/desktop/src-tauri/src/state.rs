use std::sync::Arc;

pub struct AppState {
    pub sidecar_url: String,
    pub http: Arc<reqwest::Client>,
}

impl AppState {
    pub fn new(port: u16) -> Self {
        Self {
            sidecar_url: format!("http://127.0.0.1:{port}"),
            http: Arc::new(reqwest::Client::new()),
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.sidecar_url)
    }
}
