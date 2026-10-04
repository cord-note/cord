// Facts about this install that only the shell can know.

/// Whether this copy of Cord is allowed to replace its own files.
///
/// Tauri's Linux updater only knows how to swap out an AppImage. Every other
/// Linux install — .deb, .rpm, AUR — is owned by the system package manager,
/// and that is the only thing that should be writing to those paths. Prompting
/// someone to self-update a dnf-managed package would be wrong even if it
/// worked, and `downloadAndInstall` writing over package-manager-owned files is
/// worse than wrong.
///
/// Tauri sets `APPIMAGE` in the environment when the process was started from
/// an AppImage, so that variable is the entire test. Deriving it this way rather
/// than from a build flag means a distro package is correct by default: there is
/// no packaging step anyone has to remember.
///
/// Windows and macOS ship one installer format each, both of which the updater
/// handles, so there is nothing to decide there.
#[tauri::command]
pub fn app_updater_supported() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The command reads process-wide state, so these two cases cannot be
    // asserted independently in one run without racing. Assert the invariant
    // that actually matters: on Linux the answer tracks APPIMAGE, and
    // elsewhere it is unconditionally true.
    #[test]
    fn tracks_the_appimage_environment_on_linux() {
        let appimage = std::env::var_os("APPIMAGE").is_some();
        if cfg!(target_os = "linux") {
            assert_eq!(app_updater_supported(), appimage);
        } else {
            assert!(app_updater_supported());
        }
    }
}
