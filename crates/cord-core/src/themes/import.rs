//! Copying themes into the library from a folder, a .css or a .zip.

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};

use super::{display, find_candidates, inside, read_css, read_manifest, Candidate, FileProblem};
use crate::{Error, Result};

pub const MAX_ZIP_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_ZIP_ENTRIES: usize = 2000;
/// How deep an import looks for themes inside the chosen folder or zip.
const IMPORT_DEPTH: u32 = 3;

/// Copy of the ids in shared/theming/builtinThemes.ts.
pub const BUILTIN_THEME_IDS: [&str; 7] = ["mono", "blue", "olive", "teal", "midnight", "rosewood", "parchment"];

static THEME_SELECTOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\[\s*data-theme\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-z0-9-]+))\s*\]"#).unwrap());
static THEME_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9-]{0,63}$").unwrap());

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Imported {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct ImportResult {
    pub imported: Vec<Imported>,
    pub problems: Vec<FileProblem>,
}

/// The id sanitizeThemeCss.ts would find. Used here only to name the folder.
pub fn theme_id_of(css: &str) -> Option<String> {
    let stripped = strip_comments(css);
    let cap = THEME_SELECTOR.captures(&stripped)?;
    let id = cap.get(1).or(cap.get(2)).or(cap.get(3))?.as_str();
    THEME_ID.is_match(id).then(|| id.to_owned())
}

/// Port of sanitizeThemeCss.ts's stripComments: strings are kept whole.
fn strip_comments(css: &str) -> String {
    let chars: Vec<char> = css.chars().collect();
    let mut out = String::with_capacity(css.len());
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '"' || ch == '\'' {
            let start = i;
            i += 1;
            while i < chars.len() && chars[i] != ch {
                i += if chars[i] == '\\' { 2 } else { 1 };
            }
            i = (i + 1).min(chars.len());
            out.extend(&chars[start..i]);
        } else if ch == '/' && chars.get(i + 1) == Some(&'*') {
            let mut j = i + 2;
            while j + 1 < chars.len() && !(chars[j] == '*' && chars[j + 1] == '/') {
                j += 1;
            }
            i = if j + 1 < chars.len() { j + 2 } else { chars.len() };
        } else {
            out.push(ch);
            i += 1;
        }
    }
    out
}

/// From a folder, a .zip or a .css file on disk.
pub fn import_path(source: &str, dir: &str, default: &Path) -> Result<ImportResult> {
    let library = library_dir(dir, default)?;
    let src = std::path::absolute(source.trim())?;
    if !src.exists() {
        return Err(Error::Invalid(format!("Nothing found at {}", display(&src))));
    }
    if src.is_dir() {
        return import_tree(&src, &library, None);
    }
    let ext = src.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("css") => Ok(copy_candidates(&[Candidate { css_path: src, folder: None }], &library, None)),
        Some("zip") => {
            if std::fs::metadata(&src)?.len() > MAX_ZIP_BYTES {
                return Err(Error::Invalid("The zip is too large".into()));
            }
            let bytes = std::fs::read(&src)?;
            with_zip(&bytes, |root| import_tree(root, &library, None))
        }
        _ => Err(Error::Invalid("Choose a folder, a .zip or a .css file".into())),
    }
}

/// From a downloaded repo archive: one top folder is unwrapped, `sub_path`
/// narrows the search, and `source_url` is remembered for updates.
pub fn import_zip(zip: &[u8], sub_path: Option<&str>, dir: &str, default: &Path, source_url: Option<&str>) -> Result<ImportResult> {
    if zip.len() as u64 > MAX_ZIP_BYTES {
        return Err(Error::Invalid("The zip is too large".into()));
    }
    let library = library_dir(dir, default)?;
    with_zip(zip, |root| {
        // Host archives wrap the repo in one top folder (repo-branch/).
        let entries: Vec<PathBuf> = std::fs::read_dir(root)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_str().is_some_and(|n| !n.starts_with('.') && n != "__MACOSX"))
            .map(|e| e.path())
            .collect();
        let top = match entries.as_slice() {
            [only] if only.is_dir() => only.clone(),
            _ => root.to_path_buf(),
        };
        let search = match sub_path {
            Some(sub) => inside(&top, sub)
                .filter(|p| p.is_dir())
                .ok_or_else(|| Error::Invalid(format!("No folder \"{sub}\" in the repo")))?,
            None => top,
        };
        import_tree(&search, &library, source_url)
    })
}

fn import_tree(root: &Path, library: &Path, source_url: Option<&str>) -> Result<ImportResult> {
    let candidates = if root.join("theme.css").is_file() {
        vec![Candidate { css_path: root.join("theme.css"), folder: Some(root.to_path_buf()) }]
    } else {
        find_candidates(root, IMPORT_DEPTH)
    };
    if candidates.is_empty() {
        return Err(Error::Invalid("No themes found: a theme is a theme.css file or a folder holding one".into()));
    }
    let mut result = copy_candidates(&candidates, library, source_url);
    // Paths inside a temp extraction mean nothing to the user; show them from the pack's root.
    for p in &mut result.problems {
        let path = PathBuf::from(&p.path);
        let rel = path.strip_prefix(root).ok().map(display).filter(|s| !s.is_empty());
        p.path = rel.unwrap_or_else(|| path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    }
    Ok(result)
}

fn copy_candidates(candidates: &[Candidate], library: &Path, source_url: Option<&str>) -> ImportResult {
    let mut result = ImportResult::default();
    for c in candidates {
        let shown = display(c.folder.as_deref().unwrap_or(&c.css_path));
        match copy_one(c, library, source_url) {
            Ok(done) => result.imported.push(done),
            Err(message) => result.problems.push(FileProblem { path: shown, message }),
        }
    }
    result
}

fn copy_one(c: &Candidate, library: &Path, source_url: Option<&str>) -> std::result::Result<Imported, String> {
    let css = read_css(&c.css_path)?;
    let id = theme_id_of(&css).ok_or("No [data-theme=\"…\"] selector found, so the theme has no id")?;
    if BUILTIN_THEME_IDS.contains(&id.as_str()) {
        return Err(format!("\"{id}\" is the id of a built-in theme"));
    }
    let target = library.join(&id);
    let same = |a: &Path, b: &Path| a.canonicalize().ok().zip(b.canonicalize().ok()).is_some_and(|(x, y)| x == y);
    if c.folder.as_deref().is_some_and(|f| same(f, &target)) {
        return Err("Already in the library".into());
    }
    let manifest = c.folder.as_deref().map_or_else(|| json!({}), |f| read_manifest(&f.join("theme.json")));
    let fallback = match &c.folder {
        Some(f) => f.file_name(),
        None => c.css_path.file_stem(),
    }
    .map(|n| n.to_string_lossy().into_owned())
    .unwrap_or_default();
    let label = clip(&manifest["name"], 60).unwrap_or_else(|| title_case(&fallback));

    let io = |e: std::io::Error| e.to_string();
    std::fs::create_dir_all(&target).map_err(io)?;
    match &c.folder {
        // Re-importing updates in place: files are added or replaced, never deleted.
        Some(folder) => copy_dir(folder, &target).map_err(io)?,
        None => {
            std::fs::copy(&c.css_path, target.join("theme.css")).map_err(io)?;
            if !target.join("theme.json").exists() {
                write_json(&target.join("theme.json"), &json!({ "name": label })).map_err(io)?;
            }
        }
    }
    if let Some(url) = source_url {
        // Remembered so the gallery can offer to update the theme from where it came.
        let path = target.join("theme.json");
        let mut m = read_manifest(&path);
        m["source"] = Value::String(url.to_owned());
        write_json(&path, &m).map_err(io)?;
    }
    Ok(Imported { id, label })
}

fn with_zip<T>(zip: &[u8], use_it: impl FnOnce(&Path) -> Result<T>) -> Result<T> {
    let temp = tempfile::Builder::new().prefix("cord-theme-import-").tempdir()?;
    extract_zip(zip, temp.path())?;
    use_it(temp.path())
}

fn extract_zip(bytes: &[u8], into: &Path) -> Result<()> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| Error::Invalid("That is not a zip file".into()))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(Error::Invalid("The zip has too many files".into()));
    }
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| Error::Invalid(format!("Bad zip entry: {e}")))?;
        if file.is_dir() {
            continue;
        }
        // Zip-slip: an entry may never land outside the extraction folder.
        let rel = file.enclosed_name().ok_or_else(|| Error::Invalid(format!("Unsafe path in zip: {}", file.name())))?;
        let target = into.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut data = Vec::new();
        file.by_ref().take(MAX_ZIP_BYTES - total + 1).read_to_end(&mut data)?;
        total += data.len() as u64;
        if total > MAX_ZIP_BYTES {
            return Err(Error::Invalid("The zip unpacks to more than 50 MB".into()));
        }
        std::fs::write(target, data)?;
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

fn write_json(path: &Path, value: &Value) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(value).map_err(std::io::Error::other)?;
    std::fs::write(path, text + "\n")
}

fn clip(value: &Value, max: usize) -> Option<String> {
    let s = value.as_str()?.trim();
    (!s.is_empty()).then(|| s.chars().take(max).collect())
}

/// `dark_mode-two` -> `Dark Mode Two`, as titleCase in ThemeLibraryService.ts.
fn title_case(name: &str) -> String {
    let spaced = Regex::new(r"[-_]+").unwrap().replace_all(name, " ");
    let mut out = String::with_capacity(spaced.len());
    let mut prev_word = false;
    for ch in spaced.chars() {
        let word = ch.is_ascii_alphanumeric() || ch == '_';
        out.push(if word && !prev_word { ch.to_ascii_uppercase() } else { ch });
        prev_word = word;
    }
    out
}

fn library_dir(dir: &str, default: &Path) -> Result<PathBuf> {
    let library = if dir.trim().is_empty() { default.to_path_buf() } else { std::path::absolute(dir.trim())? };
    std::fs::create_dir_all(&library)?;
    Ok(library)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn css(id: &str) -> String {
        format!("[data-theme=\"{id}\"] {{ --accent: red; }}")
    }

    fn zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn finds_ids_like_the_sanitizer() {
        assert_eq!(theme_id_of("/* [data-theme=\"no\"] */ [data-theme='dusk'] {}").as_deref(), Some("dusk"));
        assert_eq!(theme_id_of("[data-theme=sea-glass] {}").as_deref(), Some("sea-glass"));
        assert_eq!(theme_id_of("[data-theme=\"Bad Id\"] {}"), None);
        assert_eq!(theme_id_of("a { content: \"/*\"; } [data-theme=\"x\"] {}").as_deref(), Some("x"));
    }

    #[test]
    fn imports_a_folder_pack_nested_a_level_down() {
        let d = tempfile::tempdir().unwrap();
        let pack = d.path().join("pack");
        fs::create_dir_all(pack.join("themes/dusk")).unwrap();
        fs::write(pack.join("themes/dusk/theme.css"), css("dusk")).unwrap();
        fs::write(pack.join("themes/dusk/f.woff2"), "F").unwrap();
        fs::write(pack.join("loose.css"), css("loose-one")).unwrap();
        let lib = d.path().join("lib");
        let r = import_path(&display(&pack), &display(&lib), &lib).unwrap();
        assert_eq!(r.imported, [
            Imported { id: "loose-one".into(), label: "Loose".into() },
            Imported { id: "dusk".into(), label: "Dusk".into() },
        ]);
        assert!(lib.join("dusk/f.woff2").exists());
        assert_eq!(read_manifest(&lib.join("loose-one/theme.json")), json!({ "name": "Loose" }));
    }

    #[test]
    fn refuses_builtin_ids_missing_ids_and_empty_sources() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("a.css"), css("mono")).unwrap();
        fs::write(d.path().join("b.css"), "body { color: red }").unwrap();
        let lib = d.path().join("lib");
        let r = import_path(&display(d.path()), &display(&lib), &lib).unwrap();
        assert!(r.imported.is_empty());
        let messages: Vec<&str> = r.problems.iter().map(|p| p.message.as_str()).collect();
        assert_eq!(messages, ["\"mono\" is the id of a built-in theme", "No [data-theme=\"…\"] selector found, so the theme has no id"]);
        assert_eq!(r.problems[0].path, "a.css");

        let empty = d.path().join("empty");
        fs::create_dir_all(&empty).unwrap();
        assert!(import_path(&display(&empty), &display(&lib), &lib).unwrap_err().to_string().starts_with("No themes found"));
    }

    #[test]
    fn imports_from_a_zip_and_refuses_climbing_entries() {
        let d = tempfile::tempdir().unwrap();
        let lib = d.path().join("lib");
        let z = d.path().join("p.zip");
        fs::write(&z, zip(&[("dusk/theme.css", &css("dusk"))])).unwrap();
        assert_eq!(import_path(&display(&z), &display(&lib), &lib).unwrap().imported[0].id, "dusk");

        let evil = zip(&[("../evil/theme.css", &css("evil"))]);
        let e = import_zip(&evil, None, &display(&lib), &lib, None).unwrap_err().to_string();
        assert!(e.starts_with("Unsafe path in zip"), "{e}");
        assert!(!d.path().join("evil").exists());
    }

    #[test]
    fn a_repo_archive_unwraps_its_top_folder_honours_a_sub_path_and_remembers_the_link() {
        let d = tempfile::tempdir().unwrap();
        let lib = d.path().join("lib");
        let z = zip(&[
            ("themes-main/README.md", "hi"),
            ("themes-main/packs/dusk/theme.css", &css("dusk")),
            ("themes-main/other/theme.css", &css("other")),
        ]);
        let link = "https://github.com/acme/themes/tree/main/packs";
        let r = import_zip(&z, Some("packs"), &display(&lib), &lib, Some(link)).unwrap();
        assert_eq!(r.imported.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["dusk"]);
        assert_eq!(read_manifest(&lib.join("dusk/theme.json"))["source"], link);
        assert!(import_zip(&z, Some("nope"), &display(&lib), &lib, None).is_err());
    }

    #[test]
    fn reimporting_updates_in_place() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("dusk");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("theme.css"), css("dusk")).unwrap();
        let lib = d.path().join("lib");
        import_path(&display(&src), &display(&lib), &lib).unwrap();
        fs::write(src.join("theme.css"), css("dusk") + "/* v2 */").unwrap();
        import_path(&display(&src), &display(&lib), &lib).unwrap();
        assert!(fs::read_to_string(lib.join("dusk/theme.css")).unwrap().contains("v2"));
        let again = import_path(&display(&lib.join("dusk")), &display(&lib), &lib).unwrap();
        assert_eq!(again.problems[0].message, "Already in the library");
    }
}
