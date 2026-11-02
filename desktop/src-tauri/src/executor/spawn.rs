//! Running one command, directly.
//!
//! There is no shell anywhere in this file: the command and every argument are
//! handed to the OS as separate argv entries, so a quote or a `;` in an argument
//! is a character rather than syntax. That is what makes the whitelist mean
//! something — with a shell in the middle, allowing `git` would also allow
//! `git --exec-path=/tmp/evil`.
//!
//! The child gets its own process group on unix so a timeout signal cannot be
//! mistaken for the app being interrupted — and so that the same group can be
//! signalled as a whole when the deadline passes, which is what stops a
//! grandchild from outliving the job. `kill_on_drop` guarantees a dropped job
//! does not leave the direct child running.

use std::collections::BTreeMap;
use std::process::Stdio;
use std::time::Instant;
#[cfg(unix)]
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::time::timeout;

use super::policy::{Policy, PolicyError};

/// How long a timed-out job gets between "please stop" and "stop", so a program
/// that handles SIGTERM can flush its work instead of being cut off mid-write.
#[cfg(unix)]
const GROUP_GRACE: Duration = Duration::from_millis(250);

/// One request as it arrives from the server (`ExecRequest` on the Go side).
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExecRequest {
    pub command: String,
    pub args: Vec<String>,
    pub stdin: String,
    pub dir: String,
    pub env: BTreeMap<String, String>,
    pub timeout_ms: i64,
    pub max_output_bytes: i64,
    /// Set by the server for a console probe; it changes nothing locally, it is
    /// carried through so the audit trail keeps saying why the command ran.
    pub dry_run: bool,
}

/// What came back, mapped one-to-one onto the server's `ExecResult`.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutcome {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub duration_ms: i64,
    /// Non-empty when the job failed for a reason that is not the command's own
    /// exit code: a timeout, or a local policy refusal.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

impl ExecOutcome {
    /// A refusal that never reached the spawn.
    pub fn refused(error: &PolicyError) -> Self {
        ExecOutcome { exit_code: -1, error: error.reason().to_string(), ..Default::default() }
    }
}

/// Runs one authorized request. Policy is checked inside, in this order: command,
/// directory, environment. Anything refused returns an outcome with an `error`
/// instead of panicking, because a node's answer to a bad job is a message, not
/// a crash.
pub async fn run(policy: &Policy, request: &ExecRequest) -> ExecOutcome {
    if let Err(error) = policy.authorize(&request.command) {
        return ExecOutcome::refused(&error);
    }
    let dir = match policy.resolve_dir(Some(&request.dir)) {
        Ok(dir) => dir,
        Err(error) => return ExecOutcome::refused(&error),
    };
    let environment = match policy.environment(&request.env) {
        Ok(names) => names,
        Err(error) => return ExecOutcome::refused(&error),
    };

    let mut command = Command::new(request.command.trim());
    command.args(&request.args);
    command.current_dir(&dir);
    command.env_clear();
    for (name, value) in environment {
        command.env(name, value);
    }
    command.stdin(if request.stdin.is_empty() { Stdio::null() } else { Stdio::piped() });
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group: a signal aimed at the app must not reach a job, and
        // the group (the child is its leader) is exactly what a timeout signals.
        command.as_std_mut().process_group(0);
    }

    let started = Instant::now();
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return ExecOutcome::refused(&PolicyError::SpawnFailed),
    };

    if !request.stdin.is_empty() {
        if let Some(mut stdin) = child.stdin.take() {
            let payload = request.stdin.clone().into_bytes();
            // A command that exits without reading is not an error; the write
            // simply fails and the exit code tells the story.
            let _ = tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(&payload).await;
                let _ = stdin.shutdown().await;
            });
        }
    }

    let cap = Policy::output_cap(request.max_output_bytes);
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_task = tokio::spawn(read_capped(stdout_pipe, cap));
    let stderr_task = tokio::spawn(read_capped(stderr_pipe, cap));

    let deadline = Policy::timeout(request.timeout_ms);
    let mut exit_code = -1;
    let timed_out = match timeout(deadline, child.wait()).await {
        Ok(Ok(status)) => {
            exit_code = status.code().unwrap_or(-1);
            false
        }
        // The wait itself failed (the child was reaped elsewhere, or the platform
        // refused): report it as a failed run rather than inventing a code.
        Ok(Err(_)) => false,
        Err(_) => {
            terminate_tree(&mut child).await;
            true
        }
    };
    let (stdout, stdout_cut) = join_output(stdout_task).await;
    let (stderr, stderr_cut) = join_output(stderr_task).await;
    let duration_ms = started.elapsed().as_millis() as i64;

    if timed_out {
        return ExecOutcome {
            exit_code: 124,
            stdout,
            stderr,
            truncated: stdout_cut || stderr_cut,
            duration_ms,
            error: "timeout".to_string(),
        };
    }
    ExecOutcome {
        exit_code,
        stdout,
        stderr,
        truncated: stdout_cut || stderr_cut,
        duration_ms,
        error: String::new(),
    }
}

/// Stops a job whose deadline has passed, then reaps it.
///
/// On unix the child leads its own process group, so the whole tree is addressed:
/// TERM first (a program that handles it can flush its work), a short grace, then
/// KILL for whatever is still there. Killing only the direct child used to leave
/// grandchildren running — and those inherit the stdout pipe, so the node could
/// not even finish reading the output it was about to report.
///
/// Windows has no equivalent here; the fallback is the direct kill, and the
/// platform module answers `false` rather than pretending.
async fn terminate_tree(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    {
        // `process_group(0)` made the child the leader, so its pid is the group id.
        if let Some(pid) = child.id() {
            let pgid = pid as i32;
            if super::procgroup::terminate_group(pgid) {
                tokio::time::sleep(GROUP_GRACE).await;
            }
            // Anything that ignored TERM, or that started during the grace
            // period, goes now. A refused signal means the group is already
            // gone, and the direct kill covers that case.
            if !super::procgroup::kill_group(pgid) {
                let _ = child.start_kill();
            }
        }
        // No pid means it was already reaped: nothing left to signal.
    }
    #[cfg(not(unix))]
    {
        let _ = child.start_kill();
    }
    let _ = child.wait().await;
}

/// Reads a stream up to `cap` bytes and keeps draining afterwards: stopping at
/// the cap would leave the child blocked on a full pipe and turn a truncation
/// into a timeout.
async fn read_capped<R>(pipe: Option<R>, cap: usize) -> (String, bool)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    let Some(mut pipe) = pipe else {
        return (String::new(), false);
    };
    let mut collected: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        match pipe.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let room = cap.saturating_sub(collected.len());
                if room == 0 {
                    truncated = true;
                    continue;
                }
                let take = read.min(room);
                collected.extend_from_slice(&chunk[..take]);
                if take < read {
                    truncated = true;
                }
            }
        }
    }
    (String::from_utf8_lossy(&collected).to_string(), truncated)
}

async fn join_output(
    task: tokio::task::JoinHandle<(String, bool)>,
) -> (String, bool) {
    match task.await {
        Ok(output) => output,
        Err(_) => (String::new(), false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A workspace of its own per call: cargo runs these tests in parallel and each
    /// one removes its directory at the end, so a shared per-process path made them
    /// tear each other's root away (`root_unusable`, missing output).
    fn workspace() -> PathBuf {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "agentbuddy-spawn-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn policy_for(allow: &[&str]) -> (Policy, PathBuf) {
        let dir = workspace();
        let allow: Vec<String> = allow.iter().map(|value| value.to_string()).collect();
        let policy = Policy::new(dir.to_str().unwrap(), &allow).expect("policy");
        (policy, dir)
    }

    #[tokio::test]
    async fn a_refused_command_never_spawns() {
        let (policy, dir) = policy_for(&["echo"]);
        let outcome = run(&policy, &ExecRequest { command: "rm".into(), ..Default::default() }).await;
        assert_eq!(outcome.error, "command_not_allowed");
        assert_eq!(outcome.exit_code, -1);
        assert!(outcome.stdout.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_directory_outside_the_root_is_refused() {
        let (policy, dir) = policy_for(&["echo"]);
        let outcome =
            run(&policy, &ExecRequest { command: "echo".into(), dir: "../../".into(), ..Default::default() })
                .await;
        assert_eq!(outcome.error, "dir_outside_root");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn an_env_request_outside_the_allowlist_is_refused() {
        let (policy, dir) = policy_for(&["echo"]);
        let mut env = BTreeMap::new();
        env.insert("AWS_SECRET_ACCESS_KEY".to_string(), "x".to_string());
        let outcome =
            run(&policy, &ExecRequest { command: "echo".into(), env, ..Default::default() }).await;
        assert_eq!(outcome.error, "env_not_allowed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_real_command_returns_its_exit_code_and_output() {
        let (policy, dir) = policy_for(&["echo"]);
        let outcome = run(
            &policy,
            &ExecRequest { command: "echo".into(), args: vec!["hello".into()], ..Default::default() },
        )
        .await;
        assert_eq!(outcome.exit_code, 0);
        assert_eq!(outcome.stdout.trim(), "hello");
        assert!(outcome.error.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_failing_command_is_a_result_not_an_error() {
        let (policy, dir) = policy_for(&["false"]);
        let outcome = run(&policy, &ExecRequest { command: "false".into(), ..Default::default() }).await;
        assert_eq!(outcome.exit_code, 1);
        // The command failed; the node did not.
        assert!(outcome.error.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn output_beyond_the_cap_is_truncated_and_the_child_still_finishes() {
        let (policy, dir) = policy_for(&["echo"]);
        let outcome = run(
            &policy,
            &ExecRequest {
                command: "echo".into(),
                args: vec!["x".repeat(4096)],
                max_output_bytes: 16,
                ..Default::default()
            },
        )
        .await;
        assert!(outcome.truncated, "the cap must be visible in the result");
        assert!(outcome.stdout.len() <= 16);
        assert!(outcome.error.is_empty(), "truncation must not turn into a timeout");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_slow_command_is_killed_at_the_deadline() {
        // `env` with no arguments exits immediately, so the delay is created by
        // asking the node to wait far longer than the test will.
        let (policy, dir) = policy_for(&["sleep"]);
        let outcome = run(
            &policy,
            &ExecRequest { command: "sleep".into(), args: vec!["5".into()], timeout_ms: 50, ..Default::default() },
        )
        .await;
        assert_eq!(outcome.error, "timeout");
        assert_eq!(outcome.exit_code, 124);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stdin_is_piped_to_the_command() {
        let (policy, dir) = policy_for(&["cat"]);
        let outcome = run(
            &policy,
            &ExecRequest { command: "cat".into(), stdin: "piped".into(), ..Default::default() },
        )
        .await;
        assert_eq!(outcome.stdout, "piped");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
