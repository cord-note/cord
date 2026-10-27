use std::path::{Path, PathBuf};

use crate::{Error, Result};

/// Where every Cord file lives under the data directory.
#[derive(Debug, Clone)]
pub struct DataLayout {
    root: PathBuf,
}

impl DataLayout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn machine_db(&self) -> PathBuf {
        self.root.join("machine.db")
    }

    pub fn user_dir(&self, user_id: &str) -> Result<PathBuf> {
        check_id(user_id)?;
        Ok(self.root.join("users").join(user_id))
    }

    pub fn cord_db(&self, user_id: &str) -> Result<PathBuf> {
        Ok(self.user_dir(user_id)?.join("cord.db"))
    }

    pub fn index_db(&self, user_id: &str) -> Result<PathBuf> {
        Ok(self.user_dir(user_id)?.join("index.db"))
    }

    pub fn attachments_dir(&self, user_id: &str) -> Result<PathBuf> {
        Ok(self.user_dir(user_id)?.join("attachments"))
    }
}

/// Ids are nanoids; anything else must not become a path segment.
fn check_id(id: &str) -> Result<()> {
    let ok = !id.is_empty()
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok { Ok(()) } else { Err(Error::BadId(id.to_owned())) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_machine_db_at_the_root() {
        let l = DataLayout::new("/data");
        assert_eq!(l.machine_db(), PathBuf::from("/data/machine.db"));
    }

    #[test]
    fn places_user_files_in_the_user_folder() {
        let l = DataLayout::new("/data");
        let dir = PathBuf::from("/data/users/u_1-A");
        assert_eq!(l.user_dir("u_1-A").unwrap(), dir);
        assert_eq!(l.cord_db("u_1-A").unwrap(), dir.join("cord.db"));
        assert_eq!(l.index_db("u_1-A").unwrap(), dir.join("index.db"));
        assert_eq!(l.attachments_dir("u_1-A").unwrap(), dir.join("attachments"));
    }

    #[test]
    fn rejects_ids_that_could_escape_the_folder() {
        let l = DataLayout::new("/data");
        for bad in ["", "..", "a/b", r"a\b", "a.b"] {
            assert!(matches!(l.user_dir(bad), Err(Error::BadId(_))), "{bad:?}");
        }
    }
}
