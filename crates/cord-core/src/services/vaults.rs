use rusqlite::{OptionalExtension, Row};
use serde_json::{json, Value};

use crate::entity::Entity;
use crate::model::{NewVault, Vault, VaultChanges};
use crate::session::Session;
use crate::{Error, Result};

const COLUMNS: &str = "id, name, description, color, created_at, updated_at, archived_at";

fn vault(r: &Row<'_>) -> rusqlite::Result<Vault> {
    Ok(Vault {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        color: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
        archived_at: r.get(6)?,
    })
}

/// Vaults that are not archived, oldest first.
pub fn list(s: &Session) -> Result<Vec<Vault>> {
    let sql = format!("SELECT {COLUMNS} FROM vaults WHERE archived_at IS NULL ORDER BY created_at, id");
    let mut st = s.conn().prepare(&sql)?;
    let rows = st.query_map([], vault)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(s: &Session, id: &str) -> Result<Option<Vault>> {
    let sql = format!("SELECT {COLUMNS} FROM vaults WHERE id = ?1");
    Ok(s.conn().query_row(&sql, [id], vault).optional()?)
}

pub fn create(s: &mut Session, input: NewVault) -> Result<Vault> {
    let id = nanoid::nanoid!();
    s.write(|w| {
        let now = w.now();
        w.create(Entity::Vault, &id, json!({
            "id": id, "name": input.name, "description": input.description,
            "color": input.color, "created_at": now, "updated_at": now,
        }))
    })?;
    require(s, &id)
}

pub fn update(s: &mut Session, id: &str, input: VaultChanges) -> Result<Vault> {
    require(s, id)?;
    s.write(|w| {
        for (field, value) in [("name", input.name), ("description", input.description), ("color", input.color)] {
            if let Some(v) = value {
                w.set(Entity::Vault, id, id, field, Value::String(v))?;
            }
        }
        Ok(())
    })?;
    require(s, id)
}

pub fn archive(s: &mut Session, id: &str) -> Result<()> {
    require(s, id)?;
    s.write(|w| {
        let now = w.now();
        w.set(Entity::Vault, id, id, "archived_at", json!(now))
    })?;
    Ok(())
}

pub(crate) fn require(s: &Session, id: &str) -> Result<Vault> {
    get(s, id)?.ok_or_else(|| Error::NotFound(format!("vault {id}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::test_session;

    #[test]
    fn creates_lists_updates_and_archives() {
        let (_d, mut s) = test_session();
        let a = create(&mut s, NewVault { name: "Work".into(), color: Some("#4f8ef7".into()), ..Default::default() }).unwrap();
        let b = create(&mut s, NewVault { name: "Home".into(), ..Default::default() }).unwrap();
        assert_eq!(list(&s).unwrap().iter().map(|v| v.name.as_str()).collect::<Vec<_>>(), ["Work", "Home"]);

        let renamed = update(&mut s, &a.id, VaultChanges { name: Some("Job".into()), ..Default::default() }).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.color.as_deref()), ("Job", Some("#4f8ef7")));

        archive(&mut s, &b.id).unwrap();
        assert_eq!(list(&s).unwrap().len(), 1);
        assert!(get(&s, &b.id).unwrap().unwrap().archived_at.is_some());
    }

    #[test]
    fn unknown_vaults_are_not_found() {
        let (_d, mut s) = test_session();
        assert!(matches!(update(&mut s, "nope", VaultChanges::default()), Err(Error::NotFound(_))));
        assert!(matches!(archive(&mut s, "nope"), Err(Error::NotFound(_))));
    }
}
