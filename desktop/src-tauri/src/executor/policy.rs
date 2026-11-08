//! Local policy for the execution node.
//!
//! Everything in this module is a refusal, not a convenience. A node runs
//! commands on somebody's own machine, so the questions it must answer are
//! "which command", "where", "with which environment" and "for how long" — and
//! the safe answer to each is the narrow one:
//!
//! * a command must be an exact entry of the whitelist, given as a bare name, so
//!   the OS resolves it through `PATH` and never through a relative path;
//! * a shell is never allowed, even if somebody lists it, because a shell turns
//!   one allowed command into an unbounded one;
//! * a directory must resolve inside the configured root, after symlinks;
//! * the environment starts empty and only allow-listed names may be added.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// How much of each stream is returned. The server truncates as well; doing it
/// here first keeps the network from carrying a runaway build log.
pub const DEFAULT_MAX_OUTPUT: usize = 64 * 1024;

/// The deadline a job gets when it names none.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// The environment names a job may set. Everything else is stripped, so the
/// node's own secrets (`AGENTHUB_*`, cloud credentials, the API key) never reach
/// a command.
pub const ENV_ALLOW: &[&str] = &["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TERM", "TMPDIR", "TEMP"];

/// Shells are refused even when listed. A whitelist that admits `sh` admits every
/// command the whitelist was meant to exclude.
const SHELLS: &[&str] = &[
    "sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "ash", "busybox", "cmd", "cmd.exe",
    "powershell", "powershell.exe", "pwsh", "pwsh.exe", "wsl", "wsl.exe",
];

/// Why a job was refused before it started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyError {
    /// The configured root is empty, relative, or not a directory.
    RootUnusable,
    /// The command is empty, a path, a shell, or not on the whitelist.
    CommandNotAllowed,
    /// The working directory escapes the root.
    DirOutsideRoot,
    /// A job asked for an environment variable that is not allow-listed.
    EnvNotAllowed,
    /// The process could not be started at all.
    SpawnFailed,
}

impl PolicyError {
    /// The stable reason string the server records; the console localises it.
    pub fn reason(&self) -> &'static str {
        match self {
            PolicyError::RootUnusable => "root_unusable",
            PolicyError::CommandNotAllowed => "command_not_allowed",
            PolicyError::DirOutsideRoot => "dir_outside_root",
            PolicyError::EnvNotAllowed => "env_not_allowed",
            PolicyError::SpawnFailed => "spawn_failed",
        }
    }
}

impl std::fmt::Display for PolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.reason())
    }
}

/// A validated local policy: the root, the whitelist and the environment names.
#[derive(Debug, Clone)]
pub struct Policy {
    root: PathBuf,
    allow: Vec<String>,
    env_allow: Vec<String>,
}

impl Policy {
    /// Validates the operator's settings. An empty whitelist is allowed here —
    /// it simply permits nothing — but an unusable root is an error, because a
    /// node without a boundary is not a node.
    pub fn new(root: &str, allow: &[String]) -> Result<Self, PolicyError> {
        let root = root.trim();
        if root.is_empty() {
            return Err(PolicyError::RootUnusable);
        }
        let path = Path::new(root);
        if !path.is_absolute() {
            return Err(PolicyError::RootUnusable);
        }
        let root = path.canonicalize().map_err(|_| PolicyError::RootUnusable)?;
        if !root.is_dir() {
            return Err(PolicyError::RootUnusable);
        }
        let mut allow_clean = Vec::new();
        for raw in allow {
            let name = raw.trim();
            if name.is_empty() || is_path(name) || is_shell(name) || name.chars().any(char::is_whitespace) {
                // A path, a shell or a name with spaces in it is a configuration
                // mistake worth surfacing rather than silently dropping.
                return Err(PolicyError::CommandNotAllowed);
            }
            if !allow_clean.iter().any(|existing| existing == name) {
                allow_clean.push(name.to_string());
            }
        }
        let env_allow = ENV_ALLOW.iter().map(|name| name.to_string()).collect();
        Ok(Policy { root, allow: allow_clean, env_allow })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn allowlist(&self) -> &[String] {
        &self.allow
    }

    /// Checks a command name against the whitelist. The check runs on every job,
    /// not once per session: an operator may narrow the whitelist while a node is
    /// running, and a job in flight must not keep an old permission.
    pub fn authorize(&self, command: &str) -> Result<(), PolicyError> {
        let command = command.trim();
        if command.is_empty() || is_path(command) || is_shell(command) {
            return Err(PolicyError::CommandNotAllowed);
        }
        if !self.allow.iter().any(|allowed| allowed == command) {
            return Err(PolicyError::CommandNotAllowed);
        }
        Ok(())
    }

    /// Resolves the working directory: the root itself, or a path inside it. The
    /// result is canonicalised first, so `..` and a symlink out of the tree are
    /// both refused rather than followed.
    pub fn resolve_dir(&self, requested: Option<&str>) -> Result<PathBuf, PolicyError> {
        let Some(raw) = requested.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(self.root.clone());
        };
        let candidate = Path::new(raw);
        let joined = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            self.root.join(candidate)
        };
        let resolved = joined.canonicalize().map_err(|_| PolicyError::DirOutsideRoot)?;
        if resolved == self.root || resolved.starts_with(&self.root) {
            return Ok(resolved);
        }
        Err(PolicyError::DirOutsideRoot)
    }

    /// Builds the environment for one job: the allow-listed names inherited from
    /// this process, plus whatever the job set for names it is allowed to set.
    pub fn environment(
        &self,
        requested: &BTreeMap<String, String>,
    ) -> Result<Vec<(String, String)>, PolicyError> {
        let mut out = Vec::new();
        for name in &self.env_allow {
            if let Ok(value) = std::env::var(name) {
                out.push((name.clone(), value));
            }
        }
        for (name, value) in requested {
            if !self.env_allow.iter().any(|allowed| allowed == name) {
                return Err(PolicyError::EnvNotAllowed);
            }
            out.push((name.clone(), value.clone()));
        }
        Ok(out)
    }

    /// The deadline for one job, capped at [`DEFAULT_TIMEOUT`]. A job may ask for
    /// less, never for more: an unbounded command would hold a slot forever.
    pub fn timeout(requested_ms: i64) -> Duration {
        if requested_ms <= 0 {
            return DEFAULT_TIMEOUT;
        }
        let asked = Duration::from_millis(requested_ms as u64);
        asked.min(DEFAULT_TIMEOUT)
    }

    /// The output cap for one job, capped at [`DEFAULT_MAX_OUTPUT`].
    pub fn output_cap(requested: i64) -> usize {
        if requested <= 0 {
            return DEFAULT_MAX_OUTPUT;
        }
        (requested as usize).min(DEFAULT_MAX_OUTPUT)
    }
}

fn is_path(command: &str) -> bool {
    command.contains('/') || command.contains('\\')
}

fn is_shell(command: &str) -> bool {
    let lowered = command.to_ascii_lowercase();
    SHELLS.contains(&lowered.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One root per call: the tests run in parallel and remove their directory
    /// afterwards, so sharing a per-process path made them fail each other.
    fn root() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "agentbuddy-policy-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn policy(root: &Path, allow: &[&str]) -> Policy {
        let allow: Vec<String> = allow.iter().map(|value| value.to_string()).collect();
        Policy::new(root.to_str().unwrap(), &allow).expect("the policy must build")
    }

    #[test]
    fn a_root_must_be_configured_and_absolute() {
        assert_eq!(Policy::new("", &[]).unwrap_err(), PolicyError::RootUnusable);
        assert_eq!(Policy::new("   ", &[]).unwrap_err(), PolicyError::RootUnusable);
        assert_eq!(Policy::new("relative/path", &[]).unwrap_err(), PolicyError::RootUnusable);
        assert_eq!(
            Policy::new("/definitely/not/here/agentbuddy", &[]).unwrap_err(),
            PolicyError::RootUnusable
        );
    }

    #[test]
    fn a_whitelist_entry_that_is_a_path_or_a_shell_is_refused() {
        let root = root();
        let path = root.to_str().unwrap();
        for bad in ["/usr/bin/git", "./git", "sh", "bash", "powershell.exe", "my tool"] {
            let allow = vec![bad.to_string()];
            assert_eq!(
                Policy::new(path, &allow).unwrap_err(),
                PolicyError::CommandNotAllowed,
                "{bad} must not become a whitelist entry"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_exact_whitelist_entries_run() {
        let root = root();
        let policy = policy(&root, &["git", "echo"]);
        assert!(policy.authorize("git").is_ok());
        assert!(policy.authorize(" echo ").is_ok());
        assert_eq!(policy.authorize("gitx").unwrap_err(), PolicyError::CommandNotAllowed);
        assert_eq!(policy.authorize("rm").unwrap_err(), PolicyError::CommandNotAllowed);
        assert_eq!(policy.authorize("").unwrap_err(), PolicyError::CommandNotAllowed);
        assert_eq!(policy.authorize("/bin/git").unwrap_err(), PolicyError::CommandNotAllowed);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_shell_is_refused_even_when_it_is_listed() {
        let root = root();
        // `Policy::new` refuses to even store it, which is the stronger answer.
        assert_eq!(
            Policy::new(root.to_str().unwrap(), &["sh".to_string()]).unwrap_err(),
            PolicyError::CommandNotAllowed
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_working_directory_stays_inside_the_root() {
        let root = root();
        std::fs::create_dir_all(root.join("work/sub")).unwrap();
        std::fs::create_dir_all(root.join("other")).unwrap();
        let policy = policy(&root, &["git"]);

        assert_eq!(policy.resolve_dir(None).unwrap(), root.canonicalize().unwrap());
        assert!(policy.resolve_dir(Some("work/sub")).unwrap().ends_with("sub"));
        // `..` that stays inside is fine; one that leaves is not.
        assert!(policy.resolve_dir(Some("work/../other")).unwrap().ends_with("other"));
        assert_eq!(
            policy.resolve_dir(Some("../../")).unwrap_err(),
            PolicyError::DirOutsideRoot
        );
        assert_eq!(policy.resolve_dir(Some("/etc")).unwrap_err(), PolicyError::DirOutsideRoot);
        assert_eq!(policy.resolve_dir(Some("missing")).unwrap_err(), PolicyError::DirOutsideRoot);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_job_cannot_set_an_arbitrary_environment_variable() {
        let root = root();
        let policy = policy(&root, &["git"]);
        let mut ok = BTreeMap::new();
        ok.insert("LANG".to_string(), "C".to_string());
        let env = policy.environment(&ok).unwrap();
        assert!(env.iter().any(|(name, value)| name == "LANG" && value == "C"));

        let mut bad = BTreeMap::new();
        bad.insert("PATH".to_string(), "/tmp".to_string());
        // PATH is allow-listed, so overriding it is allowed; a secret name is not.
        assert!(policy.environment(&bad).is_ok());
        let mut secret = BTreeMap::new();
        secret.insert("AGENTHUB_API_KEY".to_string(), "x".to_string());
        assert_eq!(policy.environment(&secret).unwrap_err(), PolicyError::EnvNotAllowed);

        // The node's own environment is never inherited wholesale.
        std::env::set_var("AGENTBUDDY_POLICY_TEST_SECRET", "leak");
        let empty = policy.environment(&BTreeMap::new()).unwrap();
        assert!(!empty.iter().any(|(name, _)| name == "AGENTBUDDY_POLICY_TEST_SECRET"));
        std::env::remove_var("AGENTBUDDY_POLICY_TEST_SECRET");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn limits_can_be_lowered_but_never_raised() {
        assert_eq!(Policy::timeout(0), DEFAULT_TIMEOUT);
        assert_eq!(Policy::timeout(1000), Duration::from_secs(1));
        assert_eq!(Policy::timeout(600_000), DEFAULT_TIMEOUT);
        assert_eq!(Policy::output_cap(0), DEFAULT_MAX_OUTPUT);
        assert_eq!(Policy::output_cap(1024), 1024);
        assert_eq!(Policy::output_cap(i64::MAX), DEFAULT_MAX_OUTPUT);
    }

    #[test]
    fn an_empty_whitelist_permits_nothing() {
        let root = root();
        let policy = Policy::new(root.to_str().unwrap(), &[]).unwrap();
        assert!(policy.allowlist().is_empty());
        assert_eq!(policy.authorize("git").unwrap_err(), PolicyError::CommandNotAllowed);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn every_refusal_has_a_stable_reason() {
        for (error, reason) in [
            (PolicyError::RootUnusable, "root_unusable"),
            (PolicyError::CommandNotAllowed, "command_not_allowed"),
            (PolicyError::DirOutsideRoot, "dir_outside_root"),
            (PolicyError::EnvNotAllowed, "env_not_allowed"),
            (PolicyError::SpawnFailed, "spawn_failed"),
        ] {
            assert_eq!(error.reason(), reason);
            assert_eq!(error.to_string(), reason);
        }
    }
}
