//! Upstream selection for release manifests.
//!
//! Two mirrors publish the same `latest.json` and the same signed bytes:
//! `github.com/ariacompute/agentbuddy` and `gitee.com/ariacompute/agentbuddy`.
//! Which one to use is a network decision, not a geographic one: both are
//! probed concurrently and the fastest reachable mirror wins. Nothing here
//! looks at the user's IP, locale or location.

use std::time::{Duration, Instant};

use reqwest::Client;
use serde::Deserialize;
use url::Url;

/// Hard upper bound for one probe. A mirror that cannot answer in time is
/// simply absent from this round; the other one still gets used.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// A release manifest is a few hundred bytes; anything larger is not one.
pub const MAX_MANIFEST_BYTES: usize = 256 * 1024;

pub const GITHUB_MANIFEST: &str =
    "https://github.com/ariacompute/agentbuddy/releases/latest/download/latest.json";
pub const GITHUB_RELEASE_PAGE: &str =
    "https://github.com/ariacompute/agentbuddy/releases/latest";
pub const GITEE_RELEASE_API: &str =
    "https://gitee.com/api/v5/repos/ariacompute/agentbuddy/releases/latest";
pub const GITEE_RELEASE_PAGE: &str = "https://gitee.com/ariacompute/agentbuddy/releases";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upstream {
    Github,
    Gitee,
}

impl Upstream {
    pub const ALL: [Upstream; 2] = [Upstream::Github, Upstream::Gitee];

    /// Machine code, not prose: the UI localises it.
    pub fn code(self) -> &'static str {
        match self {
            Upstream::Github => "github",
            Upstream::Gitee => "gitee",
        }
    }

    /// A brand name, safe to render as-is in every language.
    pub fn name(self) -> &'static str {
        match self {
            Upstream::Github => "GitHub",
            Upstream::Gitee => "Gitee",
        }
    }

    /// Where "manual download" sends the user.
    pub fn release_page(self) -> &'static str {
        match self {
            Upstream::Github => GITHUB_RELEASE_PAGE,
            Upstream::Gitee => GITEE_RELEASE_PAGE,
        }
    }

    /// A manifest URL worth trying even when this mirror did not answer the
    /// probe. GitHub publishes a stable `latest/download` alias; Gitee resolves
    /// release assets under the tag, so it has no static URL until its release
    /// API has told us what the tag is.
    pub fn fallback_manifest(self) -> Option<&'static str> {
        match self {
            Upstream::Github => Some(GITHUB_MANIFEST),
            Upstream::Gitee => None,
        }
    }

    /// Whether an asset URL belongs to this mirror. A manifest fetched from one
    /// mirror must never point the installer at somebody else's host.
    pub fn matches_host(self, raw: &str) -> bool {
        let Ok(url) = Url::parse(raw) else { return false };
        if !is_https(&url) {
            return false;
        }
        let host = url.host_str().unwrap_or("").to_ascii_lowercase();
        match self {
            Upstream::Github => {
                host == "github.com"
                    || host == "www.github.com"
                    || host.ends_with(".githubusercontent.com")
            }
            Upstream::Gitee => host == "gitee.com" || host.ends_with(".gitee.com"),
        }
    }
}

fn is_https(url: &Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
}

/// Hosts a manifest or an installer may live on. Release assets are served from
/// the mirrors themselves or their download CDNs — never from an arbitrary host
/// named inside a manifest (which would turn a compromised mirror into an
/// arbitrary-download primitive).
pub fn host_allowed(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "github.com"
        || host == "www.github.com"
        || host == "api.github.com"
        || host == "gitee.com"
        || host.ends_with(".gitee.com")
        || host.ends_with(".githubusercontent.com")
}

pub fn allowed_https(raw: &str) -> bool {
    match Url::parse(raw) {
        Ok(url) => is_https(&url) && url.host_str().map(host_allowed).unwrap_or(false),
        Err(_) => false,
    }
}

/// Tags come from the Gitee release API and are pasted into a URL, so only a
/// conservative character set is allowed through.
pub fn valid_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 64
        && tag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

pub fn gitee_manifest_url(tag: &str) -> Option<String> {
    if !valid_tag(tag) {
        return None;
    }
    Some(format!(
        "https://gitee.com/ariacompute/agentbuddy/releases/download/{tag}/latest.json"
    ))
}

pub fn build_client() -> Result<Client, &'static str> {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(PROBE_TIMEOUT)
        // `releases/latest/download` redirects to a CDN; refusing redirects
        // would make the GitHub mirror look unreachable on every check.
        .redirect(reqwest::redirect::Policy::limited(4))
        .user_agent(format!("agentbuddy-desktop/{}", crate::VERSION))
        .build()
        .map_err(|_| "network_failed")
}

#[derive(Debug, Clone)]
pub struct ProbeSuccess {
    pub manifest_url: String,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct ProbeOutcome {
    pub upstream: Upstream,
    pub elapsed_ms: u64,
    pub result: Result<ProbeSuccess, &'static str>,
}

impl ProbeOutcome {
    pub fn ok(&self) -> Option<&ProbeSuccess> {
        self.result.as_ref().ok()
    }
}

/// Both mirrors are queried at once; neither may delay the other.
pub async fn probe_all(client: &Client) -> Vec<ProbeOutcome> {
    let (github, gitee) = tokio::join!(
        probe(client, Upstream::Github),
        probe(client, Upstream::Gitee)
    );
    vec![github, gitee]
}

async fn probe(client: &Client, upstream: Upstream) -> ProbeOutcome {
    let started = Instant::now();
    let result = match upstream {
        Upstream::Github => fetch_body(client, GITHUB_MANIFEST)
            .await
            .map(|body| ProbeSuccess { manifest_url: GITHUB_MANIFEST.to_string(), body }),
        Upstream::Gitee => match resolve_gitee_manifest(client).await {
            Ok(url) => fetch_body(client, &url)
                .await
                .map(|body| ProbeSuccess { manifest_url: url, body }),
            Err(code) => Err(code),
        },
    };
    ProbeOutcome { upstream, elapsed_ms: started.elapsed().as_millis() as u64, result }
}

#[derive(Debug, Deserialize)]
struct GiteeRelease {
    tag_name: Option<String>,
}

/// Gitee has no dependable `/releases/latest/download/` alias, so its tag is
/// resolved through the public release API before the manifest is fetched.
async fn resolve_gitee_manifest(client: &Client) -> Result<String, &'static str> {
    let response = client
        .get(GITEE_RELEASE_API)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| "network_failed")?;
    if !response.status().is_success() {
        return Err("network_failed");
    }
    let release: GiteeRelease = response.json().await.map_err(|_| "manifest_invalid")?;
    let tag = release.tag_name.ok_or("manifest_invalid")?;
    gitee_manifest_url(&tag).ok_or("manifest_invalid")
}

async fn fetch_body(client: &Client, url: &str) -> Result<String, &'static str> {
    if !allowed_https(url) {
        return Err("manifest_invalid");
    }
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| "network_failed")?;
    if !response.status().is_success() {
        return Err("network_failed");
    }
    // A redirect may land anywhere; the final URL is what actually served us.
    if !allowed_https(response.url().as_str()) {
        return Err("manifest_invalid");
    }
    if response.content_length().unwrap_or(0) as usize > MAX_MANIFEST_BYTES {
        return Err("manifest_invalid");
    }
    let bytes = response.bytes().await.map_err(|_| "network_failed")?;
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err("manifest_invalid");
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "manifest_invalid")
}

/// The fastest mirror that actually answered. Ties keep the declaration order
/// (GitHub first), which is deterministic and needs no stored preference.
pub fn fastest(outcomes: &[ProbeOutcome]) -> Option<&ProbeOutcome> {
    outcomes
        .iter()
        .filter(|outcome| outcome.result.is_ok())
        .min_by_key(|outcome| outcome.elapsed_ms)
}

/// Endpoints handed to the updater plugin: winners first, then a static
/// fallback for the mirror that did not answer. The plugin tries them in order,
/// so a mirror that dies between the probe and the install still fails over.
pub fn ordered_endpoints(outcomes: &[ProbeOutcome]) -> Vec<String> {
    let mut answered: Vec<&ProbeOutcome> =
        outcomes.iter().filter(|outcome| outcome.result.is_ok()).collect();
    answered.sort_by_key(|outcome| outcome.elapsed_ms);
    let mut urls: Vec<String> = answered
        .iter()
        .filter_map(|outcome| outcome.ok().map(|ok| ok.manifest_url.clone()))
        .collect();
    for outcome in outcomes.iter().filter(|outcome| outcome.result.is_err()) {
        if let Some(url) = outcome.upstream.fallback_manifest() {
            if !urls.iter().any(|existing| existing == url) {
                urls.push(url.to_string());
            }
        }
    }
    if urls.is_empty() {
        urls.push(GITHUB_MANIFEST.to_string());
    }
    urls.retain(|url| allowed_https(url));
    urls
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(upstream: Upstream, ms: u64, result: Result<&str, &'static str>) -> ProbeOutcome {
        ProbeOutcome {
            upstream,
            elapsed_ms: ms,
            result: result.map(|url| ProbeSuccess {
                manifest_url: url.to_string(),
                body: "{}".to_string(),
            }),
        }
    }

    #[test]
    fn only_https_urls_on_known_hosts_are_allowed() {
        assert!(allowed_https(GITHUB_MANIFEST));
        assert!(allowed_https(GITEE_RELEASE_API));
        assert!(allowed_https("https://objects.githubusercontent.com/a/b.zip"));
        assert!(allowed_https("https://foruda.gitee.com/asset.zip"));
        assert!(!allowed_https("http://github.com/a/latest.json"));
        assert!(!allowed_https("https://github.com.evil.test/a"));
        assert!(!allowed_https("https://user:pw@github.com/a"));
        assert!(!allowed_https("file:///etc/passwd"));
        assert!(!allowed_https("not a url"));
        assert!(host_allowed("GitHub.COM"));
        assert!(!host_allowed("gitee.com.evil.test"));
    }

    #[test]
    fn a_manifest_must_point_at_its_own_mirror() {
        assert!(Upstream::Github.matches_host(GITHUB_MANIFEST));
        assert!(Upstream::Github
            .matches_host("https://release-assets.githubusercontent.com/a.zip"));
        assert!(Upstream::Gitee.matches_host("https://gitee.com/o/r/releases/download/v1/a.zip"));
        assert!(!Upstream::Gitee.matches_host(GITHUB_MANIFEST));
        assert!(!Upstream::Github.matches_host("https://gitee.com/a.zip"));
        assert!(!Upstream::Github.matches_host("https://github.com.evil.test/a"));
        assert!(!Upstream::Github.matches_host("//gitee.com/a"));
    }

    #[test]
    fn gitee_tags_are_url_safe() {
        assert_eq!(
            gitee_manifest_url("v0.2.0").as_deref(),
            Some("https://gitee.com/ariacompute/agentbuddy/releases/download/v0.2.0/latest.json")
        );
        assert!(gitee_manifest_url("v1.0.0-beta.1").is_some());
        assert_eq!(gitee_manifest_url("../../evil"), None);
        assert_eq!(gitee_manifest_url("v1?x=1"), None);
        assert_eq!(gitee_manifest_url(""), None);
        assert_eq!(gitee_manifest_url(&"x".repeat(65)), None);
    }

    #[test]
    fn a_tie_keeps_the_first_mirror() {
        let both = [
            outcome(Upstream::Github, 40, Ok(GITHUB_MANIFEST)),
            outcome(Upstream::Gitee, 40, Ok("https://gitee.com/o/r/releases/download/v1/latest.json")),
        ];
        assert_eq!(fastest(&both).unwrap().upstream, Upstream::Github);
    }

    #[test]
    fn the_faster_answer_wins_even_when_it_is_second() {
        let both = [
            outcome(Upstream::Github, 900, Ok(GITHUB_MANIFEST)),
            outcome(Upstream::Gitee, 120, Ok("https://gitee.com/o/r/releases/download/v1/latest.json")),
        ];
        assert_eq!(fastest(&both).unwrap().upstream, Upstream::Gitee);
        assert_eq!(ordered_endpoints(&both)[0], "https://gitee.com/o/r/releases/download/v1/latest.json");
    }

    #[test]
    fn a_failed_mirror_does_not_win_but_stays_as_a_fallback() {
        let both = [
            outcome(Upstream::Github, 10, Err("network_failed")),
            outcome(Upstream::Gitee, 300, Ok("https://gitee.com/o/r/releases/download/v1/latest.json")),
        ];
        assert_eq!(fastest(&both).unwrap().upstream, Upstream::Gitee);
        let urls = ordered_endpoints(&both);
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[0], "https://gitee.com/o/r/releases/download/v1/latest.json");
        assert_eq!(urls[1], GITHUB_MANIFEST, "the failed mirror is still tried by the plugin");
    }

    #[test]
    fn when_both_mirrors_fail_the_static_manifest_is_still_tried() {
        let both = [
            outcome(Upstream::Github, 10, Err("network_failed")),
            outcome(Upstream::Gitee, 12, Err("network_failed")),
        ];
        assert!(fastest(&both).is_none());
        assert_eq!(ordered_endpoints(&both), vec![GITHUB_MANIFEST.to_string()]);
    }

    #[test]
    fn endpoints_are_deduplicated_and_never_include_a_host_we_do_not_trust() {
        let both = [
            outcome(Upstream::Github, 10, Ok("https://evil.test/latest.json")),
            outcome(Upstream::Gitee, 20, Ok(GITHUB_MANIFEST)),
        ];
        let urls = ordered_endpoints(&both);
        assert_eq!(urls, vec![GITHUB_MANIFEST.to_string()]);
    }

    #[test]
    fn every_mirror_has_a_code_a_name_and_a_download_page() {
        for upstream in Upstream::ALL {
            assert!(!upstream.code().is_empty());
            assert!(!upstream.name().is_empty());
            assert!(allowed_https(upstream.release_page()));
        }
        assert_eq!(Upstream::Gitee.fallback_manifest(), None);
        assert_eq!(Upstream::Github.fallback_manifest(), Some(GITHUB_MANIFEST));
    }
}
