//! Each user's settings files, kept as opaque text: the renderer owns the
//! schema, so a hand-edited file (comments and all) round-trips exactly.

use std::path::PathBuf;

use crate::layout::DataLayout;
use crate::{Error, Result};

pub const CONFIG_FILES: [&str; 2] = ["settings", "keybindings"];
/// Anything larger is not a settings file someone meant to write.
pub const MAX_CONFIG_BYTES: usize = 1024 * 1024;

pub fn read(layout: &DataLayout, user_id: &str, name: &str) -> Result<Option<String>> {
    let p = path(layout, user_id, name)?;
    match std::fs::read_to_string(&p) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Written beside the target and renamed over it, so a crash never truncates it.
pub fn write(layout: &DataLayout, user_id: &str, name: &str, text: &str) -> Result<()> {
    let p = path(layout, user_id, name)?;
    if text.len() > MAX_CONFIG_BYTES {
        return Err(Error::Invalid(format!("Settings file exceeds {MAX_CONFIG_BYTES} bytes")));
    }
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

fn path(layout: &DataLayout, user_id: &str, name: &str) -> Result<PathBuf> {
    if !CONFIG_FILES.contains(&name) {
        return Err(Error::Invalid(format!("Unknown settings file \"{name}\"")));
    }
    Ok(layout.user_dir(user_id)?.join(format!("{name}.json")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_reads_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let l = DataLayout::new(dir.path());
        assert_eq!(read(&l, "u1", "settings").unwrap(), None);
        write(&l, "u1", "settings", "// mine\n{}").unwrap();
        write(&l, "u1", "settings", "// mine\n{ \"a\": 1 }").unwrap();
        assert_eq!(read(&l, "u1", "settings").unwrap().as_deref(), Some("// mine\n{ \"a\": 1 }"));
        assert!(!l.user_dir("u1").unwrap().join("settings.json.tmp").exists());
    }

    #[test]
    fn refuses_unknown_names_bad_ids_and_huge_text() {
        let dir = tempfile::tempdir().unwrap();
        let l = DataLayout::new(dir.path());
        assert!(matches!(write(&l, "u1", "../x", "{}"), Err(Error::Invalid(_))));
        assert!(matches!(read(&l, "../u", "settings"), Err(Error::BadId(_))));
        assert!(matches!(write(&l, "u1", "keybindings", &"x".repeat(MAX_CONFIG_BYTES + 1)), Err(Error::Invalid(_))));
    }
}
