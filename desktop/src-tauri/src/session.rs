//! Where the agenthub session cookie is kept between launches.
//!
//! Why this is not just a file: the saved cookie is a bearer-equivalent token
//! for the configured agenthub — whoever reads it is signed in as the user. A
//! `0600` file next to the config is the best a file can do, and on a shared or
//! roaming profile that is not enough, so the default is the operating system's
//! credential store:
//!
//! * Windows — Credential Manager (DPAPI-protected per user),
//! * macOS — Keychain,
//! * Linux — Secret Service (GNOME Keyring / KWallet over D-Bus).
//!
//! When there is no usable store (a bare container, a headless Linux box with no
//! session bus, a locked keychain) the shell falls back to the owner-only file
//! and says so in the log. Falling back is deliberate: losing the session on
//! every launch would be a worse outcome than a narrow-permission file, and the
//! warning is what makes the weaker path visible instead of silent.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// The service name the credential store shows the user.
pub const SERVICE: &str = "agenthub";

/// How the session cookie — and, where the backend allows it, the execution
/// node's API key — is stored. Implementations are cheap and only ever touched
/// on login, logout, save and launch.
pub trait SessionBackend: Send + Sync {
    /// The saved cookie for `server`, or `None` when there is none.
    fn load(&self, server: &str) -> Option<String>;
    /// Saves the cookie for `server`; an empty cookie clears it.
    fn save(&self, server: &str, cookie: &str) -> Result<(), String>;
    /// A stable name for logs and for `/__shell/config` ("keyring", "file",
    /// "memory").
    fn kind(&self) -> &'static str;

    /// Whether arbitrary named secrets can live here. The session file cannot:
    /// it has exactly one slot, and writing a second copy of a credential into
    /// it would not be an improvement over `config.json`.
    fn stores_secrets(&self) -> bool {
        false
    }

    /// A named secret, or `None` when there is none (or the backend cannot
    /// keep one). Never an error: a missing secret is the normal first-run
    /// state.
    fn load_secret(&self, _name: &str) -> Option<String> {
        None
    }

    /// Saves a named secret; an empty value deletes it.
    fn save_secret(&self, name: &str, _value: &str) -> Result<(), String> {
        Err(format!("the {} backend cannot store the secret `{name}`", self.kind()))
    }
}

/// The credential-store backend.
pub struct Keyring {
    service: String,
}

impl Keyring {
    /// Returns the backend when the OS store actually answers.
    ///
    /// A store that reports "no such entry" is working — that is the expected
    /// state before the first login. Only a transport-level error (no D-Bus
    /// session, locked keychain, unsupported platform) means "unavailable".
    pub fn probe(service: &str) -> Option<Self> {
        let entry = keyring::Entry::new(service, &account("probe")).ok()?;
        match entry.get_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Some(Keyring { service: service.to_string() }),
            Err(_) => None,
        }
    }

    fn entry(&self, server: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, &account(server)).map_err(|err| err.to_string())
    }

    fn secret_entry(&self, name: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, &secret_account(name)).map_err(|err| err.to_string())
    }
}

/// One account per server, so a session can never be replayed against a
/// different agenthub after the user re-points the shell.
fn account(server: &str) -> String {
    format!("session:{server}")
}

/// Named secrets are a distinct account namespace from sessions, so an account
/// name can never be mistaken for a cookie (or the other way round).
fn secret_account(name: &str) -> String {
    format!("secret:{name}")
}

impl SessionBackend for Keyring {
    fn load(&self, server: &str) -> Option<String> {
        let entry = self.entry(server).ok()?;
        entry.get_password().ok().filter(|cookie| !cookie.is_empty())
    }

    fn save(&self, server: &str, cookie: &str) -> Result<(), String> {
        if cookie.is_empty() {
            return match self.entry(server)?.delete_credential() {
                Ok(()) => Ok(()),
                // Already gone is the state we wanted.
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(err) => Err(err.to_string()),
            };
        }
        self.entry(server)?.set_password(cookie).map_err(|err| err.to_string())
    }

    fn kind(&self) -> &'static str {
        "keyring"
    }

    fn stores_secrets(&self) -> bool {
        true
    }

    fn load_secret(&self, name: &str) -> Option<String> {
        let entry = self.secret_entry(name).ok()?;
        entry.get_password().ok().filter(|value| !value.is_empty())
    }

    fn save_secret(&self, name: &str, value: &str) -> Result<(), String> {
        if value.is_empty() {
            return match self.secret_entry(name)?.delete_credential() {
                Ok(()) => Ok(()),
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(err) => Err(err.to_string()),
            };
        }
        self.secret_entry(name)?.set_password(value).map_err(|err| err.to_string())
    }
}

/// The persisted shape of `session.json`, from before the credential store.
/// Kept so an existing install is migrated instead of being signed out.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionFile {
    server: String,
    cookie: String,
}

/// The fallback backend: `session.json` next to `config.json`, owner-only.
pub struct File {
    path: PathBuf,
}

impl File {
    pub fn new(path: PathBuf) -> Self {
        File { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl SessionBackend for File {
    fn load(&self, server: &str) -> Option<String> {
        read_session_file(&self.path, server)
    }

    fn save(&self, server: &str, cookie: &str) -> Result<(), String> {
        write_session_file(&self.path, server, cookie).map_err(|err| err.to_string())
    }

    fn kind(&self) -> &'static str {
        "file"
    }

    // `stores_secrets` stays false: a file that can only hold one session must
    // not pretend to be a credential store. The key then stays in `config.json`,
    // which is owner-only, and the caller reports that plainly.
}

/// An in-process backend. The tests use it so a unit test never touches the
/// developer's real keychain.
#[derive(Default)]
pub struct Memory {
    entries: Mutex<HashMap<String, String>>,
}

impl Memory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn entries(&self) -> HashMap<String, String> {
        self.entries.lock().map(|map| map.clone()).unwrap_or_default()
    }
}

impl SessionBackend for Memory {
    fn load(&self, server: &str) -> Option<String> {
        self.entries.lock().ok()?.get(server).cloned()
    }

    fn save(&self, server: &str, cookie: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_| "the session map is poisoned")?;
        if cookie.is_empty() {
            entries.remove(server);
        } else {
            entries.insert(server.to_string(), cookie.to_string());
        }
        Ok(())
    }

    fn kind(&self) -> &'static str {
        "memory"
    }

    fn stores_secrets(&self) -> bool {
        true
    }

    fn load_secret(&self, name: &str) -> Option<String> {
        self.entries.lock().ok()?.get(&secret_account(name)).cloned()
    }

    fn save_secret(&self, name: &str, value: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_| "the session map is poisoned")?;
        let key = secret_account(name);
        if value.is_empty() {
            entries.remove(&key);
        } else {
            entries.insert(key, value.to_string());
        }
        Ok(())
    }
}

/// Reads a session from the legacy plaintext file. Also used by the migration
/// path, which is why it is public to the crate.
pub fn read_session_file(path: &Path, server: &str) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let file: SessionFile = serde_json::from_str(&text).ok()?;
    if file.server == server && !file.cookie.is_empty() {
        Some(file.cookie)
    } else {
        None
    }
}

/// Writes (or, for an empty cookie, removes) the plaintext session file.
pub fn write_session_file(path: &Path, server: &str, cookie: &str) -> std::io::Result<()> {
    if cookie.is_empty() {
        if path.exists() {
            fs::remove_file(path)?;
        }
        return Ok(());
    }
    let text = serde_json::to_string(&SessionFile {
        server: server.to_string(),
        cookie: cookie.to_string(),
    })
    .map_err(std::io::Error::other)?;
    write_private_file(path, &text)?;
    Ok(())
}

/// Writes `text` to `path`, creating the file with owner-only permissions
/// *before* any byte is written.
///
/// `fs::write` followed by a `chmod` leaves a window in which the token (or the
/// config, which can hold a URL with credentials) is readable by whoever the
/// umask or the inherited ACL allows. Opening with `mode(0o600)` closes that
/// window: the file never exists with wider permissions.
pub fn write_private_file(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = open_private(path)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    drop(file);
    // An existing file keeps the mode it was created with, so a file left at
    // 0644 by an older build is still tightened here.
    restrict_to_owner(path);
    Ok(())
}

#[cfg(unix)]
fn open_private(path: &Path) -> std::io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)
}

#[cfg(not(unix))]
fn open_private(path: &Path) -> std::io::Result<fs::File> {
    fs::OpenOptions::new().write(true).create(true).truncate(true).open(path)
}

/// The file holds a token, so keep it to the current user.
///
/// On Unix this is `0600`. On Windows the inherited ACL of `%APPDATA%` is
/// usually narrow enough, but "usually" is not a permission boundary: the
/// directory can be redirected (roaming profiles, a synced folder) and the
/// inherited entries then include other principals. `icacls` is the supported
/// way to drop inheritance and grant only the current account, so the fallback
/// file is as narrow as the credential store it stands in for.
#[cfg(unix)]
pub fn restrict_to_owner(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(windows)]
pub fn restrict_to_owner(path: &Path) {
    use std::process::{Command, Stdio};
    let Ok(user) = std::env::var("USERNAME") else {
        return;
    };
    if user.is_empty() {
        return;
    }
    // argv array, not a shell string: a path with spaces or quotes cannot turn
    // into a second argument.
    let mut command = Command::new("icacls");
    // A GUI app owns no console, so `icacls` gets one of its own: a black window
    // flashing over the workbench on every save — and the theme is saved this way
    // too, which is how it became visible. See `console.rs`.
    crate::console::hide(&mut command);
    command
        .arg(path)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{user}:F"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match command.status() {
        Ok(status) if status.success() => {}
        Ok(status) => eprintln!(
            "agentbuddy desktop: cannot restrict {} to the current user (icacls exited with {status})",
            path.display()
        ),
        Err(err) => eprintln!(
            "agentbuddy desktop: cannot restrict {} to the current user ({err})",
            path.display()
        ),
    }
}

#[cfg(not(any(unix, windows)))]
pub fn restrict_to_owner(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_memory_backend_round_trips_one_server_at_a_time() {
        let backend = Memory::new();
        assert_eq!(backend.load("https://a.example.com"), None);
        backend.save("https://a.example.com", "sid=1").unwrap();
        assert_eq!(backend.load("https://a.example.com").as_deref(), Some("sid=1"));
        // A session belongs to the server that issued it.
        assert_eq!(backend.load("https://b.example.com"), None);
        backend.save("https://a.example.com", "").unwrap();
        assert_eq!(backend.load("https://a.example.com"), None);
    }

    #[test]
    fn an_empty_cookie_clears_the_file_and_repeats_harmlessly() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-session-backend-{}", std::process::id()));
        let path = dir.join("session.json");
        let backend = File::new(path.clone());

        write_session_file(&path, "https://a.example.com", "sid=1").unwrap();
        assert_eq!(backend.load("https://a.example.com").as_deref(), Some("sid=1"));

        write_session_file(&path, "https://a.example.com", "").unwrap();
        assert!(!path.exists(), "logout must not leave the token on disk");
        // Clearing twice is not an error: logout can race a token expiry.
        write_session_file(&path, "https://a.example.com", "").unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_file_reads_as_no_session() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-session-broken-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.json");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(File::new(path.clone()).load("https://a.example.com"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_backend_names_itself_for_the_log() {
        assert_eq!(Memory::new().kind(), "memory");
        assert_eq!(File::new(PathBuf::from("x")).kind(), "file");
    }

    #[test]
    fn a_secret_lives_in_its_own_slot_and_clears_when_empty() {
        let backend = Memory::new();
        assert!(backend.stores_secrets());
        assert_eq!(backend.load_secret("executor_api_key"), None);

        backend.save_secret("executor_api_key", "sk-1").unwrap();
        assert_eq!(backend.load_secret("executor_api_key").as_deref(), Some("sk-1"));
        // A secret must never be mistaken for a session for the same name.
        assert_eq!(backend.load("executor_api_key"), None);
        // ... and a session must never be read back as that secret.
        backend.save("https://a.example.com", "sid=1").unwrap();
        assert_eq!(backend.load_secret("https://a.example.com"), None);

        backend.save_secret("executor_api_key", "").unwrap();
        assert_eq!(backend.load_secret("executor_api_key"), None);
        // Deleting twice is not an error: a logout can race a removal.
        backend.save_secret("executor_api_key", "").unwrap();
        assert_eq!(backend.load("https://a.example.com").as_deref(), Some("sid=1"));
    }

    #[test]
    fn the_file_backend_says_it_cannot_keep_secrets() {
        let backend = File::new(PathBuf::from("session.json"));
        assert!(!backend.stores_secrets());
        assert_eq!(backend.load_secret("executor_api_key"), None);
        let err = backend.save_secret("executor_api_key", "sk-1").unwrap_err();
        assert!(err.contains("file"), "the error names the backend: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn the_session_file_is_created_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("agentbuddy-session-mode-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("session.json");

        write_session_file(&path, "https://a.example.com", "sid=1").unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "the token must never be world-readable, not even briefly");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn an_existing_wide_session_file_is_narrowed_when_rewritten() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("agentbuddy-session-narrow-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.json");
        // What an older build (plain `fs::write` under a 022 umask) left behind.
        fs::write(&path, "{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        write_session_file(&path, "https://a.example.com", "sid=1").unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(&dir);
    }
}
