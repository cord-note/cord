//! What agents may do on this device, per user. Never synced.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::layout::DataLayout;
use crate::Result;

pub const SETTINGS_FILE: &str = "agents.json";
pub const ACTIVITY_FILE: &str = "agent-activity.jsonl";
pub const MAX_ACTIVITY: usize = 200;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentSettings {
    /// The server runs only while this is on (and a token exists).
    pub allow: bool,
    /// Write tools are offered only while this is on.
    pub edit: bool,
    /// Vault ids agents may see.
    pub vaults: Vec<String>,
    /// SHA-256 of the token, hex. The token itself is never stored.
    pub token_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub at: i64,
    pub tool: String,
    pub target: Option<String>,
    pub ok: bool,
    pub error: Option<String>,
}

pub fn load(layout: &DataLayout, user_id: &str) -> Result<AgentSettings> {
    let path = layout.user_dir(user_id)?.join(SETTINGS_FILE);
    match std::fs::read_to_string(&path) {
        // A damaged file means "nothing allowed", never an error that blocks unlock.
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AgentSettings::default()),
        Err(e) => Err(e.into()),
    }
}

pub fn save(layout: &DataLayout, user_id: &str, settings: &AgentSettings) -> Result<()> {
    let dir = layout.user_dir(user_id)?;
    std::fs::create_dir_all(&dir)?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| crate::Error::Invalid(e.to_string()))?;
    let tmp = dir.join(format!("{SETTINGS_FILE}.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, dir.join(SETTINGS_FILE))?;
    Ok(())
}

/// Make a new token, keep only its hash, and return it once.
pub fn new_token(layout: &DataLayout, user_id: &str) -> Result<String> {
    let token = nanoid::nanoid!(32);
    let mut settings = load(layout, user_id)?;
    settings.token_hash = Some(hash(&token));
    save(layout, user_id, &settings)?;
    Ok(token)
}

pub fn token_matches(stored_hash: &str, token: &str) -> bool {
    !token.is_empty() && hash(token) == stored_hash
}

fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Append one entry, keeping the newest `MAX_ACTIVITY`.
pub fn log_activity(layout: &DataLayout, user_id: &str, entry: &Activity) -> Result<()> {
    let mut all = activity(layout, user_id)?;
    all.insert(0, entry.clone());
    all.truncate(MAX_ACTIVITY);
    let dir = layout.user_dir(user_id)?;
    std::fs::create_dir_all(&dir)?;
    let text: String = all.iter().rev().filter_map(|a| serde_json::to_string(a).ok()).map(|l| l + "\n").collect();
    let tmp = dir.join(format!("{ACTIVITY_FILE}.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, dir.join(ACTIVITY_FILE))?;
    Ok(())
}

/// Newest first. Unreadable lines are skipped.
pub fn activity(layout: &DataLayout, user_id: &str) -> Result<Vec<Activity>> {
    let path = layout.user_dir(user_id)?.join(ACTIVITY_FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    Ok(text.lines().rev().filter_map(|l| serde_json::from_str(l).ok()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> (tempfile::TempDir, DataLayout) {
        let d = tempfile::tempdir().unwrap();
        let l = DataLayout::new(d.path());
        (d, l)
    }

    #[test]
    fn settings_default_to_off_and_round_trip() {
        let (_d, l) = layout();
        assert_eq!(load(&l, "u1").unwrap(), AgentSettings::default());
        let s = AgentSettings { allow: true, edit: false, vaults: vec!["v1".into()], token_hash: None };
        save(&l, "u1", &s).unwrap();
        assert_eq!(load(&l, "u1").unwrap(), s);
        assert!(load(&l, "u2").unwrap() == AgentSettings::default(), "per user");
    }

    #[test]
    fn a_new_token_replaces_the_old_and_only_its_hash_is_kept() {
        let (_d, l) = layout();
        let first = new_token(&l, "u1").unwrap();
        let second = new_token(&l, "u1").unwrap();
        assert_eq!(second.len(), 32);
        let hash = load(&l, "u1").unwrap().token_hash.unwrap();
        assert!(token_matches(&hash, &second));
        assert!(!token_matches(&hash, &first), "the old token stops working");
        let text = std::fs::read_to_string(l.user_dir("u1").unwrap().join(SETTINGS_FILE)).unwrap();
        assert!(!text.contains(&second), "the token itself is never stored");
    }

    #[test]
    fn the_activity_log_keeps_the_newest_entries() {
        let (_d, l) = layout();
        for i in 0..(MAX_ACTIVITY + 5) {
            log_activity(&l, "u1", &Activity { at: i as i64, tool: "search".into(), target: None, ok: true, error: None }).unwrap();
        }
        let all = activity(&l, "u1").unwrap();
        assert_eq!(all.len(), MAX_ACTIVITY);
        assert_eq!(all[0].at, (MAX_ACTIVITY + 4) as i64, "newest first");
    }
}
