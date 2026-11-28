//! Request errors and how they look on the wire.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use cord_core::sync::wire::ErrorReply;

#[derive(Debug, PartialEq, Eq)]
pub enum ApiError {
    /// No token, or a revoked one.
    SignedOut,
    /// Signed in, but not allowed here.
    Forbidden,
    NotFound,
    BadRequest(String),
    Conflict(String),
    Internal,
}

impl ApiError {
    fn parts(&self) -> (StatusCode, String) {
        match self {
            Self::SignedOut => (StatusCode::UNAUTHORIZED, "sign in again".into()),
            Self::Forbidden => (StatusCode::FORBIDDEN, "not allowed".into()),
            Self::NotFound => (StatusCode::NOT_FOUND, "not found".into()),
            Self::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            Self::Conflict(m) => (StatusCode::CONFLICT, m.clone()),
            Self::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "server error".into()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error) = self.parts();
        (status, Json(ErrorReply { error })).into_response()
    }
}

/// Database trouble is logged without content and shown as a plain server error.
impl From<cord_core::Error> for ApiError {
    fn from(e: cord_core::Error) -> Self {
        eprintln!("[server] {e}");
        Self::Internal
    }
}

impl From<cord_core::rusqlite::Error> for ApiError {
    fn from(e: cord_core::rusqlite::Error) -> Self {
        eprintln!("[server] database: {e}");
        Self::Internal
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses() {
        assert_eq!(ApiError::SignedOut.parts().0, StatusCode::UNAUTHORIZED);
        assert_eq!(ApiError::BadRequest("x".into()).parts(), (StatusCode::BAD_REQUEST, "x".into()));
    }
}
