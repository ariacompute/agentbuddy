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
use crate::session::{self, SessionBackend};

/// The credential-store account name the execution node's API key lives under.
const EXECUTOR_SECRET: &str = "executor_api_key";

/// The address the connection page's server field starts with on a first run.
/// It is language-independent on purpose: one constant is injected into the
/// boot object for all 13 languages, so no translation can carry a different
/// default. `server_url` itself still defaults to empty — a fresh install must
/// open the connection page instead of silently talking to a local port.
pub const DEFAULT_SERVER_URL: &str = "http://localhost:3500";

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
    /// The workbench's colour theme: `light` (the default) or `dark`. It is
    /// stored here because the page cannot keep it: the window is served from
    /// `127.0.0.1:<port>`, the OS picks a new port on every start, and
    /// `localStorage` is keyed by origin — so the page's own copy is gone by the
    /// next launch. The proxy seeds it back before the first paint.
    #[serde(default)]
    pub theme: String,
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
    /// Check the upstream releases on startup and once a day. On by default;
    /// manual checks still work when this is off.
    #[serde(default = "default_true")]
    pub upgrade_auto_check: bool,
    /// A release the user chose not to be reminded about again. Empty means
    /// nothing is skipped.
    #[serde(default)]
    pub upgrade_skipped_version: String,
    /// Unix seconds of the last completed check. 0 means "never". Persisted so
    /// a manual check can keep the daily timer from asking again immediately.
    #[serde(default)]
    pub upgrade_last_checked: i64,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            server_url: String::new(),
            accept_invalid_certs: false,
            lang: String::new(),
            theme: String::new(),
            background: true,
            notify_enabled: true,
            notify_quiet_minutes: 0,
            executor_enabled: false,
            executor_root: String::new(),
            executor_allowlist: Vec::new(),
            executor_max_concurrency: default_concurrency(),
            executor_node_id: String::new(),
            executor_api_key: String::new(),
            upgrade_auto_check: true,
            upgrade_skipped_version: String::new(),
            upgrade_last_checked: 0,
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

    /// The theme to render the workbench in: the chosen one, else light.
    pub fn theme(&self) -> &'static str {
        normalize_theme(&self.theme)
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

/// The two themes the workbench knows. Anything else means light: a hand-edited
/// `config.json` must never leave the page without a set of tokens applied, and
/// the value is injected into the page as a string literal.
pub fn normalize_theme(raw: &str) -> &'static str {
    if raw.trim().eq_ignore_ascii_case("dark") {
        "dark"
    } else {
        "light"
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
    /// The session could not be written to, or read from, its backend.
    Session(String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Io(err) => write!(f, "cannot read or write the config file: {err}"),
            ConfigError::Json(err) => write!(f, "the config file is not valid JSON: {err}"),
            ConfigError::Session(err) => write!(f, "cannot store the session: {err}"),
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

/// Reads and writes `config.json` in one directory. The session cookie is not
/// part of it: it goes to a `session::SessionBackend`, which is the operating
/// system's credential store unless there is none.
#[derive(Clone)]
pub struct ConfigStore {
    path: PathBuf,
    session: Arc<dyn SessionBackend>,
}

impl ConfigStore {
    /// Config plus the owner-only session file. The tests use this shape, and
    /// so does the fallback path when no credential store answers.
    pub fn new(dir: PathBuf) -> Self {
        let session = session::File::new(session_path_for(&dir));
        Self::with_session(dir, Arc::new(session))
    }

    /// The production constructor: the session goes to the OS credential store
    /// when one answers, and to the owner-only file with a warning when none
    /// does.
    pub fn keyring_or_file(dir: PathBuf) -> Self {
        let backend: Arc<dyn SessionBackend> = match session::Keyring::probe(session::SERVICE) {
            Some(keyring) => Arc::new(keyring),
            None => {
                eprintln!(
                    "agentbuddy desktop: no OS credential store is reachable; the agenthub session is kept in an owner-only file instead"
                );
                Arc::new(session::File::new(session_path_for(&dir)))
            }
        };
        Self::with_session(dir, backend)
    }

    /// Explicit backend, for the tests and for the migration path.
    pub fn with_session(dir: PathBuf, session: Arc<dyn SessionBackend>) -> Self {
        ConfigStore { path: dir.join("config.json"), session }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// "keyring", "file" or "memory" — surfaced by `/__shell/config` so the
    /// settings screen can say where the session lives.
    pub fn session_backend(&self) -> &'static str {
        self.session.kind()
    }

    /// The legacy plaintext location. Still used by the file backend, and read
    /// once when moving an existing install into the credential store.
    fn session_path(&self) -> PathBuf {
        let mut path = self.path.clone();
        path.set_file_name("session.json");
        path
    }

    /// Saves (or, when `cookie` is empty, clears) the session tied to `server`.
    ///
    /// The session is a bearer-equivalent token for the configured agenthub, so
    /// it is handed to the OS credential store whenever there is one.
    pub fn save_session(&self, server: &str, cookie: &str) -> Result<(), ConfigError> {
        self.session.save(server, cookie).map_err(ConfigError::Session)?;
        // A session that now lives in the credential store must not be left in
        // plaintext by an earlier build.
        if self.session.kind() != "file" {
            let path = self.session_path();
            if path.exists() {
                let _ = fs::remove_file(path);
            }
        }
        Ok(())
    }

    /// Returns the saved session cookie for `server`, or `None` when there is
    /// none or it was saved for a different server.
    pub fn load_session_cookie(&self, server: &str) -> Option<String> {
        if let Some(cookie) = self.session.load(server) {
            return Some(cookie);
        }
        // Nothing in the current backend: an older build may still have left the
        // session in plaintext next to the config. Move it, then delete it, so
        // upgrading does not sign the user out.
        let cookie = session::read_session_file(&self.session_path(), server)?;
        if self.session.kind() != "file" {
            match self.session.save(server, &cookie) {
                Ok(()) => {
                    let _ = fs::remove_file(self.session_path());
                }
                Err(err) => eprintln!(
                    "agentbuddy desktop: cannot move the saved session into the credential store ({err})"
                ),
            }
        }
        Some(cookie)
    }

    /// Missing or unreadable config is not an error: it means "first run".
    pub fn load(&self) -> AppConfig {
        let mut config = match fs::read_to_string(&self.path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        };
        self.fill_api_key(&mut config);
        config
    }

    /// The execution node's API key is a bearer credential, so it belongs in the
    /// credential store and not in a JSON file. The running process keeps the
    /// key in memory either way — only the copy on disk is blanked.
    pub fn save(&self, config: &AppConfig) -> Result<(), ConfigError> {
        let mut persisted = config.clone();
        self.keep_api_key_out_of_the_file(&mut persisted);
        let text = serde_json::to_string_pretty(&persisted)?;
        // The config can hold a URL with credentials, so keep it to the current
        // user as well — created at `0600`, never written and then narrowed.
        session::write_private_file(&self.path, &text)?;
        Ok(())
    }

    /// Moves a non-empty key into the credential store and clears the copy that
    /// goes to disk. A backend that cannot keep secrets (`File`) leaves the key
    /// where it was: owner-only `config.json` is the honest fallback, and the
    /// alternative — dropping the key — would silently stop the node.
    fn keep_api_key_out_of_the_file(&self, persisted: &mut AppConfig) {
        if !self.session.stores_secrets() {
            return;
        }
        let key = persisted.executor_api_key.trim().to_string();
        if key.is_empty() {
            if self.session.load_secret(EXECUTOR_SECRET).is_some() {
                let _ = self.session.save_secret(EXECUTOR_SECRET, "");
                eprintln!("agentbuddy desktop: the executor API key was removed from the credential store");
            }
            return;
        }
        // Already stored: avoid rewriting the credential on every settings save.
        if self.session.load_secret(EXECUTOR_SECRET).as_deref() == Some(key.as_str()) {
            persisted.executor_api_key.clear();
            return;
        }
        match self.session.save_secret(EXECUTOR_SECRET, &key) {
            Ok(()) => {
                persisted.executor_api_key.clear();
                eprintln!("agentbuddy desktop: the executor API key moved into the credential store");
            }
            Err(err) => eprintln!(
                "agentbuddy desktop: cannot move the executor API key into the credential store ({err}); it stays in config.json, which is owner-only"
            ),
        }
    }

    /// A key written by an older build lives in `config.json`; it is read from
    /// there first and migrated into the store on the next save.
    fn fill_api_key(&self, config: &mut AppConfig) {
        if !config.executor_api_key.trim().is_empty() || !self.session.stores_secrets() {
            return;
        }
        if let Some(secret) = self.session.load_secret(EXECUTOR_SECRET) {
            config.executor_api_key = secret;
        }
    }
}

fn session_path_for(dir: &Path) -> PathBuf {
    dir.join("session.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_connection_page_starts_at_the_local_server() {
        assert_eq!(DEFAULT_SERVER_URL, "http://localhost:3500");
        assert_eq!(
            normalize_server_url(DEFAULT_SERVER_URL).unwrap(),
            DEFAULT_SERVER_URL,
            "the default must be usable by the connection probe as-is"
        );
        // Pre-filling the field is not the same as configuring the shell: a
        // first run still shows the connection page.
        assert!(!AppConfig::default().is_configured());
        assert!(AppConfig::default().server_url.is_empty());
    }

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
            theme: "dark".into(),
            background: true,
            notify_enabled: true,
            notify_quiet_minutes: 15,
            executor_enabled: true,
            executor_root: "/home/me/work".into(),
            executor_allowlist: vec!["git".into(), "npm".into()],
            executor_max_concurrency: 2,
            executor_node_id: "node-abc".into(),
            executor_api_key: "key".into(),
            upgrade_auto_check: false,
            upgrade_skipped_version: "0.9.0".into(),
            upgrade_last_checked: 1_700_000_000,
        };
        store.save(&config).unwrap();
        assert_eq!(store.load(), config);
        assert_eq!(store.load().lang(), "zh-TW");
        assert_eq!(store.load().theme(), "dark");
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

    /// The theme has to be one of two constants, because it is written into the
    /// page as a string literal on every start.
    #[test]
    fn the_theme_is_light_unless_dark_was_chosen() {
        assert_eq!(AppConfig::default().theme(), "light");
        let dark = AppConfig { theme: "dark".into(), ..Default::default() };
        assert_eq!(dark.theme(), "dark");
        assert_eq!(normalize_theme("DARK"), "dark");
        assert_eq!(normalize_theme("  dark "), "dark");
        assert_eq!(normalize_theme("purple"), "light");
        assert_eq!(normalize_theme(""), "light");
    }

    /// A config written by a build that had no theme field must still load: the
    /// preference is new, the file is not.
    #[test]
    fn an_old_config_file_without_a_theme_still_loads_and_is_light() {
        let dir =
            std::env::temp_dir().join(format!("agentbuddy-cfg-notheme-{}", std::process::id()));
        let store = ConfigStore::new(dir.clone());
        fs::create_dir_all(&dir).unwrap();
        fs::write(store.path(), r#"{"server_url":"https://hub.example.com","lang":"fr"}"#).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.theme(), "light");
        assert_eq!(loaded.lang(), "fr");
        let _ = fs::remove_dir_all(&dir);
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

    /// Upgrading must not sign the user out: the session an older build wrote in
    /// plaintext is moved into the credential store and the plaintext copy is
    /// deleted, once.
    #[test]
    fn a_plaintext_session_is_migrated_into_the_backend() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-migrate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        crate::session::write_session_file(
            &dir.join("session.json"),
            "https://a.example.com",
            "sid=9",
        )
        .unwrap();

        let backend = Arc::new(crate::session::Memory::new());
        let store = ConfigStore::with_session(dir.clone(), backend.clone());
        assert_eq!(store.load_session_cookie("https://a.example.com").as_deref(), Some("sid=9"));
        assert_eq!(backend.load("https://a.example.com").as_deref(), Some("sid=9"));
        assert!(
            !dir.join("session.json").exists(),
            "the plaintext copy must not outlive the migration"
        );

        // Later reads come from the backend; another server still has nothing.
        assert_eq!(store.load_session_cookie("https://a.example.com").as_deref(), Some("sid=9"));
        assert_eq!(store.load_session_cookie("https://b.example.com"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Logging in through a store-backed config must not leave the older
    /// plaintext file behind either.
    #[test]
    fn saving_into_a_store_removes_the_plaintext_file() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-migrate-save-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let stale = dir.join("session.json");
        fs::write(&stale, "{}").unwrap();

        let store = ConfigStore::with_session(dir.clone(), Arc::new(crate::session::Memory::new()));
        store.save_session("https://a.example.com", "sid=1").unwrap();
        assert!(!stale.exists());
        assert_eq!(store.session_backend(), "memory");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The execution node's key is a bearer credential: the file must not carry
    /// it when the machine has a credential store, and the running node must
    /// still see it after a restart-simulating `load`.
    #[test]
    fn the_executor_api_key_never_reaches_the_config_file() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-key-store-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let backend = Arc::new(crate::session::Memory::new());
        let store = ConfigStore::with_session(dir.clone(), backend.clone());
        let config = AppConfig {
            server_url: "https://hub.example.com".into(),
            executor_enabled: true,
            executor_api_key: "sk-live-1".into(),
            ..Default::default()
        };

        store.save(&config).unwrap();

        let on_disk = fs::read_to_string(store.path()).unwrap();
        assert!(!on_disk.contains("sk-live-1"), "the key must not be written to disk");
        assert_eq!(backend.load_secret("executor_api_key").as_deref(), Some("sk-live-1"));
        // Reading it back refills the in-memory field, so the node keeps working.
        assert_eq!(store.load(), config);

        // Saving again must not rewrite the credential, and clearing the key
        // must clear it from the store too.
        store.save(&config).unwrap();
        let cleared = AppConfig { executor_api_key: String::new(), ..config.clone() };
        store.save(&cleared).unwrap();
        assert_eq!(backend.load_secret("executor_api_key"), None);
        assert_eq!(store.load().executor_api_key, "");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Without a credential store the key stays where it always was; dropping it
    /// would silently stop the node.
    #[test]
    fn a_file_only_install_keeps_the_key_in_the_owner_only_config() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-key-file-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let store = ConfigStore::new(dir.clone());
        assert!(!store.session.stores_secrets(), "the session file is not a credential store");

        let config = AppConfig { executor_api_key: "sk-live-2".into(), ..Default::default() };
        store.save(&config).unwrap();
        assert_eq!(store.load().executor_api_key, "sk-live-2");
        let _ = fs::remove_dir_all(&dir);
    }

    /// An older build wrote the key in plaintext next to everything else; the
    /// next save moves it into the store and narrows the file copy.
    #[test]
    fn an_api_key_written_by_an_older_build_is_migrated_on_the_next_save() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-key-migrate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let backend = Arc::new(crate::session::Memory::new());
        let store = ConfigStore::with_session(dir.clone(), backend.clone());
        fs::write(
            store.path(),
            r#"{"server_url":"https://hub.example.com","executor_api_key":"sk-old-3"}"#,
        )
        .unwrap();

        let loaded = store.load();
        assert_eq!(loaded.executor_api_key, "sk-old-3");
        store.save(&loaded).unwrap();

        assert!(!fs::read_to_string(store.path()).unwrap().contains("sk-old-3"));
        assert_eq!(backend.load_secret("executor_api_key").as_deref(), Some("sk-old-3"));
        assert_eq!(store.load().executor_api_key, "sk-old-3");
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
