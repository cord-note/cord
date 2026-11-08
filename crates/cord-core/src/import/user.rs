//! One user's data from the old file into their new `cord.db` and `index.db`.

use std::path::Path;

use rusqlite::Connection;
use serde_json::Value;

use super::legacy::{self, Row};
use crate::doc::ids::mint_block_ids;
use crate::doc::yjs::json_to_state;
use crate::entity::{self, Entity};
use crate::hlc::Hlc;
use crate::index::reindex_all;
use crate::layout::DataLayout;
use crate::services::attachments;
use crate::services::notes::EMPTY_DOC_JSON;
use crate::store::open_user;
use crate::{Error, Result};

#[derive(Debug, Default)]
pub struct Counts {
    pub vaults: usize,
    pub notes: usize,
    pub missing_files: Vec<String>,
}

/// Build `user_id`'s files under `staging`, in one transaction.
/// `fallback` owns vaults that have no (or an unknown) owner.
pub fn import_user(old: &Connection, old_root: &Path, staging: &DataLayout, user_id: &str, fallback: &str, hlc: &Hlc) -> Result<Counts> {
    let db = open_user(staging, user_id, None)?;
    let tx = db.conn.unchecked_transaction()?;
    let p = [user_id, fallback];
    let mut counts = Counts::default();

    for row in legacy::rows(old, &legacy::vaults_sql(), &p)? {
        create(&tx, Entity::Vault, row, hlc)?;
        counts.vaults += 1;
    }
    for mut row in legacy::rows(old, &legacy::notes_sql(), &p)? {
        let id = text(&row, "id")?;
        let updated_at = row.get("updated_at").and_then(Value::as_i64).unwrap_or(0);
        let body = row.remove("body_json").unwrap_or(Value::Null);
        let state = body_state(&id, body.as_str().unwrap_or("{}"))?;
        create(&tx, Entity::Note, row, hlc)?;
        entity::seed_body(&tx, &id, &state, updated_at)?;
        counts.notes += 1;
    }

    let assignments: [(Entity, String); 4] = [
        (Entity::Tag, legacy::tags_sql()),
        (Entity::NoteTag, legacy::note_tags_sql()),
        (Entity::BlockTag, legacy::block_tags_sql()),
        (Entity::BlockLink, legacy::block_links_sql()),
    ];
    for (entity, sql) in assignments {
        for row in legacy::rows(old, &sql, &p)? {
            create(&tx, entity, row, hlc)?;
        }
    }

    let images = staging.attachments_dir(user_id)?;
    for row in legacy::rows(old, &legacy::attachments_sql(), &p)? {
        let id = text(&row, "id")?;
        let sha = text(&row, "sha256")?;
        let file = extension(&text(&row, "mime")?).map(|ext| old_root.join("attachments").join(format!("{id}.{ext}")));
        match file.filter(|f| f.is_file()) {
            Some(f) => attachments::write_file(&images, &sha, &std::fs::read(f)?)?,
            None => counts.missing_files.push(id),
        }
        create(&tx, Entity::Attachment, row, hlc)?;
    }

    let report = reindex_all(&tx)?;
    if !report.failed.is_empty() {
        return Err(Error::BadDoc(format!("could not index note(s) {}", report.failed.join(", "))));
    }
    tx.commit()?;
    Ok(counts)
}

fn create(conn: &Connection, entity: Entity, row: Row, hlc: &Hlc) -> Result<()> {
    entity::apply_create(conn, entity, &Value::Object(row), hlc)?;
    Ok(())
}

fn text(row: &Row, key: &str) -> Result<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| Error::BadField(format!("old row has no {key}")))
}

/// An old `body_json` as Yjs state, with block ids wherever it had none.
fn body_state(note_id: &str, body_json: &str) -> Result<Vec<u8>> {
    let bad = |e: &dyn std::fmt::Display| Error::BadDoc(format!("note {note_id}: {e}"));
    let mut doc: Value = serde_json::from_str(body_json).map_err(|e| bad(&e))?;
    // 2.x's column default; a note never edited still holds it.
    if doc.get("type").is_none() {
        doc = serde_json::from_str(EMPTY_DOC_JSON).map_err(|e| bad(&e))?;
    }
    mint_block_ids(&mut doc);
    json_to_state(&doc).map_err(|e| bad(&e))
}

/// The extension 2.x gave an image file of this type.
fn extension(mime: &str) -> Option<&'static str> {
    Some(match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/avif" => "avif",
        _ => return None,
    })
}
