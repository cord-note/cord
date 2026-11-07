//! Where Cord keeps its data. The one place that rule lives.
//!
//! Linux follows the XDG base directory spec (packages from apt, dnf or pacman
//! are held to it); Windows and macOS keep `~/.cord`. `CORD_DATA_DIR` overrides
//! both, for development and tests.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::Result;

/// The data directory for `platform` ("linux", "windows", "macos") and `env`.
pub fn data_dir_for(platform: &str, env: &HashMap<String, String>) -> PathBuf {
    if let Some(over) = env.get("CORD_DATA_DIR").filter(|v| !v.is_empty()) {
        return PathBuf::from(over);
    }
    if platform != "linux" {
        return home(env).join(".cord");
    }
    // The spec says a relative XDG_DATA_HOME must be ignored; so is an empty one.
    match env.get("XDG_DATA_HOME").filter(|x| Path::new(x.as_str()).is_absolute()) {
        Some(xdg) => Path::new(xdg).join("cord"),
        None => home(env).join(".local/share/cord"),
    }
}

/// `~/.cord`, where every platform kept data before the XDG move.
pub fn legacy_dir(env: &HashMap<String, String>) -> PathBuf {
    home(env).join(".cord")
}

/// This process's data directory.
pub fn resolve() -> PathBuf {
    let env: HashMap<String, String> = std::env::vars().collect();
    data_dir_for(std::env::consts::OS, &env)
}

/// Moves a pre-XDG `~/.cord` to `target` once. Never merges into an existing
/// target, never deletes the original when it has to copy.
pub fn migrate_legacy(legacy: &Path, target: &Path) -> Result<()> {
    if legacy == target || !legacy.exists() || target.exists() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::rename(legacy, target).is_ok() {
        return Ok(());
    }
    // Across filesystems: copy beside the target, then move it into place, so a
    // half-finished copy never looks like a finished migration.
    let staging = target.with_extension("migrating");
    let _ = std::fs::remove_dir_all(&staging);
    if let Err(e) = copy_tree(legacy, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e.into());
    }
    std::fs::rename(&staging, target)?;
    Ok(())
}

/// An old single-file install (`cord.db`) that nothing has imported yet.
pub fn has_unimported_legacy_db(dir: &Path) -> bool {
    dir.join("cord.db").is_file() && !dir.join("machine.db").is_file()
}

fn home(env: &HashMap<String, String>) -> PathBuf {
    env.get("HOME").or_else(|| env.get("USERPROFILE")).map_or_else(|| PathBuf::from("."), PathBuf::from)
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()
    }

    #[test]
    fn follows_xdg_on_linux_and_dotcord_elsewhere() {
        // An absolute XDG path in the test must be absolute on the host OS too.
        let xdg = std::env::temp_dir().join("xdg");
        let xdg_s = xdg.to_string_lossy().into_owned();
        assert_eq!(data_dir_for("linux", &env(&[("HOME", "/h")])), PathBuf::from("/h/.local/share/cord"));
        assert_eq!(data_dir_for("linux", &env(&[("HOME", "/h"), ("XDG_DATA_HOME", &xdg_s)])), xdg.join("cord"));
        assert_eq!(data_dir_for("linux", &env(&[("HOME", "/h"), ("XDG_DATA_HOME", "rel")])), PathBuf::from("/h/.local/share/cord"));
        assert_eq!(data_dir_for("linux", &env(&[("HOME", "/h"), ("XDG_DATA_HOME", "")])), PathBuf::from("/h/.local/share/cord"));
        assert_eq!(data_dir_for("windows", &env(&[("USERPROFILE", "C:/U")])), PathBuf::from("C:/U/.cord"));
        assert_eq!(data_dir_for("macos", &env(&[("HOME", "/h")])), PathBuf::from("/h/.cord"));
    }

    #[test]
    fn the_override_wins_everywhere() {
        let e = env(&[("HOME", "/h"), ("CORD_DATA_DIR", "/dev/cord")]);
        assert_eq!(data_dir_for("linux", &e), PathBuf::from("/dev/cord"));
        assert_eq!(data_dir_for("windows", &e), PathBuf::from("/dev/cord"));
    }

    #[test]
    fn migrates_once_and_never_merges() {
        let d = tempfile::tempdir().unwrap();
        let legacy = d.path().join(".cord");
        let target = d.path().join("share/cord");
        std::fs::create_dir_all(legacy.join("users")).unwrap();
        std::fs::write(legacy.join("cord.db"), "db").unwrap();
        migrate_legacy(&legacy, &target).unwrap();
        assert_eq!(std::fs::read_to_string(target.join("cord.db")).unwrap(), "db");
        assert!(target.join("users").is_dir());

        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("cord.db"), "newer").unwrap();
        migrate_legacy(&legacy, &target).unwrap();
        assert_eq!(std::fs::read_to_string(target.join("cord.db")).unwrap(), "db", "an existing target is never merged into");
        migrate_legacy(&target, &target).unwrap();
    }

    #[test]
    fn spots_an_unimported_old_install() {
        let d = tempfile::tempdir().unwrap();
        assert!(!has_unimported_legacy_db(d.path()));
        std::fs::write(d.path().join("cord.db"), "").unwrap();
        assert!(has_unimported_legacy_db(d.path()));
        std::fs::write(d.path().join("machine.db"), "").unwrap();
        assert!(!has_unimported_legacy_db(d.path()));
    }
}
