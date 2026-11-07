//! One unlocked user's data, and the single path every local write takes.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde_json::Value;

use crate::changes::{self, ChangeKind, NewChange};
use crate::clock;
use crate::entity::{self, Entity};
use crate::hlc::{Hlc, HlcClock};
use crate::index::{reindex_all, reindex_stale, Report};
use crate::layout::DataLayout;
use crate::store::{open_user, DbKey, UserDb};
use crate::{Error, Result};

pub struct Session {
    db: UserDb,
    clock: HlcClock,
    device_id: String,
    user_id: String,
    layout: DataLayout,
}

/// What one write transaction can do. Every method applies and records together.
pub struct Writer<'a> {
    conn: &'a Connection,
    clock: &'a mut HlcClock,
    device_id: &'a str,
    user_id: &'a str,
    now: i64,
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

impl Session {
    /// Open a user's files, bring the index up to date and resume the clock.
    pub fn open(layout: &DataLayout, device_id: &str, user_id: &str, key: Option<&DbKey>) -> Result<(Self, Report)> {
        let db = open_user(layout, user_id, key)?;
        let report = if db.index_rebuilt { reindex_all(&db.conn)? } else { reindex_stale(&db.conn)? };
        let latest = clock::latest(&db.conn)?;
        let session = Self {
            clock: HlcClock::resume(device_id, latest.as_ref()),
            db,
            device_id: device_id.to_owned(),
            user_id: user_id.to_owned(),
            layout: layout.clone(),
        };
        Ok((session, report))
    }

    pub fn conn(&self) -> &Connection {
        &self.db.conn
    }

    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    pub fn attachments_dir(&self) -> Result<PathBuf> {
        self.layout.attachments_dir(&self.user_id)
    }

    pub fn now(&self) -> i64 {
        now_ms()
    }

    /// Run `f` in one transaction. An error rolls everything back.
    pub fn write<T>(&mut self, f: impl FnOnce(&mut Writer<'_>) -> Result<T>) -> Result<T> {
        let tx = self.db.conn.unchecked_transaction()?;
        let mut writer = Writer {
            conn: &tx,
            clock: &mut self.clock,
            device_id: &self.device_id,
            user_id: &self.user_id,
            now: now_ms(),
        };
        let out = f(&mut writer)?;
        tx.commit()?;
        Ok(out)
    }
}

impl Writer<'_> {
    pub fn conn(&self) -> &Connection {
        self.conn
    }

    pub fn now(&self) -> i64 {
        self.now
    }

    /// Insert a row. False when it already existed (nothing recorded).
    pub fn create(&mut self, entity: Entity, vault_id: &str, row: Value) -> Result<bool> {
        let hlc = self.tick();
        let id = entity::row_id(entity, &row)?;
        if !entity::apply_create(self.conn, entity, &row, &hlc)? {
            return Ok(false);
        }
        self.record(vault_id, entity, &id, ChangeKind::Create, None, &hlc, &to_bytes(&row)?)?;
        Ok(true)
    }

    /// Set one field. False when it was not applied (nothing recorded).
    pub fn set(&mut self, entity: Entity, vault_id: &str, entity_id: &str, field: &str, value: Value) -> Result<bool> {
        let hlc = self.tick();
        if !entity::apply_field(self.conn, entity, entity_id, field, &value, &hlc)? {
            return Ok(false);
        }
        self.record(vault_id, entity, entity_id, ChangeKind::FieldSet, Some(field), &hlc, &to_bytes(&value)?)?;
        Ok(true)
    }

    /// Merge a Yjs update into a note body. False when the note is purged.
    pub fn body(&mut self, vault_id: &str, note_id: &str, update: &[u8]) -> Result<bool> {
        let hlc = self.tick();
        if !entity::apply_body(self.conn, note_id, update, &hlc)? {
            return Ok(false);
        }
        self.record(vault_id, Entity::Note, note_id, ChangeKind::BodyUpdate, None, &hlc, update)?;
        Ok(true)
    }

    fn tick(&mut self) -> Hlc {
        self.clock.tick(self.now as u64)
    }

    #[allow(clippy::too_many_arguments)]
    fn record(&self, vault_id: &str, entity: Entity, entity_id: &str, kind: ChangeKind, field: Option<&str>, hlc: &Hlc, payload: &[u8]) -> Result<()> {
        let change = NewChange {
            vault_id,
            entity_type: entity.as_str(),
            entity_id,
            kind,
            field,
            hlc,
            author_device_id: self.device_id,
            author_user_id: self.user_id,
            payload,
        };
        changes::record(self.conn, &change, self.now)?;
        Ok(())
    }
}

fn to_bytes(v: &Value) -> Result<Vec<u8>> {
    serde_json::to_vec(v).map_err(|e| Error::BadDoc(e.to_string()))
}

#[cfg(test)]
pub(crate) fn test_session() -> (tempfile::TempDir, Session) {
    let dir = tempfile::tempdir().unwrap();
    let (session, _) = Session::open(&DataLayout::new(dir.path()), "dev", "u1", None).unwrap();
    (dir, session)
}

/// Make `vault_id` sync two-way to a fake connection so writes are recorded.
#[cfg(test)]
pub(crate) fn connect(s: &Session, vault_id: &str) {
    s.conn()
        .execute(
            "INSERT INTO vault_connections (vault_id, connection_id, server_vault_id, mode, role, created_at)
             VALUES (?1, 'c1', 'sv', 'two_way', 'owner', 1)",
            [vault_id],
        )
        .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn count(s: &Session, sql: &str) -> i64 {
        s.conn().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn vault_row(id: &str) -> Value {
        json!({ "id": id, "name": "V", "created_at": 1, "updated_at": 1 })
    }

    #[test]
    fn a_write_applies_and_records_together() {
        let (_d, mut s) = test_session();
        connect(&s, "v1");
        s.write(|w| {
            w.create(Entity::Vault, "v1", vault_row("v1"))?;
            w.set(Entity::Vault, "v1", "v1", "name", json!("Renamed"))
        })
        .unwrap();
        assert_eq!(count(&s, "SELECT count(*) FROM changes"), 2);
        assert_eq!(count(&s, "SELECT count(*) FROM changes WHERE kind = 'field_set' AND field = 'name'"), 1);
        let name: String = s.conn().query_row("SELECT name FROM vaults", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Renamed");
    }

    #[test]
    fn an_error_rolls_the_whole_write_back() {
        let (_d, mut s) = test_session();
        connect(&s, "v1");
        let r = s.write(|w| {
            w.create(Entity::Vault, "v1", vault_row("v1"))?;
            w.set(Entity::Vault, "v1", "v1", "nope", json!(1))
        });
        assert!(matches!(r, Err(Error::BadField(_))));
        assert_eq!(count(&s, "SELECT count(*) FROM vaults"), 0);
        assert_eq!(count(&s, "SELECT count(*) FROM changes"), 0);
        assert_eq!(count(&s, "SELECT count(*) FROM field_clocks"), 0);
    }

    #[test]
    fn unsynced_vaults_record_nothing() {
        let (_d, mut s) = test_session();
        s.write(|w| w.create(Entity::Vault, "v1", vault_row("v1"))).unwrap();
        assert_eq!(count(&s, "SELECT count(*) FROM vaults"), 1);
        assert_eq!(count(&s, "SELECT count(*) FROM changes"), 0);
    }

    #[test]
    fn a_repeated_create_records_nothing() {
        let (_d, mut s) = test_session();
        connect(&s, "v1");
        s.write(|w| w.create(Entity::Vault, "v1", vault_row("v1"))).unwrap();
        assert!(!s.write(|w| w.create(Entity::Vault, "v1", vault_row("v1"))).unwrap());
        assert_eq!(count(&s, "SELECT count(*) FROM changes"), 1);
    }

    #[test]
    fn the_clock_resumes_after_reopening() {
        let dir = tempfile::tempdir().unwrap();
        let layout = DataLayout::new(dir.path());
        let first = {
            let (mut s, _) = Session::open(&layout, "dev", "u1", None).unwrap();
            s.write(|w| w.create(Entity::Vault, "v1", vault_row("v1"))).unwrap();
            clock::latest(s.conn()).unwrap().unwrap()
        };
        let (mut s, _) = Session::open(&layout, "dev", "u1", None).unwrap();
        s.write(|w| w.set(Entity::Vault, "v1", "v1", "name", json!("x"))).unwrap();
        assert!(clock::get(s.conn(), "v1", "name").unwrap().unwrap() > first);
    }
}
