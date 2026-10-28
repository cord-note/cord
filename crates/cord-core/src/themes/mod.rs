//! Theme files on disk, read raw. Nothing here judges CSS: the renderer runs
//! shared/theming/assembleLibrary.ts (sanitizer and scene checks) on the result.
//! Themes are per-device files, never in the database or the change log.

pub mod import;
pub mod repo;

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;

use base64::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MAX_CSS_BYTES: u64 = 1024 * 1024;
pub const MAX_ASSET_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_SCENES: usize = 4;
pub const MAX_SCENE_BYTES: u64 = 16 * 1024;

const ASSET_TYPES: [(&str, &str); 10] = [
    ("woff2", "font/woff2"), ("woff", "font/woff"), ("ttf", "font/ttf"), ("otf", "font/otf"),
    ("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"),
    ("webp", "image/webp"), ("svg", "image/svg+xml"),
];

/// The same pattern sanitizeThemeCss.ts's rewriteUrls matches.
static URL_REF: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)"#).unwrap());

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSceneFile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawTheme {
    /// theme.css, or the loose .css file.
    pub css_path: String,
    /// The theme's folder; None for a loose .css file.
    pub folder: Option<String>,
    pub css: String,
    /// theme.json parsed; {} when missing, broken or not an object.
    pub manifest: Value,
    /// Fonts and images the CSS refers to, keyed by the reference as written.
    pub assets: BTreeMap<String, String>,
    /// The scene files theme.json lists, keyed by the path as written.
    pub scene_files: BTreeMap<String, RawSceneFile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileProblem {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RawThemeScan {
    pub dir: String,
    pub themes: Vec<RawTheme>,
    pub problems: Vec<FileProblem>,
}

pub(crate) struct Candidate {
    pub css_path: PathBuf,
    pub folder: Option<PathBuf>,
}

/// `<data dir>/themes`.
pub fn default_dir(root: &Path) -> PathBuf {
    root.join("themes")
}

/// Every theme in `dir`, or in the default library (created) when `dir` is blank.
pub fn scan(dir: &str, default: &Path) -> RawThemeScan {
    let root = if dir.trim().is_empty() {
        let _ = std::fs::create_dir_all(default);
        default.to_path_buf()
    } else {
        std::path::absolute(dir.trim()).unwrap_or_else(|_| PathBuf::from(dir.trim()))
    };
    let mut out = RawThemeScan { dir: display(&root), themes: Vec::new(), problems: Vec::new() };
    if !root.is_dir() {
        out.problems.push(FileProblem { path: display(&root), message: "The theme folder does not exist".into() });
        return out;
    }
    for c in find_candidates(&root, 1) {
        match read_theme(&c) {
            Ok(t) => out.themes.push(t),
            Err(message) => out.problems.push(FileProblem { path: display(&c.css_path), message }),
        }
    }
    out
}

/// Theme folders (holding theme.css) and loose .css files, `depth` levels down.
pub(crate) fn find_candidates(dir: &Path, depth: u32) -> Vec<Candidate> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return found };
    let mut names: Vec<String> = entries.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect();
    names.sort();
    for name in names {
        if name.starts_with('.') || name == "__MACOSX" {
            continue;
        }
        let path = dir.join(&name);
        if path.is_dir() {
            if path.join("theme.css").is_file() {
                found.push(Candidate { css_path: path.join("theme.css"), folder: Some(path) });
            } else if depth > 1 {
                found.extend(find_candidates(&path, depth - 1));
            }
        } else if Path::new(&name).extension().is_some_and(|e| e.eq_ignore_ascii_case("css")) {
            found.push(Candidate { css_path: path, folder: None });
        }
    }
    found
}

pub(crate) fn read_theme(c: &Candidate) -> std::result::Result<RawTheme, String> {
    let css = read_css(&c.css_path)?;
    let base = c.folder.clone().unwrap_or_else(|| c.css_path.parent().map(Path::to_path_buf).unwrap_or_default());
    let mut assets = BTreeMap::new();
    for cap in URL_REF.captures_iter(&css) {
        let reference = cap.get(1).or(cap.get(2)).or(cap.get(3)).map_or("", |m| m.as_str()).trim();
        if let Some(uri) = inline_asset(&base, reference) {
            assets.insert(reference.to_owned(), uri);
        }
    }
    let (manifest, scene_files) = match &c.folder {
        Some(folder) => {
            let manifest = read_manifest(&folder.join("theme.json"));
            let scenes = read_scene_files(folder, &manifest);
            (manifest, scenes)
        }
        None => (json!({}), BTreeMap::new()),
    };
    Ok(RawTheme {
        css_path: display(&c.css_path),
        folder: c.folder.as_deref().map(display),
        css,
        manifest,
        assets,
        scene_files,
    })
}

pub(crate) fn read_css(path: &Path) -> std::result::Result<String, String> {
    let size = std::fs::metadata(path).map_err(|_| "Could not read the file".to_owned())?.len();
    if size > MAX_CSS_BYTES {
        return Err(format!("Larger than {} KB", MAX_CSS_BYTES / 1024));
    }
    let bytes = std::fs::read(path).map_err(|_| "Could not read the file".to_owned())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub(crate) fn read_manifest(path: &Path) -> Value {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

/// `base` joined with a relative path, refusing anything that climbs out.
pub(crate) fn inside(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    let mut depth = 0usize;
    for part in Path::new(rel).components() {
        match part {
            Component::Normal(p) => {
                out.push(p);
                depth += 1;
            }
            Component::CurDir => {}
            Component::ParentDir if depth > 0 => {
                out.pop();
                depth -= 1;
            }
            _ => return None,
        }
    }
    (depth > 0).then_some(out)
}

fn inline_asset(base: &Path, reference: &str) -> Option<String> {
    let clean = reference.split(['?', '#']).next().unwrap_or_default();
    let decoded = percent_encoding::percent_decode_str(clean).decode_utf8().ok()?;
    let path = inside(base, &decoded)?;
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let mime = ASSET_TYPES.iter().find(|(e, _)| *e == ext)?.1;
    let meta = std::fs::metadata(&path).ok().filter(|m| m.is_file())?;
    if meta.len() > MAX_ASSET_BYTES {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn read_scene_files(folder: &Path, manifest: &Value) -> BTreeMap<String, RawSceneFile> {
    let mut out = BTreeMap::new();
    let Some(entries) = manifest.get("scenes").and_then(Value::as_array) else { return out };
    for entry in entries.iter().take(MAX_SCENES) {
        let Some(file) = entry.get("file").and_then(Value::as_str).filter(|f| !f.is_empty()) else { continue };
        out.insert(file.to_owned(), read_scene(folder, file));
    }
    out
}

fn read_scene(folder: &Path, file: &str) -> RawSceneFile {
    let fail = |m: &str| RawSceneFile { source: None, error: Some(m.to_owned()) };
    if !Path::new(file).extension().is_some_and(|e| e.eq_ignore_ascii_case("glsl")) {
        return fail("must be a .glsl file");
    }
    let Some(path) = inside(folder, file) else { return fail("must be inside the theme folder") };
    let Ok(meta) = std::fs::metadata(&path) else { return fail("file not found") };
    if meta.len() > MAX_SCENE_BYTES {
        return fail(&format!("larger than {} KB", MAX_SCENE_BYTES / 1024));
    }
    match std::fs::read(&path) {
        Ok(bytes) => RawSceneFile { source: Some(String::from_utf8_lossy(&bytes).into_owned()), error: None },
        Err(_) => fail("file not found"),
    }
}

pub(crate) fn display(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn theme_css(id: &str) -> String {
        format!("[data-theme=\"{id}\"] {{ --accent: #f00; }}")
    }

    #[test]
    fn finds_folder_themes_and_loose_files_but_not_deeper() {
        let d = tempfile::tempdir().unwrap();
        let lib = d.path();
        fs::create_dir_all(lib.join("dusk")).unwrap();
        fs::write(lib.join("dusk/theme.css"), theme_css("dusk")).unwrap();
        fs::write(lib.join("sea.css"), theme_css("sea")).unwrap();
        fs::create_dir_all(lib.join("pack/deep")).unwrap();
        fs::write(lib.join("pack/deep/theme.css"), theme_css("deep")).unwrap();
        fs::create_dir_all(lib.join(".hidden")).unwrap();
        fs::write(lib.join(".hidden/theme.css"), theme_css("hidden")).unwrap();

        let scan = scan(&display(lib), lib);
        let paths: Vec<&str> = scan.themes.iter().map(|t| t.css_path.as_str()).collect();
        assert_eq!(paths.len(), 2);
        assert!(paths[0].ends_with("theme.css") && paths[1].ends_with("sea.css"));
        assert_eq!(scan.themes[0].manifest, json!({}));
    }

    #[test]
    fn inlines_referenced_assets_inside_the_folder_only() {
        let d = tempfile::tempdir().unwrap();
        let lib = d.path().join("lib");
        fs::create_dir_all(lib.join("dusk")).unwrap();
        fs::write(lib.join("dusk/f.woff2"), "FONT").unwrap();
        fs::write(d.path().join("secret.woff2"), "NOPE").unwrap();
        fs::write(lib.join("dusk/theme.css"), "@font-face { src: url( 'f.woff2?v=1' ); }\n@font-face { src: url(../../secret.woff2); }\n@font-face { src: url(missing.woff2); }").unwrap();
        let t = &scan(&display(&lib), &lib).themes[0];
        assert_eq!(t.assets.len(), 1);
        assert_eq!(t.assets["f.woff2?v=1"], "data:font/woff2;base64,Rk9OVA==");
    }

    #[test]
    fn reads_listed_scene_files_with_the_typescript_messages() {
        let d = tempfile::tempdir().unwrap();
        let lib = d.path().join("lib");
        fs::create_dir_all(lib.join("dusk/scenes")).unwrap();
        fs::write(lib.join("dusk/theme.css"), theme_css("dusk")).unwrap();
        fs::write(lib.join("dusk/scenes/rain.glsl"), "float scene(vec2 p, vec2 span) { return 0.5; }").unwrap();
        fs::write(lib.join("dusk/scenes/big.glsl"), "x".repeat(MAX_SCENE_BYTES as usize + 1)).unwrap();
        fs::write(lib.join("dusk/theme.json"), json!({ "scenes": [
            { "file": "scenes/rain.glsl" }, { "file": "scenes/notes.txt" }, { "file": "../out.glsl" },
            { "file": "scenes/gone.glsl" }, { "file": "scenes/big.glsl" }
        ]}).to_string()).unwrap();
        let files = &scan(&display(&lib), &lib).themes[0].scene_files;
        assert!(files["scenes/rain.glsl"].source.is_some());
        let err = |k: &str| files[k].error.clone().unwrap();
        assert_eq!(err("scenes/notes.txt"), "must be a .glsl file");
        assert_eq!(err("../out.glsl"), "must be inside the theme folder");
        assert_eq!(err("scenes/gone.glsl"), "file not found");
        assert!(!files.contains_key("scenes/big.glsl"), "only the first four entries are read");
    }

    #[test]
    fn reports_a_missing_folder_and_an_oversized_css() {
        let d = tempfile::tempdir().unwrap();
        let gone = d.path().join("nope");
        let s = scan(&display(&gone), d.path());
        assert_eq!(s.problems[0].message, "The theme folder does not exist");
        fs::write(d.path().join("huge.css"), "x".repeat(MAX_CSS_BYTES as usize + 1)).unwrap();
        let s = scan(&display(d.path()), d.path());
        assert!(s.themes.is_empty());
        assert_eq!(s.problems[0].message, "Larger than 1024 KB");
    }

    #[test]
    fn a_blank_dir_means_the_default_library_created() {
        let d = tempfile::tempdir().unwrap();
        let def = default_dir(d.path());
        let s = scan("  ", &def);
        assert!(def.is_dir());
        assert_eq!(s.dir, display(&def));
    }

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/themes")
    }

    /// Paths as `<root>/…` with forward slashes, so the file is the same on every OS.
    fn portable(scan: &RawThemeScan) -> String {
        let root = display(&fixture_root()).replace('\\', "/");
        let fix = |p: &str| p.replace('\\', "/").replace(&root, "<root>");
        let mut s = scan.clone();
        s.dir = fix(&s.dir);
        for t in &mut s.themes {
            t.css_path = fix(&t.css_path);
            t.folder = t.folder.as_deref().map(fix);
        }
        for p in &mut s.problems {
            p.path = fix(&p.path);
        }
        serde_json::to_string_pretty(&s).unwrap() + "\n"
    }

    fn fixture_scan() -> RawThemeScan {
        let lib = fixture_root().join("library");
        scan(&display(&lib), &lib)
    }

    /// Regenerates scan.raw.json: `cargo test write_theme_fixture -- --ignored`, then review.
    #[test]
    #[ignore]
    fn write_theme_fixture() {
        fs::write(fixture_root().join("scan.raw.json"), portable(&fixture_scan())).unwrap();
    }

    #[test]
    fn the_fixture_library_reads_as_recorded() {
        let recorded = fs::read_to_string(fixture_root().join("scan.raw.json")).unwrap().replace("\r\n", "\n");
        assert_eq!(portable(&fixture_scan()), recorded);
    }
}
