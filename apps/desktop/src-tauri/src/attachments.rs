//! Serves attachment files to the webview through the `cord-attachment` URI
//! scheme. The sidecar writes them to `attachments/` beside the database and
//! names each `<id>.<ext>`; this only finds and reads them.

use std::path::{Path, PathBuf};

use tauri::http::{header, Response, StatusCode};

/// The `attachments` folder next to the database the sidecar reported.
pub fn attachments_dir(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .map(|p| p.join("attachments"))
        .unwrap_or_else(|| PathBuf::from("attachments"))
}

/// Attachment ids are nanoids; anything else (paths, dots) is refused.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn mime_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

/// The file whose stem is exactly `id`, whatever its extension.
pub fn find_file(dir: &Path, id: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(id))
}

/// The response for a `cord-attachment://<id>` request. `dir` is `None` until
/// the sidecar has reported where the database lives.
pub fn respond(dir: Option<&Path>, id: &str) -> Response<Vec<u8>> {
    let status = |code: StatusCode| Response::builder().status(code).body(Vec::new()).unwrap();
    let Some(dir) = dir else { return status(StatusCode::SERVICE_UNAVAILABLE) };
    if !is_valid_id(id) {
        return status(StatusCode::NOT_FOUND);
    }
    let Some(path) = find_file(dir, id) else { return status(StatusCode::NOT_FOUND) };
    let Ok(bytes) = std::fs::read(&path) else { return status(StatusCode::NOT_FOUND) };
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_for(ext))
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(bytes)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cord-attach-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_nanoid_shaped_ids_only() {
        assert!(is_valid_id("V1StGXR8_Z5jdHi6B-myT"));
        assert!(is_valid_id(&"a".repeat(64)));
        for bad in ["", "..", "../x", "a/b", r"a\b", "a.png", "a b"] {
            assert!(!is_valid_id(bad), "{bad:?} should be refused");
        }
        assert!(!is_valid_id(&"a".repeat(65)));
    }

    #[test]
    fn finds_a_file_by_exact_stem() {
        let dir = temp_dir("find");
        std::fs::write(dir.join("abc.png"), b"x").unwrap();
        std::fs::write(dir.join("abcd.jpg"), b"y").unwrap();

        assert_eq!(find_file(&dir, "abc"), Some(dir.join("abc.png")));
        assert_eq!(find_file(&dir, "abcd"), Some(dir.join("abcd.jpg")));
        assert_eq!(find_file(&dir, "ab"), None);
        assert_eq!(find_file(&dir, "missing"), None);
        assert_eq!(find_file(&dir.join("nope"), "abc"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn maps_extensions_to_mime_types() {
        assert_eq!(mime_for("png"), "image/png");
        assert_eq!(mime_for("jpg"), "image/jpeg");
        assert_eq!(mime_for("jpeg"), "image/jpeg");
        assert_eq!(mime_for("svg"), "image/svg+xml");
        assert_eq!(mime_for("exe"), "application/octet-stream");
    }

    #[test]
    fn responds_with_the_file_or_an_error_status() {
        let dir = temp_dir("respond");
        std::fs::write(dir.join("img1.webp"), b"bytes").unwrap();

        let ok = respond(Some(&dir), "img1");
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.headers()[header::CONTENT_TYPE], "image/webp");
        assert_eq!(ok.body(), b"bytes");

        assert_eq!(respond(Some(&dir), "nope").status(), StatusCode::NOT_FOUND);
        assert_eq!(respond(Some(&dir), "../img1").status(), StatusCode::NOT_FOUND);
        assert_eq!(respond(None, "img1").status(), StatusCode::SERVICE_UNAVAILABLE);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn places_attachments_beside_the_database() {
        let db = Path::new("/home/u/.cord/cord.db");
        assert_eq!(attachments_dir(db), Path::new("/home/u/.cord/attachments"));
    }
}
