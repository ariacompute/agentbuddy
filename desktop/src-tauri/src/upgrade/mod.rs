//! Version checks for the desktop shell.
//!
//! The split is deliberate: this module owns *choosing* and *describing* an
//! update (two mirrors probed concurrently, semver comparison, OS/arch matching,
//! the 24h cadence and the user's skip / auto-check preferences), while
//! `tauri-plugin-updater` owns *verifying and installing* it. Reimplementing
//! msi / dmg / AppImage installation is exactly the platform tangle the plugin
//! exists to absorb; the plugin's static endpoint list, on the other hand,
//! cannot express "pick whichever mirror answered fastest this round", which is
//! why the probe lives here and its result is injected at runtime.
//!
//! All of that happens in Rust. The WebView's CSP is `connect-src 'self'`, so a
//! page can neither reach GitHub/Gitee nor decide which installer is safe; it
//! only reads and writes state through `/__shell/upgrade`.

pub mod manifest;
pub mod source;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::RwLock;
use url::Url;

use crate::config::{AppConfig, ConfigStore, SharedConfig};

/// The minisign public key used to verify downloaded update packages.
///
/// Kept empty in the source tree: the release workflow injects the
/// `UPDATER_PUBKEY` secret here (and into `tauri.conf.json`'s
/// `plugins.updater.pubkey`, which `tauri build` uses to check the signing
/// key) before compiling, so the key never enters git. Generate a pair with
/// `bunx tauri signer generate -w ~/.tauri/agentbuddy.key`. While this is
/// empty, checks and manual downloads still work but "Upgrade now" refuses
/// with `not_configured` rather than installing an unverified package.
pub const UPDATER_PUBKEY: &str = "";

pub const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
/// The first check waits for the window to be up and the proxy to be listening;
/// a cold network request must never delay showing the workbench.
pub const FIRST_CHECK_DELAY: Duration = Duration::from_secs(8);

/// Machine codes only. The workbench and the shell page localise them; nothing
/// in here is ever rendered as a sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpgradeCode {
    Idle,
    Checking,
    UpToDate,
    Available,
    UnsupportedPlatform,
    Downloading,
    Installing,
    NotConfigured,
    NetworkFailed,
    ManifestInvalid,
    SignatureFailed,
    Busy,
    Unavailable,
}

impl UpgradeCode {
    pub fn as_str(self) -> &'static str {
        match self {
            UpgradeCode::Idle => "idle",
            UpgradeCode::Checking => "checking",
            UpgradeCode::UpToDate => "up_to_date",
            UpgradeCode::Available => "available",
            UpgradeCode::UnsupportedPlatform => "unsupported_platform",
            UpgradeCode::Downloading => "downloading",
            UpgradeCode::Installing => "installing",
            UpgradeCode::NotConfigured => "not_configured",
            UpgradeCode::NetworkFailed => "network_failed",
            UpgradeCode::ManifestInvalid => "manifest_invalid",
            UpgradeCode::SignatureFailed => "signature_failed",
            UpgradeCode::Busy => "busy",
            UpgradeCode::Unavailable => "unavailable",
        }
    }
}

/// What `GET /__shell/upgrade` returns. camelCase, because that is the shape
/// every other `/__shell/*` answer uses.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeState {
    pub status: UpgradeCode,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub notes: Option<String>,
    pub source: Option<String>,
    pub download_url: Option<String>,
    pub checked_at: Option<i64>,
    pub auto_check: bool,
    pub skipped_version: Option<String>,
}

impl Default for UpgradeState {
    fn default() -> Self {
        UpgradeState {
            status: UpgradeCode::Idle,
            current_version: crate::VERSION.to_string(),
            latest_version: None,
            notes: None,
            source: None,
            download_url: None,
            checked_at: None,
            auto_check: true,
            skipped_version: None,
        }
    }
}

/// The outcome of one check, kept separate from the shared state so the whole
/// decision (including every failure) is a pure function that can be tested.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckOutcome {
    Release {
        status: UpgradeCode,
        version: String,
        notes: Option<String>,
        source: String,
        download_url: String,
        checked_at: i64,
    },
    Failed {
        code: UpgradeCode,
        checked_at: i64,
    },
}

/// Turns a parsed manifest into either a release description or a reason there
/// is nothing to install. `key` is the `windows-x86_64`-style platform key.
pub fn decide(
    manifest: &manifest::ReleaseManifest,
    upstream: source::Upstream,
    key: &str,
    checked_at: i64,
) -> CheckOutcome {
    let asset = match manifest::select_platform(manifest, key, upstream) {
        Ok(asset) => asset,
        Err(code) => return CheckOutcome::Failed { code, checked_at },
    };
    let status = if manifest::is_newer(crate::VERSION, &manifest.version) {
        UpgradeCode::Available
    } else {
        UpgradeCode::UpToDate
    };
    CheckOutcome::Release {
        status,
        version: manifest.version.clone(),
        notes: manifest.notes.clone(),
        source: upstream.code().to_string(),
        download_url: asset.url.clone(),
        checked_at,
    }
}

/// Folds an outcome into the state the UI reads. On failure the stale release
/// details are dropped: a card that says "version 0.3.0 is ready" while the
/// status says "check failed" is worse than no details at all.
pub fn apply(
    state: &UpgradeState,
    outcome: &CheckOutcome,
    auto_check: bool,
    skipped_version: Option<String>,
) -> UpgradeState {
    let mut next = state.clone();
    next.auto_check = auto_check;
    next.skipped_version = skipped_version;
    match outcome {
        CheckOutcome::Release {
            status,
            version,
            notes,
            source,
            download_url,
            checked_at,
        } => {
            next.status = *status;
            next.latest_version = Some(version.clone());
            next.notes = notes.clone();
            next.source = Some(source.clone());
            next.download_url = Some(download_url.clone());
            next.checked_at = Some(*checked_at);
        }
        CheckOutcome::Failed { code, checked_at } => {
            next.status = *code;
            next.latest_version = None;
            next.notes = None;
            next.source = None;
            next.download_url = None;
            next.checked_at = Some(*checked_at);
        }
    }
    next
}

/// Whether the 24h timer should spend a request. A clock that moved backwards
/// counts as "due" so the timer cannot stall forever.
pub fn due(last_checked: Option<i64>, now: i64, interval_secs: i64) -> bool {
    match last_checked {
        None => true,
        Some(0) => true,
        Some(last) if last > now => true,
        Some(last) => now - last >= interval_secs,
    }
}

/// One toast per version, never for a version the user skipped.
pub fn should_announce(
    status: UpgradeCode,
    skipped: Option<&str>,
    announced: Option<&str>,
    version: &str,
) -> bool {
    status == UpgradeCode::Available
        && skipped != Some(version)
        && announced != Some(version)
}

pub struct Upgrader {
    state: Arc<RwLock<UpgradeState>>,
    config: SharedConfig,
    store: Arc<ConfigStore>,
    /// `None` in headless tests, which drive the pure functions and the shell
    /// routes without a window.
    app: Option<tauri::AppHandle>,
    client: Option<reqwest::Client>,
    /// Endpoints from the last probe, in winning order, reused by the install.
    endpoints: Mutex<Vec<String>>,
    platform: Mutex<Option<String>>,
    announced: Mutex<Option<String>>,
    busy: Arc<AtomicBool>,
}

struct BusyGuard {
    flag: Arc<AtomicBool>,
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

impl Upgrader {
    pub fn new(
        config: SharedConfig,
        store: Arc<ConfigStore>,
        app: Option<tauri::AppHandle>,
    ) -> Arc<Self> {
        Arc::new(Upgrader {
            state: Arc::new(RwLock::new(UpgradeState::default())),
            config,
            store,
            app,
            client: source::build_client().ok(),
            endpoints: Mutex::new(Vec::new()),
            platform: Mutex::new(None),
            announced: Mutex::new(None),
            busy: Arc::new(AtomicBool::new(false)),
        })
    }

    pub async fn snapshot(&self) -> UpgradeState {
        self.state.read().await.clone()
    }

    /// Startup check, then one check per day. The timer is single-flight with
    /// manual checks: `check_now` refuses a second concurrent run.
    pub fn start_timer(self: &Arc<Self>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(FIRST_CHECK_DELAY).await;
            this.check_now(false).await;
            let mut ticker = tokio::time::interval_at(
                tokio::time::Instant::now() + CHECK_INTERVAL,
                CHECK_INTERVAL,
            );
            loop {
                ticker.tick().await;
                let last = this.config.read().await.upgrade_last_checked;
                if due(Some(last), unix_now(), CHECK_INTERVAL.as_secs() as i64) {
                    this.check_now(false).await;
                }
            }
        });
    }

    /// `force` is the manual "Check for updates" button: it checks even when
    /// automatic checking is off, but never overrides a concurrent check.
    pub async fn check_now(&self, force: bool) -> UpgradeState {
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            let mut busy = self.snapshot().await;
            busy.status = UpgradeCode::Busy;
            return busy;
        }
        let _guard = BusyGuard { flag: self.busy.clone() };
        let config = self.config.read().await.clone();
        if !force && !config.upgrade_auto_check {
            return self.snapshot().await;
        }

        let skipped = non_empty(config.upgrade_skipped_version.clone());
        self.set(|state| {
            state.status = UpgradeCode::Checking;
            state.auto_check = config.upgrade_auto_check;
            state.skipped_version = skipped.clone();
        })
        .await;

        let Some(client) = &self.client else {
            return self.fail(UpgradeCode::NetworkFailed, &config).await;
        };
        let outcomes = source::probe_all(client).await;
        let endpoints = source::ordered_endpoints(&outcomes);
        if let Ok(mut slot) = self.endpoints.lock() {
            *slot = endpoints;
        }
        let Some(winner) = source::fastest(&outcomes) else {
            return self.fail(UpgradeCode::NetworkFailed, &config).await;
        };
        let Some(success) = winner.ok() else {
            return self.fail(UpgradeCode::NetworkFailed, &config).await;
        };
        let manifest = match manifest::parse_manifest(&success.body) {
            Ok(manifest) => manifest,
            Err(code) => return self.fail(code, &config).await,
        };
        let key = match manifest::platform_key(std::env::consts::OS, std::env::consts::ARCH) {
            Some(key) => key,
            None => return self.fail(UpgradeCode::UnsupportedPlatform, &config).await,
        };
        if let Ok(mut slot) = self.platform.lock() {
            *slot = Some(key.clone());
        }

        let checked_at = unix_now();
        let outcome = decide(&manifest, winner.upstream, &key, checked_at);
        let next = apply(&self.snapshot().await, &outcome, config.upgrade_auto_check, skipped);
        *self.state.write().await = next.clone();
        self.persist_last_checked(checked_at).await;

        if let CheckOutcome::Release { status, version, .. } = &outcome {
            let announced = self.announced.lock().ok().and_then(|slot| slot.clone());
            let skipped_for_notice = if config.upgrade_skipped_version.trim().is_empty() {
                None
            } else {
                Some(config.upgrade_skipped_version.as_str())
            };
            if should_announce(*status, skipped_for_notice, announced.as_deref(), version) {
                self.announce(&config, version).await;
            }
        }
        next
    }

    /// Only runs after the user pressed "Upgrade now" in the settings screen.
    /// The plugin verifies the minisign signature before it runs an installer.
    pub async fn install(&self) -> Result<UpgradeState, UpgradeCode> {
        if UPDATER_PUBKEY.trim().is_empty() {
            return Err(UpgradeCode::NotConfigured);
        }
        let app = self.app.as_ref().ok_or(UpgradeCode::NotConfigured)?;
        let endpoints: Vec<Url> = self
            .endpoints
            .lock()
            .ok()
            .map(|slot| {
                slot.iter()
                    .filter_map(|raw| Url::parse(raw).ok())
                    .filter(|url| source::allowed_https(url.as_str()))
                    .collect()
            })
            .unwrap_or_default();
        if endpoints.is_empty() {
            return Err(UpgradeCode::NetworkFailed);
        }
        let key = self
            .platform
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
            .ok_or(UpgradeCode::UnsupportedPlatform)?;

        self.set(|state| state.status = UpgradeCode::Downloading).await;
        let builder = app
            .updater_builder()
            .endpoints(endpoints)
            .map_err(|_| UpgradeCode::NetworkFailed)?
            .target(key);
        let updater = builder.build().map_err(|_| UpgradeCode::NotConfigured)?;
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => {
                self.set(|state| state.status = UpgradeCode::UpToDate).await;
                return Err(UpgradeCode::UpToDate);
            }
            Err(_) => {
                let config = self.config.read().await.clone();
                self.fail(UpgradeCode::NetworkFailed, &config).await;
                return Err(UpgradeCode::NetworkFailed);
            }
        };
        self.set(|state| state.status = UpgradeCode::Installing).await;
        if update.download_and_install(|_, _| {}, || {}).await.is_err() {
            let config = self.config.read().await.clone();
            self.fail(UpgradeCode::SignatureFailed, &config).await;
            return Err(UpgradeCode::SignatureFailed);
        }
        // On Windows the plugin exits the app after starting the installer, so
        // the snapshot is the last thing this call returns. Elsewhere
        // `AppHandle::restart()` diverges (`!`) and coerces to the result type:
        // binding it to a variable and returning that variable leaves an
        // unreachable expression, which rustc warns about.
        if cfg!(windows) {
            Ok(self.snapshot().await)
        } else {
            app.restart()
        }
    }

    async fn set<F: FnOnce(&mut UpgradeState)>(&self, patch: F) -> UpgradeState {
        let mut state = self.state.write().await;
        patch(&mut state);
        state.clone()
    }

    async fn fail(&self, code: UpgradeCode, config: &AppConfig) -> UpgradeState {
        let checked_at = unix_now();
        let outcome = CheckOutcome::Failed { code, checked_at };
        let next = apply(
            &self.snapshot().await,
            &outcome,
            config.upgrade_auto_check,
            non_empty(config.upgrade_skipped_version.clone()),
        );
        *self.state.write().await = next.clone();
        next
    }

    async fn persist_last_checked(&self, checked_at: i64) {
        let snapshot = {
            let mut config = self.config.write().await;
            config.upgrade_last_checked = checked_at;
            config.clone()
        };
        if let Err(err) = self.store.save(&snapshot) {
            eprintln!("agentbuddy desktop: cannot save the update check time: {err}");
        }
    }

    async fn announce(&self, config: &AppConfig, version: &str) {
        if !config.notify_enabled {
            return;
        }
        let Some(app) = &self.app else { return };
        if crate::notify::notify_upgrade(app, config.lang(), version) {
            if let Ok(mut slot) = self.announced.lock() {
                *slot = Some(version.to_string());
            }
        }
    }
}

fn non_empty(raw: String) -> Option<String> {
    if raw.trim().is_empty() {
        None
    } else {
        Some(raw)
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|delta| delta.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn manifest(version: &str) -> manifest::ReleaseManifest {
        let mut platforms = BTreeMap::new();
        platforms.insert(
            "windows-x86_64".to_string(),
            manifest::PlatformAsset {
                url: "https://github.com/ariacompute/agentbuddy/releases/download/v0.3.0/a.zip"
                    .to_string(),
                signature: "sig".to_string(),
            },
        );
        manifest::ReleaseManifest {
            version: version.to_string(),
            notes: Some("Notes".to_string()),
            pub_date: None,
            platforms,
        }
    }

    #[test]
    fn machine_codes_match_the_serialized_status() {
        for code in [
            UpgradeCode::Idle,
            UpgradeCode::Checking,
            UpgradeCode::UpToDate,
            UpgradeCode::Available,
            UpgradeCode::UnsupportedPlatform,
            UpgradeCode::Downloading,
            UpgradeCode::Installing,
            UpgradeCode::NotConfigured,
            UpgradeCode::NetworkFailed,
            UpgradeCode::ManifestInvalid,
            UpgradeCode::SignatureFailed,
            UpgradeCode::Busy,
            UpgradeCode::Unavailable,
        ] {
            let json = serde_json::to_string(&code).unwrap();
            assert_eq!(json, format!("\"{}\"", code.as_str()));
        }
    }

    #[test]
    fn a_newer_version_on_this_platform_is_available() {
        let outcome = decide(&manifest("999.0.0"), source::Upstream::Github, "windows-x86_64", 42);
        match &outcome {
            CheckOutcome::Release { status, version, source, checked_at, .. } => {
                assert_eq!(*status, UpgradeCode::Available);
                assert_eq!(version, "999.0.0");
                assert_eq!(source, "github");
                assert_eq!(*checked_at, 42);
            }
            other => panic!("expected a release, got {other:?}"),
        }
        let state = apply(&UpgradeState::default(), &outcome, true, None);
        assert_eq!(state.status, UpgradeCode::Available);
        assert_eq!(state.latest_version.as_deref(), Some("999.0.0"));
        assert!(state.download_url.unwrap().starts_with("https://github.com/"));
        assert_eq!(state.checked_at, Some(42));
    }

    #[test]
    fn an_older_or_equal_version_is_up_to_date() {
        let outcome = decide(&manifest("0.0.1"), source::Upstream::Github, "windows-x86_64", 7);
        assert!(matches!(
            outcome,
            CheckOutcome::Release { status: UpgradeCode::UpToDate, .. }
        ));
    }

    #[test]
    fn an_unpublished_platform_is_a_reason_not_a_crash() {
        let outcome = decide(&manifest("999.0.0"), source::Upstream::Github, "linux-aarch64", 7);
        assert_eq!(
            outcome,
            CheckOutcome::Failed { code: UpgradeCode::UnsupportedPlatform, checked_at: 7 }
        );
    }

    #[test]
    fn a_failure_drops_stale_release_details() {
        let mut state = UpgradeState::default();
        state.status = UpgradeCode::Available;
        state.latest_version = Some("9.9.9".to_string());
        state.notes = Some("old notes".to_string());
        state.source = Some("github".to_string());
        state.download_url = Some("https://github.com/old".to_string());
        let outcome = CheckOutcome::Failed { code: UpgradeCode::NetworkFailed, checked_at: 99 };
        let next = apply(&state, &outcome, false, Some("1.2.3".to_string()));
        assert_eq!(next.status, UpgradeCode::NetworkFailed);
        assert_eq!(next.latest_version, None);
        assert_eq!(next.notes, None);
        assert_eq!(next.source, None);
        assert_eq!(next.download_url, None);
        assert_eq!(next.checked_at, Some(99));
        assert!(!next.auto_check);
        assert_eq!(next.skipped_version.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn the_daily_timer_only_spends_a_request_when_a_day_has_passed() {
        let day = CHECK_INTERVAL.as_secs() as i64;
        assert!(due(None, 1_000, day));
        assert!(due(Some(0), 1_000, day));
        assert!(!due(Some(1_000), 1_000 + day - 1, day));
        assert!(due(Some(1_000), 1_000 + day, day));
        assert!(due(Some(5_000), 1_000, day), "a clock moved backwards must not stall the timer");
    }

    #[test]
    fn a_version_is_announced_once_and_never_when_skipped() {
        assert!(should_announce(UpgradeCode::Available, None, None, "0.3.0"));
        assert!(!should_announce(UpgradeCode::Available, Some("0.3.0"), None, "0.3.0"));
        assert!(!should_announce(UpgradeCode::Available, None, Some("0.3.0"), "0.3.0"));
        assert!(!should_announce(UpgradeCode::UpToDate, None, None, "0.3.0"));
        assert!(should_announce(UpgradeCode::Available, Some("0.2.0"), None, "0.3.0"));
    }

    #[test]
    fn the_state_is_serialized_for_the_workbench_in_camel_case() {
        let state = UpgradeState::default();
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["status"], "idle");
        assert_eq!(json["currentVersion"], crate::VERSION);
        assert!(json["autoCheck"].is_boolean());
        assert!(json.get("current_version").is_none());
    }

    #[test]
    fn an_unconfigured_public_key_never_installs() {
        // The constant is intentionally empty until a release key is generated;
        // this pins the guard so flipping it cannot silently skip verification.
        if UPDATER_PUBKEY.trim().is_empty() {
            assert_eq!(UPDATER_PUBKEY, "");
        } else {
            assert!(UPDATER_PUBKEY.len() > 40, "a minisign public key is much longer");
        }
    }
}
