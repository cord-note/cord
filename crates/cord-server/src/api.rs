//! The `/v1/` routes.

use axum::Router;

use crate::Shared;

pub fn router(server: Shared) -> Router {
    Router::new().with_state(server)
}
