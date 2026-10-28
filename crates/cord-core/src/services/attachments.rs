use std::path::Path;

use rusqlite::{params, OptionalExtension, Row};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::entity::Entity;
use crate::model::Attachment;
use crate::session::Session;
use crate::{Error, Result};

/// Image types an attachment may have.
pub const MIME_TYPES: [&str; 6] = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/avif"];

pub const MAX_BYTES: usize = 25 * 1024 * 1024;

const COLUMNS: &str = "id, vault_id, mime, size, sha256, created_at, deleted_at";

fn attachment(r: &Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: r.get(0)?,
        vault_id: r.get(1)?,
        mime: r.get(2)?,
        size: r.get(3)?,
        sha256: r.get(4)?,
        created_at: r.get(5)?,
        deleted_at: r.get(6)?,
    })
}

/// Store an image. The same bytes in the same vault return the existing row.
/// The file is written before the row, so no row ever points at nothing.
pub fn create(s: &mut Session, vault_id: &str, mime: &str, bytes: &[u8]) -> Result<Attachment> {
    if !MIME_TYPES.contains(&mime) {
        return Err(Error::Invalid(format!("Unsupported attachment type: {mime}")));
    }
    if bytes.len() > MAX_BYTES {
        return Err(Error::Invalid(format!("Attachment too large: {} bytes", bytes.len())));
    }
    let sha = sha256_hex(bytes);
    let sql = format!("SELECT {COLUMNS} FROM attachments WHERE vault_id = ?1 AND sha256 = ?2 AND deleted_at IS NULL");
    if let Some(existing) = s.conn().query_row(&sql, params![vault_id, sha], attachment).optional()? {
        return Ok(existing);
    }
    write_file(&s.attachments_dir()?, &sha, bytes)?;
    let id = nanoid::nanoid!();
    s.write(|w| {
        let now = w.now();
        w.create(Entity::Attachment, vault_id, json!({
            "id": id, "vault_id": vault_id, "sha256": sha, "mime": mime, "size": bytes.len() as i64, "created_at": now,
        }))
    })?;
    let sql = format!("SELECT {COLUMNS} FROM attachments WHERE id = ?1");
    Ok(s.conn().query_row(&sql, [&id], attachment)?)
}

/// The mime type and bytes of a live attachment, for the webview.
pub fn read(s: &Session, id: &str) -> Result<Option<(String, Vec<u8>)>> {
    let row: Option<(String, String)> = s
        .conn()
        .query_row("SELECT mime, sha256 FROM attachments WHERE id = ?1 AND deleted_at IS NULL", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let Some((mime, sha)) = row else { return Ok(None) };
    let stored = std::fs::read(s.attachments_dir()?.join(sha))?;
    Ok(Some((mime, unseal(stored)?)))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Encryption prep: the one place stored file bytes are transformed.
fn seal(plain: &[u8]) -> Vec<u8> {
    plain.to_vec()
}

fn unseal(stored: Vec<u8>) -> Result<Vec<u8>> {
    Ok(stored)
}

fn write_file(dir: &Path, sha: &str, bytes: &[u8]) -> Result<()> {
    let path = dir.join(sha);
    if path.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{sha}.tmp"));
    std::fs::write(&tmp, seal(bytes))?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::test_session;

    #[test]
    fn stores_once_per_vault_and_reads_back() {
        let (_d, mut s) = test_session();
        let a = create(&mut s, "v1", "image/png", b"png-bytes").unwrap();
        assert_eq!(a.sha256, sha256_hex(b"png-bytes"));
        assert_eq!(create(&mut s, "v1", "image/png", b"png-bytes").unwrap().id, a.id);
        let other = create(&mut s, "v2", "image/png", b"png-bytes").unwrap();
        assert_ne!(other.id, a.id);
        assert!(s.attachments_dir().unwrap().join(&a.sha256).exists());
        assert_eq!(read(&s, &a.id).unwrap(), Some(("image/png".into(), b"png-bytes".to_vec())));
        assert_eq!(read(&s, "nope").unwrap(), None);
    }

    #[test]
    fn refuses_other_types_and_huge_files() {
        let (_d, mut s) = test_session();
        assert!(matches!(create(&mut s, "v1", "text/html", b"x"), Err(Error::Invalid(_))));
        assert!(matches!(create(&mut s, "v1", "image/png", &vec![0; MAX_BYTES + 1]), Err(Error::Invalid(_))));
    }

    #[test]
    fn known_digest() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
