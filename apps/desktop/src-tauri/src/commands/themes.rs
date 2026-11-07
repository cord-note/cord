use cord_core::themes::{self, import, repo};
use serde_json::{json, Value};
use tauri::State;

use crate::core::{err, run, Shared};

#[tauri::command]
pub async fn themes_default_dir(core: State<'_, Shared>) -> Result<Value, String> {
    run(&core, |c| {
        c.me()?;
        Ok(json!({ "dir": themes::default_dir(c.layout.root()).to_string_lossy() }))
    })
    .await
}

/// Raw files; the renderer assembles them (shared/theming/assembleLibrary.ts).
#[tauri::command]
pub async fn themes_scan(core: State<'_, Shared>, dir: String) -> Result<Value, String> {
    run(&core, move |c| {
        c.me()?;
        Ok(themes::scan(&dir, &themes::default_dir(c.layout.root())))
    })
    .await
}

#[tauri::command]
pub async fn themes_import(core: State<'_, Shared>, source: String, dir: String) -> Result<Value, String> {
    run(&core, move |c| {
        c.me()?;
        import::import_path(&source, &dir, &themes::default_dir(c.layout.root())).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn themes_import_url(core: State<'_, Shared>, url: String, dir: String) -> Result<Value, String> {
    core.me()?;
    let request = repo::parse_repo_url(&url).map_err(err)?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(err)?;
    let archive = match request.archive {
        repo::Archive::Url(u) => u,
        repo::Archive::CodebergDefaultBranch { api, base } => {
            let res = client.get(&api).send().await.map_err(err)?;
            if !res.status().is_success() {
                return Err(format!("Codeberg answered {}", res.status().as_u16()));
            }
            let body: Value = res.json().await.map_err(err)?;
            let branch = body.get("default_branch").and_then(Value::as_str).ok_or("Could not find the default branch")?;
            repo::archive_for_branch(&base, branch)
        }
    };
    let zip = download(&client, &archive).await?;
    let sub_path = request.sub_path;
    run(&core, move |c| {
        let default = themes::default_dir(c.layout.root());
        import::import_zip(&zip, sub_path.as_deref(), &dir, &default, Some(url.trim())).map_err(err)
    })
    .await
}

/// https only, redirects followed, at most import::MAX_ZIP_BYTES.
async fn download(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut res = client.get(url).send().await.map_err(err)?;
    if res.url().scheme() != "https" {
        return Err("The download was redirected away from https".into());
    }
    if res.status().as_u16() == 404 {
        return Err("Not found. Is the repo public, and the branch name right?".into());
    }
    if !res.status().is_success() {
        return Err(format!("The server answered {}", res.status().as_u16()));
    }
    let max = import::MAX_ZIP_BYTES;
    if res.content_length().is_some_and(|n| n > max) {
        return Err("The download is too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(err)? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > max {
            return Err("The download is too large".into());
        }
    }
    Ok(bytes)
}
