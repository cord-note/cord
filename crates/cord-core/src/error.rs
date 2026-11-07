/// Everything cord-core can fail with.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("bad clock stamp: {0}")]
    BadHlc(String),
    #[error("bad id: {0}")]
    BadId(String),
    #[error("database is version {found}, this build supports up to {supported}")]
    TooNew { found: i64, supported: i64 },
    #[error("bad document: {0}")]
    BadDoc(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("unknown field: {0}")]
    BadField(String),
    #[error("no such row yet: {0}")]
    MissingRow(String),
}

pub type Result<T> = std::result::Result<T, Error>;
