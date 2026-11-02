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
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// The service name the credential store shows the user.
pub const SERVICE: &str = "agenthub";

/// How the session cookie is stored. Implementations are cheap and only ever
/// touched on login, logout and launch.
pub trait SessionBackend: Send + Sync {
    /// The saved cookie for `server`, or `None` when there is none.
    fn load(&self, server: &str) -> Option<String>;
    /// Saves the cookie for `server`; an empty cookie clears it.
    fn save(&self, server: &str, cookie: &str) -> Result<(), String>;
    /// A stable name for logs and for `/__shell/config` ("keyring", "file",
    /// "memory").
    fn kind(&self) -> &'static str;
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
}

/// One account per server, so a session can never be replayed against a
/// different agenthub after the user re-points the shell.
fn account(server: &str) -> String {
    format!("session:{server}")
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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string(&SessionFile {
        server: server.to_string(),
        cookie: cookie.to_string(),
    })
    .map_err(std::io::Error::other)?;
    fs::write(path, text)?;
    restrict_to_owner(path);
    Ok(())
}

/// The file holds a token, so keep it to the current user.
///
/// On Windows the file lives under the user's own `%APPDATA%`, whose inherited
/// ACL already denies other users; the credential store is the real answer
/// there, and this is only the path taken when it is unavailable.
#[cfg(unix)]
pub fn restrict_to_owner(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
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
}
