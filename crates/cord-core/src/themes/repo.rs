//! Repo and .zip links for theme imports. No network here.

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};

use crate::{Error, Result};

/// What JS's encodeURIComponent leaves alone.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-').remove(b'_').remove(b'.').remove(b'!').remove(b'~')
    .remove(b'*').remove(b'\'').remove(b'(').remove(b')');

const UNSUPPORTED: &str = "Use a GitHub, GitLab or Codeberg repo link, or an https link to a .zip";

#[derive(Debug, Clone, PartialEq)]
pub enum Archive {
    Url(String),
    /// Fetch `api` (JSON with `default_branch`), then `archive_for_branch(base, branch)`.
    CodebergDefaultBranch { api: String, base: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ArchiveRequest {
    pub archive: Archive,
    /// Folder inside the repo to search, from a /tree/<ref>/<path> link.
    pub sub_path: Option<String>,
}

pub fn parse_repo_url(input: &str) -> Result<ArchiveRequest> {
    let parsed = url::Url::parse(input.trim()).map_err(|_| Error::Invalid(UNSUPPORTED.into()))?;
    if parsed.scheme() != "https" {
        return Err(Error::Invalid("Only https links are supported".into()));
    }
    let host = parsed.host_str().unwrap_or_default().to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let parts: Vec<String> = parsed
        .path_segments()
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .map(|s| percent_decode_str(s).decode_utf8_lossy().into_owned())
        .collect();
    let clean = |name: &str| name.strip_suffix(".git").unwrap_or(name).to_owned();
    let sub = |rest: &[String]| (!rest.is_empty()).then(|| rest.join("/"));
    let direct = |u: String, sub_path: Option<String>| -> Result<ArchiveRequest> {
        Ok(ArchiveRequest { archive: Archive::Url(u), sub_path })
    };

    if host == "github.com" && parts.len() >= 2 {
        let (owner, repo) = (&parts[0], clean(&parts[1]));
        let has_ref = parts.get(2).is_some_and(|k| k == "tree") && parts.len() > 3;
        let reference = if has_ref { seg(&parts[3]) } else { "HEAD".into() };
        return direct(
            format!("https://github.com/{}/{}/archive/{reference}.zip", seg(owner), seg(&repo)),
            if has_ref { sub(&parts[4..]) } else { None },
        );
    }

    if host == "gitlab.com" && parts.len() >= 2 {
        let dash = parts.iter().position(|p| p == "-");
        let project = parts[..dash.unwrap_or(parts.len())].iter().map(|p| clean(p)).collect::<Vec<_>>().join("/");
        let after: &[String] = dash.map_or(&[], |d| &parts[d + 1..]);
        let has_ref = after.first().is_some_and(|k| k == "tree") && after.len() > 1;
        let query = if has_ref { format!("?sha={}", seg(&after[1])) } else { String::new() };
        return direct(
            format!("https://gitlab.com/api/v4/projects/{}/repository/archive.zip{query}", seg(&project)),
            if has_ref { sub(&after[2..]) } else { None },
        );
    }

    if host == "codeberg.org" && parts.len() >= 2 {
        let (owner, name) = (&parts[0], clean(&parts[1]));
        let base = format!("https://codeberg.org/{}/{}", seg(owner), seg(&name));
        if parts.get(2).is_some_and(|k| k == "src") && parts.len() > 4 {
            return direct(archive_for_branch(&base, &parts[4]), sub(&parts[5..]));
        }
        let api = format!("https://codeberg.org/api/v1/repos/{}/{}", seg(owner), seg(&name));
        return Ok(ArchiveRequest { archive: Archive::CodebergDefaultBranch { api, base }, sub_path: None });
    }

    if parsed.path().to_lowercase().ends_with(".zip") {
        return direct(parsed.to_string(), None);
    }
    Err(Error::Invalid(UNSUPPORTED.into()))
}

pub fn archive_for_branch(base: &str, branch: &str) -> String {
    format!("{base}/archive/{}.zip", seg(branch))
}

fn seg(s: &str) -> String {
    utf8_percent_encode(s, COMPONENT).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(link: &str) -> String {
        match parse_repo_url(link).unwrap().archive {
            Archive::Url(u) => u,
            other => panic!("expected a url, got {other:?}"),
        }
    }

    #[test]
    fn github() {
        assert_eq!(url("https://github.com/acme/themes"), "https://github.com/acme/themes/archive/HEAD.zip");
        assert_eq!(url("https://github.com/acme/themes.git"), "https://github.com/acme/themes/archive/HEAD.zip");
        let r = parse_repo_url("https://github.com/acme/themes/tree/v2/packs/dark").unwrap();
        assert_eq!(r.archive, Archive::Url("https://github.com/acme/themes/archive/v2.zip".into()));
        assert_eq!(r.sub_path.as_deref(), Some("packs/dark"));
    }

    #[test]
    fn gitlab() {
        assert_eq!(url("https://gitlab.com/grp/sub/themes"), "https://gitlab.com/api/v4/projects/grp%2Fsub%2Fthemes/repository/archive.zip");
        let r = parse_repo_url("https://gitlab.com/grp/themes/-/tree/main/dusk").unwrap();
        assert_eq!(r.archive, Archive::Url("https://gitlab.com/api/v4/projects/grp%2Fthemes/repository/archive.zip?sha=main".into()));
        assert_eq!(r.sub_path.as_deref(), Some("dusk"));
    }

    #[test]
    fn codeberg() {
        assert_eq!(url("https://codeberg.org/ola/themes/src/branch/dev/x"), "https://codeberg.org/ola/themes/archive/dev.zip");
        let r = parse_repo_url("https://codeberg.org/ola/themes").unwrap();
        assert_eq!(r.archive, Archive::CodebergDefaultBranch {
            api: "https://codeberg.org/api/v1/repos/ola/themes".into(),
            base: "https://codeberg.org/ola/themes".into(),
        });
        assert_eq!(archive_for_branch("https://codeberg.org/ola/themes", "trunk"), "https://codeberg.org/ola/themes/archive/trunk.zip");
    }

    #[test]
    fn zip_links_and_refusals() {
        assert_eq!(url("https://example.com/pack.zip"), "https://example.com/pack.zip");
        assert!(parse_repo_url("http://github.com/acme/themes").unwrap_err().to_string().contains("https"));
        assert!(parse_repo_url("https://example.com/page").is_err());
        assert!(parse_repo_url("not a url").is_err());
    }
}
