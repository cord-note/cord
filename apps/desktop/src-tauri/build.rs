// Tauri embeds its Windows manifest (Common Controls 6) only in the app
// binary, so test binaries fail to load. Embedding the same manifest through
// the linker covers every target, tests included (Tauri's documented fix).
fn main() {
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        attributes = attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::env::current_dir().unwrap().join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attributes).expect("tauri build script failed");
}
