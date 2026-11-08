//! One-time import of a Cord 2.x install (`cord.db`) into the new files.
//!
//! Runs when `cord.db` exists and `machine.db` does not. Everything is built
//! in `import-staging/` and moved into place only when every user imported
//! cleanly. `machine.db` is moved last, so an import that stops part-way runs
//! again from the start. The old files are only ever copied, never written.

mod legacy;
mod user;

#[cfg(test)]
mod fixture;

use std::path::Path;

use crate::device;
use crate::hlc::Hlc;
use crate::layout::DataLayout;
use crate::session::now_ms;
use crate::store::open_machine;
use crate::Result;

const STAGING: &str = "import-staging";

/// What the import brought over, for the log.
#[derive(Debug, Default)]
pub struct Report {
    pub users: usize,
    pub vaults: usize,
    pub notes: usize,
    /// Images whose file was already gone in 2.x. Their rows are kept.
    pub missing_files: Vec<String>,
    /// Notes left only in the old file: their vault is gone, or no user exists.
    pub not_imported_notes: i64,
}

pub fn run(root: &Path) -> Result<Report> {
    let staging = root.join(STAGING);
    remove_path(&staging)?;
    let result = build(root, &staging).and_then(|(report, users)| {
        commit(root, &staging, &users)?;
        Ok(report)
    });
    let _ = std::fs::remove_dir_all(&staging);
    result
}

fn build(root: &Path, staging_root: &Path) -> Result<(Report, Vec<String>)> {
    let old = legacy::open_copy(&root.join("cord.db"), &staging_root.join("legacy"))?;
    let staging = DataLayout::new(staging_root);
    let now = now_ms();

    let machine = open_machine(&staging)?;
    let users = legacy::rows(&old, legacy::USERS, &[])?;
    for row in &users {
        legacy::insert(&machine, "users", row)?;
    }
    for row in legacy::rows(&old, legacy::APP_STATE, &[])? {
        legacy::insert(&machine, "app_state", &row)?;
    }
    let device = device::device_id(&machine, now)?;
    drop(machine);

    let hlc = Hlc { wall: u64::try_from(now).unwrap_or(0), counter: 0, device };
    let ids: Vec<String> = users.iter().filter_map(|u| u.get("id")?.as_str().map(str::to_owned)).collect();
    let fallback = ids.first().cloned().unwrap_or_default();
    let mut report = Report { users: ids.len(), ..Report::default() };
    for id in &ids {
        seed_settings(root, &staging, id)?;
        let counts = user::import_user(&old, root, &staging, id, &fallback, &hlc)?;
        report.vaults += counts.vaults;
        report.notes += counts.notes;
        report.missing_files.extend(counts.missing_files);
    }
    report.not_imported_notes = legacy::count(&old, legacy::ALL_NOTES)? - i64::try_from(report.notes).unwrap_or(i64::MAX);
    Ok((report, ids))
}

/// 2.x gave a user with no folder yet a copy of the shared settings files.
fn seed_settings(root: &Path, staging: &DataLayout, user_id: &str) -> Result<()> {
    if DataLayout::new(root).user_dir(user_id)?.exists() {
        return Ok(());
    }
    let dir = staging.user_dir(user_id)?;
    std::fs::create_dir_all(&dir)?;
    for name in ["settings.json", "keybindings.json"] {
        let shared = root.join(name);
        if shared.is_file() {
            std::fs::copy(&shared, dir.join(name))?;
        }
    }
    Ok(())
}

/// Files the import owns in a user folder. Anything already there under these
/// names is left over from an import that stopped before `machine.db`.
const OWNED: [&str; 7] = ["cord.db", "cord.db-wal", "cord.db-shm", "index.db", "index.db-wal", "index.db-shm", "attachments"];

fn commit(root: &Path, staging_root: &Path, users: &[String]) -> Result<()> {
    let live = DataLayout::new(root);
    let staged = DataLayout::new(staging_root);
    for id in users {
        let from = staged.user_dir(id)?;
        let to = live.user_dir(id)?;
        std::fs::create_dir_all(&to)?;
        for entry in std::fs::read_dir(&from)? {
            let entry = entry?;
            let name = entry.file_name();
            let dest = to.join(&name);
            if OWNED.iter().any(|o| name == *o) {
                remove_path(&dest)?;
            } else if dest.exists() {
                continue; // never replace a user's own settings
            }
            std::fs::rename(entry.path(), dest)?;
        }
    }
    for suffix in ["-wal", "-shm", ""] {
        let mut from = staged.machine_db().into_os_string();
        from.push(suffix);
        let mut to = live.machine_db().into_os_string();
        to.push(suffix);
        if Path::new(&from).exists() {
            std::fs::rename(&from, &to)?;
        }
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::{password, Accounts};
    use crate::doc::yjs::state_to_json;
    use crate::import::fixture::{legacy, para};
    use crate::store::open_user;

    fn count(c: &rusqlite::Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn files(root: &Path) -> Vec<Vec<u8>> {
        ["cord.db", "cord.db-wal"].iter().map(|f| std::fs::read(root.join(f)).unwrap()).collect()
    }

    #[test]
    fn imports_users_vaults_and_notes() {
        let old = legacy();
        let hash = password::hash("pw-long-enough", 4).unwrap();
        old.user("u1", "ola", &hash, 1);
        old.user("u2", "kai", &hash, 2);
        old.exec("UPDATE users SET pin_hash = password_hash, failed_pin_attempts = 2 WHERE id = 'u1';
                  INSERT INTO app_state VALUES ('last_user_id', 'u2', 5);");
        old.vault("v1", Some("u1"), "Ola's");
        old.vault("v2", Some("u2"), "Kai's");
        old.vault("v0", None, "From before accounts");
        old.note("n1", "v1", "Hello", &para("b1", "pelican"));
        old.note("n2", "v2", "Kai", &para("b2", "heron"));
        old.note("n0", "v0", "Old", &para("b0", "egret"));
        old.exec("UPDATE notes SET kind = 'notepad', is_pinned = 1 WHERE id = 'n1';
                  UPDATE notes SET deleted_at = 300 WHERE id = 'n2';");

        let report = run(old.root()).unwrap();
        assert_eq!((report.users, report.vaults, report.notes, report.not_imported_notes), (2, 3, 3, 0));

        let layout = DataLayout::new(old.root());
        let machine = open_machine(&layout).unwrap();
        let accounts = Accounts::new(&machine, &layout);
        // Checked first: signing in makes that user the last one.
        assert_eq!(accounts.lock_screen().unwrap().last_user_id.as_deref(), Some("u2"));
        assert_eq!(accounts.login("ola", "pw-long-enough").unwrap().id, "u1");
        assert!(accounts.unlock_with_pin("u1", "pw-long-enough").unwrap().ok, "the PIN hash carried over");
        assert_eq!(count(&machine, "SELECT count(*) FROM app_state WHERE key = 'device_id'"), 1);

        // u1 is the oldest user, so the ownerless vault is theirs.
        let db = open_user(&layout, "u1", None).unwrap();
        assert_eq!(count(&db.conn, "SELECT count(*) FROM vaults"), 2);
        let (title, kind, pinned, created, updated): (String, String, i64, i64, i64) = db
            .conn
            .query_row("SELECT title, kind, is_pinned, created_at, updated_at FROM notes WHERE id = 'n1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap();
        assert_eq!((title.as_str(), kind.as_str(), pinned, created, updated), ("Hello", "notepad", 1, 100, 200));
        let state: Vec<u8> = db.conn.query_row("SELECT yjs_state FROM note_bodies WHERE note_id = 'n1'", [], |r| r.get(0)).unwrap();
        let body = state_to_json(&state).unwrap();
        assert_eq!(body["content"][0]["attrs"]["blockId"], "b1");
        assert_eq!(body["content"][0]["content"][0]["text"], "pelican");
        // The index is built, so search finds imported text.
        assert_eq!(count(&db.conn, "SELECT count(*) FROM idx.blocks_fts f WHERE f.text MATCH '\"elica\"'"), 1);

        let db2 = open_user(&layout, "u2", None).unwrap();
        let deleted: Option<i64> = db2.conn.query_row("SELECT deleted_at FROM notes WHERE id = 'n2'", [], |r| r.get(0)).unwrap();
        assert_eq!(deleted, Some(300));
        assert_eq!(count(&db2.conn, "SELECT count(*) FROM changes"), 0, "nothing is queued to sync");
    }

    #[test]
    fn gives_old_bodies_block_ids_and_keeps_existing_ones() {
        let old = legacy();
        old.user("u1", "ola", "h", 1);
        old.vault("v1", Some("u1"), "V");
        old.note("empty", "v1", "Never edited", "{}");
        old.note(
            "list",
            "v1",
            "List",
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"no id"}]},{"type":"paragraph","attrs":{"blockId":"keep"}}]}"#,
        );
        run(old.root()).unwrap();

        let db = open_user(&DataLayout::new(old.root()), "u1", None).unwrap();
        let body = |id: &str| -> serde_json::Value {
            let s: Vec<u8> = db.conn.query_row("SELECT yjs_state FROM note_bodies WHERE note_id = ?1", [id], |r| r.get(0)).unwrap();
            state_to_json(&s).unwrap()
        };
        let empty = body("empty");
        assert_eq!(empty["content"][0]["type"], "paragraph");
        assert_eq!(empty["content"][0]["attrs"]["blockId"].as_str().map(str::len), Some(10));
        let list = body("list");
        assert_eq!(list["content"][0]["attrs"]["blockId"].as_str().map(str::len), Some(10));
        assert_eq!(list["content"][1]["attrs"]["blockId"], "keep");
    }

    #[test]
    fn notes_without_a_vault_or_owner_are_reported() {
        let old = legacy();
        old.note("lost", "nowhere", "Lost", &para("b", "x"));
        let report = run(old.root()).unwrap();
        assert_eq!((report.users, report.notes, report.not_imported_notes), (0, 0, 1));
        assert!(old.root().join("machine.db").is_file());
    }

    #[test]
    fn imports_tags_and_what_points_at_blocks() {
        let old = legacy();
        old.user("u1", "ola", "h", 1);
        old.vault("v1", Some("u1"), "V");
        old.note("n1", "v1", "From", &para("b1", "source"));
        old.note("n2", "v1", "To", &para("b2", "target"));
        old.exec(
            "INSERT INTO tags VALUES ('t1', 'v1', 'idea', '#abc', 1, NULL), ('t2', 'v1', 'old', NULL, 1, 50);
             INSERT INTO note_tags VALUES ('n1', 't1', 2), ('gone', 't1', 2);
             INSERT INTO fragments VALUES ('b1', 'n1', 'v1', 3), ('bx', 'gone', 'v1', 3);
             INSERT INTO fragment_tags VALUES ('b1', 't1', 4), ('bx', 't1', 4);
             INSERT INTO fragment_links VALUES ('l1', 'b1', 'n2', 'b2', 'v1', 5), ('l2', 'bx', 'n2', NULL, 'v1', 5);",
        );
        run(old.root()).unwrap();

        let db = open_user(&DataLayout::new(old.root()), "u1", None).unwrap();
        let c = &db.conn;
        assert_eq!(count(c, "SELECT count(*) FROM tags"), 2);
        assert_eq!(count(c, "SELECT count(*) FROM tags WHERE id = 't2' AND deleted_at = 50"), 1);
        assert_eq!(count(c, "SELECT count(*) FROM note_tags WHERE note_id = 'n1' AND removed_at IS NULL"), 1);
        assert_eq!(count(c, "SELECT count(*) FROM note_tags"), 1, "rows of purged notes stay behind");
        assert_eq!(count(c, "SELECT count(*) FROM block_tags WHERE block_id = 'b1' AND note_id = 'n1' AND vault_id = 'v1'"), 1);
        assert_eq!(count(c, "SELECT count(*) FROM block_tags"), 1);
        let link: (String, String, String, Option<String>) = c
            .query_row("SELECT from_block_id, from_note_id, to_note_id, to_block_id FROM block_links WHERE id = 'l1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!(link, ("b1".into(), "n1".into(), "n2".into(), Some("b2".into())));
        assert_eq!(count(c, "SELECT count(*) FROM block_links"), 1);
    }

    #[test]
    fn copies_images_by_hash_and_reports_missing_files() {
        let old = legacy();
        old.user("u1", "ola", "h", 1);
        old.vault("v1", Some("u1"), "V");
        let sha = crate::services::attachments::sha256_hex(b"png-bytes");
        old.exec(&format!(
            "INSERT INTO attachments VALUES ('a1', 'v1', 'image/png', 9, '{sha}', 1, NULL);
             INSERT INTO attachments VALUES ('a2', 'v1', 'image/jpeg', 3, 'deadbeef', 1, NULL);"
        ));
        std::fs::create_dir_all(old.root().join("attachments")).unwrap();
        std::fs::write(old.root().join("attachments/a1.png"), b"png-bytes").unwrap();

        let report = run(old.root()).unwrap();
        assert_eq!(report.missing_files, vec!["a2".to_owned()]);

        let layout = DataLayout::new(old.root());
        assert_eq!(std::fs::read(layout.attachments_dir("u1").unwrap().join(&sha)).unwrap(), b"png-bytes");
        assert!(old.root().join("attachments/a1.png").is_file(), "the old file stays");

        let (session, _) = crate::session::Session::open(&layout, "dev", "u1", None).unwrap();
        let read = crate::services::attachments::read(&session, "a1").unwrap();
        assert_eq!(read, Some(("image/png".into(), b"png-bytes".to_vec())));
    }

    #[test]
    fn keeps_a_users_settings_and_seeds_a_missing_folder() {
        let old = legacy();
        old.user("u1", "ola", "h", 1);
        old.user("u2", "kai", "h", 2);
        std::fs::write(old.root().join("settings.json"), "shared").unwrap();
        std::fs::write(old.root().join("keybindings.json"), "shared-keys").unwrap();
        let u1 = old.root().join("users/u1");
        std::fs::create_dir_all(&u1).unwrap();
        std::fs::write(u1.join("settings.json"), "mine").unwrap();

        run(old.root()).unwrap();
        assert_eq!(std::fs::read_to_string(u1.join("settings.json")).unwrap(), "mine");
        assert!(!u1.join("keybindings.json").exists(), "an existing folder is not seeded");
        let u2 = old.root().join("users/u2");
        assert_eq!(std::fs::read_to_string(u2.join("settings.json")).unwrap(), "shared");
        assert_eq!(std::fs::read_to_string(u2.join("keybindings.json")).unwrap(), "shared-keys");
        assert!(u2.join("cord.db").is_file() && u1.join("cord.db").is_file());
    }

    #[test]
    fn one_bad_note_fails_the_whole_import_and_touches_nothing() {
        let old = legacy();
        old.user("u1", "ola", "h", 1);
        old.user("u2", "kai", "h", 2);
        old.vault("v1", Some("u1"), "V");
        old.vault("v2", Some("u2"), "W");
        old.note("ok", "v1", "Fine", &para("b1", "x"));
        old.note("bad", "v2", "Broken", "{not json");
        let before = files(old.root());

        let e = run(old.root()).unwrap_err();
        assert!(e.to_string().contains("note bad"), "{e}");
        assert_eq!(files(old.root()), before);
        assert!(!old.root().join("machine.db").exists());
        assert!(!old.root().join("users").exists(), "not even the user that imported cleanly");
        assert!(!old.root().join(STAGING).exists());
    }

    #[test]
    fn a_stopped_import_runs_again_from_the_start() {
        let old = legacy();
        old.user("u1", "ola", "h", 1);
        old.vault("v1", Some("u1"), "V");
        old.note("n1", "v1", "Hello", &para("b1", "x"));
        // Leftovers of a run that stopped before machine.db was moved.
        let u1 = old.root().join("users/u1");
        std::fs::create_dir_all(u1.join("attachments")).unwrap();
        std::fs::write(u1.join("cord.db"), "half-written").unwrap();
        std::fs::create_dir_all(old.root().join(STAGING)).unwrap();
        std::fs::write(old.root().join(STAGING).join("junk"), "x").unwrap();

        run(old.root()).unwrap();
        let db = open_user(&DataLayout::new(old.root()), "u1", None).unwrap();
        assert_eq!(count(&db.conn, "SELECT count(*) FROM notes"), 1);
        assert!(!old.root().join(STAGING).exists());
    }
}
