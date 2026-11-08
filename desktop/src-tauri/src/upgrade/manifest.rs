//! Release manifests, version comparison and OS/architecture matching.
//!
//! Everything here is pure: no `AppHandle`, no network, no clock. That is what
//! lets the platform rules and the "is this newer?" rule be tested on every CI
//! host without standing up a release server.

use std::collections::BTreeMap;

use serde::Deserialize;
use semver::Version;

use super::source::{allowed_https, Upstream, MAX_MANIFEST_BYTES};
use super::UpgradeCode;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PlatformAsset {
    pub url: String,
    pub signature: String,
}

/// The static Tauri updater manifest: one version, notes, and one signed asset
/// per platform key. Unknown fields are ignored so a newer manifest schema does
/// not break an older client.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ReleaseManifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    #[serde(default)]
    pub platforms: BTreeMap<String, PlatformAsset>,
}

pub fn parse_manifest(raw: &str) -> Result<ReleaseManifest, UpgradeCode> {
    if raw.is_empty() || raw.len() > MAX_MANIFEST_BYTES {
        return Err(UpgradeCode::ManifestInvalid);
    }
    let manifest: ReleaseManifest =
        serde_json::from_str(raw).map_err(|_| UpgradeCode::ManifestInvalid)?;
    if normalize_version(&manifest.version).is_empty() || manifest.platforms.is_empty() {
        return Err(UpgradeCode::ManifestInvalid);
    }
    // A manifest whose version cannot be parsed must not be able to advertise
    // anything at all; otherwise a typo silently downgrades every user to
    // "up to date".
    Version::parse(normalize_version(&manifest.version))
        .map_err(|_| UpgradeCode::ManifestInvalid)?;
    Ok(manifest)
}

/// Release tags are `v0.2.0`, semver is `0.2.0`.
pub fn normalize_version(raw: &str) -> &str {
    raw.trim().trim_start_matches('v').trim_start_matches('V')
}

pub fn is_newer(local: &str, remote: &str) -> bool {
    match (
        Version::parse(normalize_version(local)),
        Version::parse(normalize_version(remote)),
    ) {
        (Ok(current), Ok(latest)) => latest > current,
        _ => false,
    }
}

/// `std::env::consts` names mapped onto the keys Tauri uses in `latest.json`.
/// `None` means we can publish no package for this machine — the caller shows
/// the manual-download path instead of retrying forever.
pub fn platform_key(os: &str, arch: &str) -> Option<String> {
    let os = match os {
        "windows" => "windows",
        "macos" => "darwin",
        "linux" => "linux",
        _ => return None,
    };
    let arch = match arch {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        "x86" => "i686",
        "arm" => "armv7",
        _ => return None,
    };
    Some(format!("{os}-{arch}"))
}

/// The asset for this machine, or a machine code explaining why there is none.
/// The asset URL must be HTTPS, on an allowed host, and on the *same mirror*
/// the manifest came from; a signature is mandatory because the updater plugin
/// refuses to install anything without one.
pub fn select_platform<'a>(
    manifest: &'a ReleaseManifest,
    key: &str,
    upstream: Upstream,
) -> Result<&'a PlatformAsset, UpgradeCode> {
    let asset = manifest
        .platforms
        .get(key)
        .ok_or(UpgradeCode::UnsupportedPlatform)?;
    if asset.signature.trim().is_empty()
        || !allowed_https(&asset.url)
        || !upstream.matches_host(&asset.url)
    {
        return Err(UpgradeCode::ManifestInvalid);
    }
    Ok(asset)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(body: &str) -> ReleaseManifest {
        parse_manifest(body).expect("the fixture is a valid manifest")
    }

    const GITHUB_ASSET: &str =
        "https://github.com/ariacompute/agentbuddy/releases/download/v0.2.0/a.msi.zip";
    const GITEE_ASSET: &str =
        "https://gitee.com/ariacompute/agentbuddy/releases/download/v0.2.0/a.msi.zip";

    fn body(version: &str, url: &str) -> String {
        serde_json::json!({
            "version": version,
            "notes": "Fixes and improvements.",
            "pub_date": "2026-11-05T00:00:00Z",
            "platforms": {
                "windows-x86_64": { "url": url, "signature": "signature-bytes" },
                "darwin-aarch64": { "url": url, "signature": "signature-bytes" }
            }
        })
        .to_string()
    }

    #[test]
    fn parses_a_static_tauri_manifest() {
        let parsed = manifest(&body("0.2.0", GITHUB_ASSET));
        assert_eq!(parsed.version, "0.2.0");
        assert_eq!(parsed.notes.as_deref(), Some("Fixes and improvements."));
        assert_eq!(parsed.platforms.len(), 2);
    }

    #[test]
    fn ignores_the_extra_signatures_map_from_newer_releases() {
        // Newer releases sign all six downloads and publish the signatures in
        // the manifest itself instead of as `.sig` assets. Older clients must
        // keep reading `platforms` and simply ignore the unknown field.
        let mut raw = serde_json::from_str::<serde_json::Value>(&body("0.3.0", GITHUB_ASSET)).unwrap();
        raw["signatures"] = serde_json::json!({
            "agentbuddy-x64-0.3.0.msi": "c2lnbmF0dXJlLWJ5dGVz",
            "agentbuddy-windows-x86_64-0.3.0.zip": "c2lnbmF0dXJlLWJ5dGVz"
        });
        let parsed = manifest(&raw.to_string());
        assert_eq!(parsed.version, "0.3.0");
        assert_eq!(parsed.platforms.len(), 2);
        assert!(parsed.platforms.contains_key("windows-x86_64"));
        assert!(select_platform(&parsed, "windows-x86_64", Upstream::Github).is_ok());
    }

    #[test]
    fn refuses_manifests_that_cannot_be_trusted() {
        assert_eq!(parse_manifest(""), Err(UpgradeCode::ManifestInvalid));
        assert_eq!(parse_manifest("not json"), Err(UpgradeCode::ManifestInvalid));
        assert_eq!(parse_manifest("{}"), Err(UpgradeCode::ManifestInvalid));
        assert_eq!(
            parse_manifest(&serde_json::json!({"version":"0.2.0","platforms":{}}).to_string()),
            Err(UpgradeCode::ManifestInvalid)
        );
        assert_eq!(
            parse_manifest(&body("not-a-version", GITHUB_ASSET)).err(),
            Some(UpgradeCode::ManifestInvalid)
        );
        assert_eq!(
            parse_manifest(&format!("{{\"version\":\"0.2.0\"{}", " ".repeat(MAX_MANIFEST_BYTES))),
            Err(UpgradeCode::ManifestInvalid)
        );
    }

    #[test]
    fn version_comparison_handles_tags_prereleases_and_equality() {
        assert!(is_newer("0.1.0", "0.2.0"));
        assert!(is_newer("v0.1.0", "v0.2.0"));
        assert!(is_newer("0.1.0", "0.1.1"));
        assert!(is_newer("0.2.0-beta.1", "0.2.0"));
        assert!(!is_newer("0.2.0", "0.2.0"));
        assert!(!is_newer("0.3.0", "0.2.0"));
        assert!(!is_newer("0.1.0", "not a version"));
        assert!(!is_newer("dev", "0.2.0"), "an unparseable local build never auto-upgrades");
        assert_eq!(normalize_version(" V0.2.0 "), "0.2.0");
    }

    #[test]
    fn maps_the_platforms_we_publish() {
        assert_eq!(platform_key("windows", "x86_64").as_deref(), Some("windows-x86_64"));
        assert_eq!(platform_key("macos", "aarch64").as_deref(), Some("darwin-aarch64"));
        assert_eq!(platform_key("linux", "x86_64").as_deref(), Some("linux-x86_64"));
        assert_eq!(platform_key("windows", "aarch64").as_deref(), Some("windows-aarch64"));
        assert_eq!(platform_key("linux", "x86").as_deref(), Some("linux-i686"));
        assert_eq!(platform_key("freebsd", "x86_64"), None);
        assert_eq!(platform_key("windows", "sparc"), None);
    }

    #[test]
    fn picks_the_asset_for_this_machine() {
        let parsed = manifest(&body("0.2.0", GITHUB_ASSET));
        let asset = select_platform(&parsed, "windows-x86_64", Upstream::Github).unwrap();
        assert_eq!(asset.url, GITHUB_ASSET);
        let gitee = manifest(&body("0.2.0", GITEE_ASSET));
        assert!(select_platform(&gitee, "darwin-aarch64", Upstream::Gitee).is_ok());
    }

    #[test]
    fn a_platform_we_do_not_publish_is_a_graceful_unsupported_result() {
        let parsed = manifest(&body("0.2.0", GITHUB_ASSET));
        assert_eq!(
            select_platform(&parsed, "linux-aarch64", Upstream::Github),
            Err(UpgradeCode::UnsupportedPlatform)
        );
    }

    #[test]
    fn refuses_assets_from_another_mirror_or_without_a_signature() {
        let cross = manifest(&body("0.2.0", GITEE_ASSET));
        assert_eq!(
            select_platform(&cross, "windows-x86_64", Upstream::Github),
            Err(UpgradeCode::ManifestInvalid),
            "a GitHub manifest must not download from Gitee"
        );
        let unsigned = manifest(&serde_json::json!({
            "version": "0.2.0",
            "platforms": { "windows-x86_64": { "url": GITHUB_ASSET, "signature": "  " } }
        })
        .to_string());
        assert_eq!(
            select_platform(&unsigned, "windows-x86_64", Upstream::Github),
            Err(UpgradeCode::ManifestInvalid)
        );
        let hostile = manifest(&body("0.2.0", "https://evil.test/a.zip"));
        assert_eq!(
            select_platform(&hostile, "windows-x86_64", Upstream::Github),
            Err(UpgradeCode::ManifestInvalid)
        );
    }
}
