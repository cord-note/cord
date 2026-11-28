//! What a change and each request look like between app and server.

use serde::{Deserialize, Serialize};

use crate::changes::PAYLOAD_FORMAT_V1;
use crate::entity::Entity;
use crate::hlc::Hlc;

/// Bumped when app and server stop understanding each other.
pub const PROTOCOL: u32 = 1;
/// Most changes in one push or one pull page.
pub const MAX_BATCH: usize = 500;
/// Rough cap on payload bytes in one push.
pub const MAX_BATCH_BYTES: usize = 4 * 1024 * 1024;

/// One change as it travels. Same fields as the `changes` table; the server
/// adds `seq` and `receivedAt` when it sends changes out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireChange {
    pub id: String,
    pub vault_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub hlc: String,
    pub author_device_id: String,
    pub author_user_id: String,
    /// Starts with the payload format byte.
    #[serde(with = "b64")]
    pub payload: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub received_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub protocol: u32,
    pub server_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Login {
    pub username: String,
    pub password: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Redeem {
    pub code: String,
    pub username: String,
    pub password: String,
    pub device_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedIn {
    pub token: String,
    pub user_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub id: String,
    pub name: String,
    /// 'owner' | 'editor'
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewServerVault {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Push {
    pub changes: Vec<WireChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rejected {
    pub id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushReply {
    pub accepted: Vec<String>,
    pub rejected: Vec<Rejected>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullReply {
    pub changes: Vec<WireChange>,
    pub more: bool,
}

/// Sent on the live channel: the vault's log now ends at `seq`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ping {
    pub vault: String,
    pub seq: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorReply {
    pub error: String,
}

/// Checks the shape of a change. Returns its entity, or why it is refused.
pub fn validate(c: &WireChange) -> Result<Entity, String> {
    let entity = Entity::parse(&c.entity_type).ok_or_else(|| format!("unknown entity {}", c.entity_type))?;
    match (c.kind.as_str(), c.field.as_deref()) {
        ("create" | "body_update", None) => {}
        ("field_set", Some(f)) if entity.fields().contains(&f) => {}
        ("field_set", Some(f)) => return Err(format!("unknown field {}.{f}", c.entity_type)),
        (k, _) => return Err(format!("bad change kind {k}")),
    }
    if c.kind == "body_update" && entity != Entity::Note {
        return Err("a body update must be for a note".into());
    }
    if c.payload.first() != Some(&PAYLOAD_FORMAT_V1) {
        return Err("unknown payload format".into());
    }
    if c.id.is_empty() || c.entity_id.is_empty() || c.vault_id.is_empty() {
        return Err("empty id".into());
    }
    Hlc::parse(&c.hlc).map_err(|e| e.to_string())?;
    Ok(entity)
}

/// Binary as standard base64 text.
mod b64 {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let text = String::deserialize(d)?;
        STANDARD.decode(text).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn change(kind: &str, field: Option<&str>, payload: &[u8]) -> WireChange {
        let mut p = vec![PAYLOAD_FORMAT_V1];
        p.extend_from_slice(payload);
        WireChange {
            id: "c1".into(),
            vault_id: "v1".into(),
            entity_type: "note".into(),
            entity_id: "n1".into(),
            kind: kind.into(),
            field: field.map(str::to_owned),
            hlc: Hlc { wall: 1, counter: 0, device: "d".into() }.encode(),
            author_device_id: "d".into(),
            author_user_id: "u".into(),
            payload: p,
            seq: None,
            received_at: None,
        }
    }

    #[test]
    fn round_trips_as_camel_case_json_with_base64_payload() {
        let c = change("field_set", Some("title"), b"\"Hi\"");
        let text = serde_json::to_string(&c).unwrap();
        assert!(text.contains("\"entityType\":\"note\""));
        assert!(text.contains("\"payload\":\"ASJIaSI=\""));
        assert!(!text.contains("seq"));
        assert_eq!(serde_json::from_str::<WireChange>(&text).unwrap(), c);
    }

    #[test]
    fn validate_accepts_known_changes() {
        assert_eq!(validate(&change("field_set", Some("title"), b"1")), Ok(Entity::Note));
        assert!(validate(&change("create", None, b"{}")).is_ok());
        assert!(validate(&change("body_update", None, b"")).is_ok());
    }

    #[test]
    fn validate_refuses_bad_changes() {
        assert!(validate(&change("field_set", Some("password"), b"1")).is_err());
        assert!(validate(&change("field_set", None, b"1")).is_err());
        assert!(validate(&change("create", Some("title"), b"{}")).is_err());
        assert!(validate(&change("explode", None, b"")).is_err());
        let mut c = change("create", None, b"{}");
        c.entity_type = "users".into();
        assert!(validate(&c).is_err());
        let mut c = change("body_update", None, b"");
        c.entity_type = "tag".into();
        assert!(validate(&c).is_err());
        let mut c = change("create", None, b"{}");
        c.payload[0] = 9;
        assert!(validate(&c).is_err());
        let mut c = change("create", None, b"{}");
        c.hlc = "yesterday".into();
        assert!(validate(&c).is_err());
    }
}
