//! Connection configuration: where the server is, and what language the shell
//! speaks. It also carries the resident / notification preferences, because those
//! decide how the shell behaves after the window is closed — and the shell has to
//! know that before it can ask the server anything.
//!
//! It lives in the shell's own file (`app_config_dir/config.json`), not in the
//! server's database.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::i18n;

/// The persisted shape. `server_url` empty means "not configured yet", which is
/// what sends the shell to the connection page.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppConfig {
    #[serde(default)]
    pub server_url: String,
    #[serde(default)]
    pub accept_invalid_certs: bool,
    /// Empty means "follow the system language".
    #[serde(default)]
    pub lang: String,
    /// When true (the default), closing the window keeps the app running in the
    /// tray instead of quitting. The connection / settings page can turn this
    /// off, in which case closing the window ends the app.
    #[serde(default = "default_true")]
    pub background: bool,
    /// Whether OS notifications may be shown by the webview via `/__shell/notify`.
    /// Enabled by default so the app surfaces alerts out of the box.
    #[serde(default = "default_true")]
    pub notify_enabled: bool,
    /// Suppress OS notifications for this many minutes after the user goes quiet.
    /// 0 means "never quiet".
    #[serde(default)]
    pub notify_quiet_minutes: u16,
    /// Whether this machine serves as an execution node for the configured
    /// server. Off by default: a desktop does not start accepting commands just
    /// because the feature exists. Turning it on is an explicit, warned decision
    /// in the settings screen.
    #[serde(default)]
    pub executor_enabled: bool,
    /// The only directory tree a job may read, write or run in. Empty means the
    /// executor refuses to start: an unbounded node is not a sandbox.
    #[serde(default)]
    pub executor_root: String,
    /// Exact command names that may run, never paths and never a shell. Empty
    /// means nothing runs — a whitelist that lists nothing permits nothing.
    #[serde(default)]
    pub executor_allowlist: Vec<String>,
    /// How many jobs run at once on this machine.
    #[serde(default = "default_concurrency")]
    pub executor_max_concurrency: u16,
    /// Stable identity of this machine. Generated the first time the executor is
    /// switched on, so a restart re-enrolls the same node instead of adding a
    /// second one to the console.
    #[serde(default)]
    pub executor_node_id: String,
    /// Optional API key. Empty means "use the session this app is already signed
    /// in with", which is the common case: the node acts as its own user.
    #[serde(default)]
    pub executor_api_key: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            server_url: String::new(),
            accept_invalid_certs: false,
            lang: String::new(),
            background: true,
            notify_enabled: true,
            notify_quiet_minutes: 0,
            executor_enabled: false,
            executor_root: String::new(),
            executor_allowlist: Vec::new(),
            executor_max_concurrency: default_concurrency(),
            executor_node_id: String::new(),
            executor_api_key: String::new(),
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_concurrency() -> u16 {
    1
}

/// Shared between the tray (which reads it for menu labels) and the proxy
/// (which reads it for every forwarded request).
pub type SharedConfig = Arc<RwLock<AppConfig>>;

impl AppConfig {
    /// The language to render the shell in: the chosen one, else the system's.
    pub fn lang(&self) -> &'static str {
        if self.lang.is_empty() {
            return i18n::detect_system_lang();
        }
        i18n::match_lang(&self.lang)
    }

    /// The configured server, trailing slash removed, or `None` when the user
    /// has not pointed the shell anywhere yet.
    pub fn server_url(&self) -> Option<String> {
        normalize_server_url(&self.server_url).ok()
    }

    pub fn is_configured(&self) -> bool {
        self.server_url().is_some()
    }
}

/// Why an address is not acceptable.
#[derive(Debug, PartialEq, Eq)]
pub enum UrlError {
    Empty,
    Invalid,
}

impl std::fmt::Display for UrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UrlError::Empty => f.write_str("empty"),
            UrlError::Invalid => f.write_str("invalid"),
        }
    }
}

/// Accepts only `http`/`https` URLs with a host, and returns them without a
/// trailing slash so joining a path onto them is unambiguous.
pub fn normalize_server_url(raw: &str) -> Result<String, UrlError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(UrlError::Empty);
    }
    let parsed = url::Url::parse(trimmed).map_err(|_| UrlError::Invalid)?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(UrlError::Invalid),
    }
    if parsed.host_str().map(|h| h.is_empty()).unwrap_or(true) {
        return Err(UrlError::Invalid);
    }
    // Drop anything the workbench would never want to carry: a query string, a
    // fragment, or a trailing slash. Credentials in the userinfo are kept —
    // some deployments front the workbench with basic auth — but are never logged.
    let mut out = parsed.clone();
    out.set_query(None);
    out.set_fragment(None);
    Ok(out.as_str().trim_end_matches('/').to_string())
}

#[derive(Debug)]
pub enum ConfigError {
    Io(io::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Io(err) => write!(f, "cannot read or write the config file: {err}"),
            ConfigError::Json(err) => write!(f, "the config file is not valid JSON: {err}"),
        }
    }
}

impl From<io::Error> for ConfigError {
    fn from(err: io::Error) -> Self {
        ConfigError::Io(err)
    }
}

impl From<serde_json::Error> for ConfigError {
    fn from(err: serde_json::Error) -> Self {
        ConfigError::Json(err)
    }
}

/// The persisted shape of `session.json`. It mirrors the upstream session
/// cookie the loopback proxy replays on launch so a relaunch of the shell
/// resumes the agenthub session instead of forcing a fresh login.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionFile {
    /// The server the cookie belongs to, so it is never replayed to a
    /// different server after the user re-points the shell.
    server: String,
    /// The `Cookie` header value the proxy's jar currently holds, or empty
    /// once the session is cleared (logout / expiry).
    cookie: String,
}

/// Reads and writes `config.json` in one directory.
#[derive(Debug, Clone)]
pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(dir: PathBuf) -> Self {
        ConfigStore { path: dir.join("config.json") }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn session_path(&self) -> PathBuf {
        let mut path = self.path.clone();
        path.set_file_name("session.json");
        path
    }

    /// Saves (or, when `cookie` is empty, clears) the session tied to `server`.
    ///
    /// The session lives in `session.json` next to `config.json`, owner-only,
    /// because it is a bearer-equivalent token for the configured agenthub.
    pub fn save_session(&self, server: &str, cookie: &str) -> Result<(), ConfigError> {
        let path = self.session_path();
        if cookie.is_empty() {
            if path.exists() {
                let _ = fs::remove_file(&path);
            }
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string(&SessionFile {
            server: server.to_string(),
            cookie: cookie.to_string(),
        })?;
        fs::write(&path, text)?;
        restrict_to_owner(&path);
        Ok(())
    }

    /// Returns the saved session cookie for `server`, or `None` when there is
    /// none or it was saved for a different server.
    pub fn load_session_cookie(&self, server: &str) -> Option<String> {
        let path = self.session_path();
        let text = fs::read_to_string(&path).ok()?;
        let file: SessionFile = serde_json::from_str(&text).ok()?;
        if file.server == server && !file.cookie.is_empty() {
            Some(file.cookie)
        } else {
            None
        }
    }

    /// Missing or unreadable config is not an error: it means "first run".
    pub fn load(&self) -> AppConfig {
        match fs::read_to_string(&self.path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        }
    }

    pub fn save(&self, config: &AppConfig) -> Result<(), ConfigError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(config)?;
        fs::write(&self.path, text)?;
        restrict_to_owner(&self.path);
        Ok(())
    }
}

/// The config can hold a URL with credentials, so keep it to the current user.
#[cfg(unix)]
fn restrict_to_owner(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_to_owner(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_and_https_addresses() {
        assert_eq!(normalize_server_url("http://localhost:3500").unwrap(), "http://localhost:3500");
        assert_eq!(normalize_server_url("https://hub.example.com").unwrap(), "https://hub.example.com");
    }

    #[test]
    fn drops_the_trailing_slash_and_the_query() {
        assert_eq!(
            normalize_server_url("https://hub.example.com/").unwrap(),
            "https://hub.example.com"
        );
        assert_eq!(
            normalize_server_url("https://hub.example.com/agentbuddy/?a=1#x").unwrap(),
            "https://hub.example.com/agentbuddy"
        );
    }

    #[test]
    fn keeps_a_path_prefix_so_joining_a_route_stays_correct() {
        assert_eq!(
            normalize_server_url("https://example.com/agentbuddy").unwrap(),
            "https://example.com/agentbuddy"
        );
    }

    #[test]
    fn refuses_anything_that_is_not_an_address() {
        assert_eq!(normalize_server_url(""), Err(UrlError::Empty));
        assert_eq!(normalize_server_url("   "), Err(UrlError::Empty));
        assert_eq!(normalize_server_url("hub.example.com"), Err(UrlError::Invalid));
        assert_eq!(normalize_server_url("ftp://hub.example.com"), Err(UrlError::Invalid));
        assert_eq!(normalize_server_url("file:///etc/passwd"), Err(UrlError::Invalid));
        assert_eq!(normalize_server_url("https://"), Err(UrlError::Invalid));
    }

    #[test]
    fn an_empty_url_means_unconfigured() {
        let config = AppConfig::default();
        assert!(!config.is_configured());
        assert_eq!(config.server_url(), None);
    }

    #[test]
    fn a_stored_url_that_stopped_being_valid_counts_as_unconfigured() {
        let config = AppConfig { server_url: "not a url".into(), ..Default::default() };
        assert!(!config.is_configured());
    }

    #[test]
    fn background_defaults_to_running_in_tray() {
        let config = AppConfig::default();
        assert!(config.background, "closing must park in the tray by default");
        assert!(config.notify_enabled, "OS notifications must be on by default");
        assert_eq!(config.notify_quiet_minutes, 0);
    }

    #[test]
    fn a_round_trip_through_the_store_keeps_every_field() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-cfg-{}", std::process::id()));
        let store = ConfigStore::new(dir.clone());
        let config = AppConfig {
            server_url: "https://hub.example.com".into(),
            accept_invalid_certs: true,
            lang: "zh-TW".into(),
            background: true,
            notify_enabled: true,
            notify_quiet_minutes: 15,
            executor_enabled: true,
            executor_root: "/home/me/work".into(),
            executor_allowlist: vec!["git".into(), "npm".into()],
            executor_max_concurrency: 2,
            executor_node_id: "node-abc".into(),
            executor_api_key: "key".into(),
        };
        store.save(&config).unwrap();
        assert_eq!(store.load(), config);
        assert_eq!(store.load().lang(), "zh-TW");
        assert!(store.load().is_configured());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_execution_node_is_off_until_it_is_switched_on() {
        let config = AppConfig::default();
        assert!(!config.executor_enabled, "a desktop must not accept commands by default");
        assert!(config.executor_allowlist.is_empty(), "an empty whitelist permits nothing");
        assert_eq!(config.executor_max_concurrency, 1);
        assert!(config.executor_root.is_empty());
    }

    #[test]
    fn an_old_config_file_without_the_executor_block_still_loads() {
        // The fields were added after the first release; a config written by an
        // older build must keep working and must leave the node switched off.
        let dir = std::env::temp_dir().join(format!("agentbuddy-cfg-old-{}", std::process::id()));
        let store = ConfigStore::new(dir.clone());
        fs::create_dir_all(&dir).unwrap();
        fs::write(store.path(), r#"{"server_url":"https://hub.example.com","background":false}"#).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.server_url, "https://hub.example.com");
        assert!(!loaded.background);
        assert!(!loaded.executor_enabled);
        assert_eq!(loaded.executor_max_concurrency, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stored_language_is_matched_like_the_workbench_does() {
        let regional = AppConfig { lang: "zh-Hant-HK".into(), ..Default::default() };
        assert_eq!(regional.lang(), "zh-TW");
        let plain = AppConfig { lang: "fr".into(), ..Default::default() };
        assert_eq!(plain.lang(), "fr");
    }

    #[test]
    fn an_unknown_stored_language_falls_back_to_english() {
        let config = AppConfig { lang: "nl-NL".into(), ..Default::default() };
        assert_eq!(config.lang(), "en");
    }

    #[test]
    fn an_empty_language_defers_to_the_system_locale() {
        // Whatever the host asks for, the answer must be one we ship.
        let config = AppConfig::default();
        assert!(i18n::is_valid_lang(config.lang()));
    }

    #[test]
    fn url_errors_name_their_reason() {
        assert_eq!(UrlError::Empty.to_string(), "empty");
        assert_eq!(UrlError::Invalid.to_string(), "invalid");
    }

    #[test]
    fn a_session_belongs_to_the_server_that_issued_it() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-session-{}", std::process::id()));
        let store = ConfigStore::new(dir.clone());

        store.save_session("https://a.example.com", "sid=1").unwrap();
        assert_eq!(store.load_session_cookie("https://a.example.com").as_deref(), Some("sid=1"));
        // Replaying one server's session against another would be a leak.
        assert_eq!(store.load_session_cookie("https://b.example.com"), None);

        // A later login replaces the cookie rather than appending to it.
        store.save_session("https://a.example.com", "sid=2").unwrap();
        assert_eq!(store.load_session_cookie("https://a.example.com").as_deref(), Some("sid=2"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clearing_the_session_removes_the_file_and_is_safe_to_repeat() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-session-clear-{}", std::process::id()));
        let store = ConfigStore::new(dir.clone());

        store.save_session("https://a.example.com", "sid=1").unwrap();
        assert!(store.session_path().exists());

        store.save_session("https://a.example.com", "").unwrap();
        assert!(!store.session_path().exists(), "logout must not leave the token on disk");
        assert_eq!(store.load_session_cookie("https://a.example.com"), None);
        // Clearing twice is not an error: logout can race a token expiry.
        store.save_session("https://a.example.com", "").unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_session_file_reads_as_no_session() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-session-broken-{}", std::process::id()));
        let store = ConfigStore::new(dir.clone());
        fs::create_dir_all(&dir).unwrap();
        fs::write(store.session_path(), "{ not json").unwrap();

        assert_eq!(store.load_session_cookie("https://a.example.com"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_or_broken_file_is_treated_as_a_first_run() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-cfg-missing-{}", std::process::id()));
        let store = ConfigStore::new(dir.clone());
        assert_eq!(store.load(), AppConfig::default());
        let _ = fs::create_dir_all(&dir);
        fs::write(store.path(), "{ not json").unwrap();
        assert_eq!(store.load(), AppConfig::default());
        let _ = fs::remove_dir_all(&dir);
    }
}
