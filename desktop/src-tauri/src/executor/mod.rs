//! The execution node (BYOM): this desktop runs commands on its own machine on
//! the server's behalf.
//!
//! Why it exists: a sandbox is only as useful as the machine it runs on, and some
//! work — a private repository, a licensed compiler, a GPU — only exists on the
//! user's own computer. The node lets agenthub lease that computer without the
//! server ever holding a shell on it.
//!
//! The shape of the deal, in order of importance:
//!
//! * **off by default**, and switched on only from the settings screen, which
//!   spells out what it means;
//! * a **local** policy decides what may run (exact command names, a root
//!   directory, an environment allowlist, a deadline) — the server asks, the
//!   desktop decides;
//! * **no state**: the node polls, runs, reports and forgets. Killing it loses
//!   nothing, which is why a crash here cannot corrupt a task;
//! * **no webview involvement**: the loop lives in this process, so the workbench
//!   page never gains filesystem or command access.

pub mod jobs;
pub mod policy;
pub mod spawn;

pub use jobs::{Credential, Job, JobError, NodeClient};
pub use policy::{Policy, PolicyError};
pub use spawn::{ExecOutcome, ExecRequest};

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::sync::{watch, Semaphore};

use crate::config::{AppConfig, ConfigStore, SharedConfig};

/// How long one long poll parks before the node asks again. The server caps it
/// with `AGENTHUB_SANDBOX_NODE_POLL_TIMEOUT`; this is the node's own ceiling.
const POLL_WAIT: Duration = Duration::from_secs(20);

/// Backoff after a failure. Short enough that a server restart is picked up
/// quickly, long enough that a downed server is not hammered.
const RETRY_DELAY: Duration = Duration::from_secs(5);

/// The state the settings screen renders. It is a snapshot, not a handle: the
/// loop updates a shared value and the HTTP layer reads it.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub running: bool,
    pub node_id: String,
    pub root: String,
    pub allowlist: Vec<String>,
    pub max_concurrency: u16,
    pub server_url: String,
    /// Unix seconds of the last successful poll or heartbeat; 0 means "never".
    pub last_heartbeat: u64,
    /// The last refusal or transport failure, already a stable reason string.
    pub last_error: String,
    pub jobs_done: u64,
}

/// Owns the node loop for the lifetime of the app.
pub struct Executor {
    store: Arc<ConfigStore>,
    config: SharedConfig,
    status: Arc<Mutex<Status>>,
    run: Mutex<Option<RunHandle>>,
}

struct RunHandle {
    stop: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

impl Executor {
    pub fn new(store: Arc<ConfigStore>, config: SharedConfig) -> Self {
        Executor {
            store,
            config,
            status: Arc::new(Mutex::new(Status::default())),
            run: Mutex::new(None),
        }
    }

    /// A snapshot for `/__shell/executor`.
    pub fn status(&self) -> Status {
        self.status.lock().map(|guard| guard.clone()).unwrap_or_default()
    }

    /// Brings the loop in line with the saved configuration. Safe to call on
    /// every settings save: it stops whatever is running and starts what the new
    /// configuration describes, so the toggle never needs a restart.
    pub async fn apply(self: &Arc<Self>) {
        self.stop().await;
        let config = self.config.read().await.clone();
        self.refresh_status(&config);
        if !config.executor_enabled {
            return;
        }
        let Some(base) = config.server_url() else {
            self.record_error("server_not_configured");
            return;
        };
        let policy = match Policy::new(&config.executor_root, &config.executor_allowlist) {
            Ok(policy) => policy,
            Err(error) => {
                self.record_error(error.reason());
                return;
            }
        };
        let node_id = self.node_id(&config).await;
        let credential = self.credential(&config, &base);
        let client = NodeClient::new(self.http_client(&config), &base, &node_id, credential);
        let name = node_name();

        if let Ok(mut guard) = self.status.lock() {
            guard.running = true;
            guard.node_id = node_id;
            guard.server_url = base;
            guard.last_error.clear();
        }

        let (stop, stop_rx) = watch::channel(false);
        let status = self.status.clone();
        let task = tokio::spawn(run_loop(
            client,
            policy,
            status,
            config.executor_max_concurrency.max(1),
            name,
            stop_rx,
        ));
        if let Ok(mut slot) = self.run.lock() {
            *slot = Some(RunHandle { stop, task });
        }
    }

    /// Stops the loop, waiting for it to unwind so a restart never has two nodes
    /// polling under the same identity.
    pub async fn stop(&self) {
        let handle = self.run.lock().ok().and_then(|mut slot| slot.take());
        if let Some(handle) = handle {
            let _ = handle.stop.send(true);
            let _ = tokio::time::timeout(Duration::from_secs(5), handle.task).await;
        }
        if let Ok(mut guard) = self.status.lock() {
            guard.running = false;
        }
    }

    fn refresh_status(&self, config: &AppConfig) {
        if let Ok(mut guard) = self.status.lock() {
            guard.enabled = config.executor_enabled;
            guard.root = config.executor_root.clone();
            guard.allowlist = config.executor_allowlist.clone();
            guard.max_concurrency = config.executor_max_concurrency.max(1);
            guard.node_id = config.executor_node_id.clone();
            guard.server_url = config.server_url.clone();
            guard.last_error.clear();
        }
    }

    fn record_error(&self, reason: &str) {
        if let Ok(mut guard) = self.status.lock() {
            guard.running = false;
            guard.last_error = reason.to_string();
        }
    }

    /// Returns the stable identity of this machine, generating and persisting one
    /// the first time the node is switched on. Persisting it is what makes a
    /// restart re-enroll the same node instead of adding a second one.
    async fn node_id(&self, config: &AppConfig) -> String {
        if !config.executor_node_id.trim().is_empty() {
            return config.executor_node_id.trim().to_string();
        }
        let generated = generate_node_id();
        let mut guard = self.config.write().await;
        if guard.executor_node_id.trim().is_empty() {
            guard.executor_node_id = generated.clone();
            let snapshot = guard.clone();
            drop(guard);
            if let Err(err) = self.store.save(&snapshot) {
                eprintln!("agentbuddy desktop: cannot save the node id: {err}");
            }
        } else {
            let existing = guard.executor_node_id.trim().to_string();
            drop(guard);
            return existing;
        }
        generated
    }

    /// The session this app is already signed in with, unless an API key was
    /// configured. Reusing the session means the node acts as its own user: no
    /// second credential to manage, and revoking the session revokes the node.
    fn credential(&self, config: &AppConfig, base: &str) -> Credential {
        if !config.executor_api_key.trim().is_empty() {
            return Credential::ApiKey(config.executor_api_key.clone());
        }
        match self.store.load_session_cookie(base) {
            Some(cookie) => Credential::Cookie(cookie),
            None => Credential::None,
        }
    }

    fn http_client(&self, config: &AppConfig) -> reqwest::Client {
        // The node trusts the same roots the shell does, and follows no redirect:
        // a shim that redirects is a misconfiguration, not a hint.
        reqwest::Client::builder()
            .danger_accept_invalid_certs(config.accept_invalid_certs)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(crate::proxy::CONNECT_TIMEOUT)
            .user_agent(format!("agentbuddy-desktop/{}", crate::VERSION))
            .build()
            .unwrap_or_default()
    }
}

/// The polling loop. It enrolls first, then parks on long polls until cancelled;
/// every await is a cancellation point, so the settings toggle takes effect within
/// one poll rather than after the current job.
async fn run_loop(
    client: NodeClient,
    policy: Policy,
    status: Arc<Mutex<Status>>,
    concurrency: u16,
    name: String,
    mut stop: watch::Receiver<bool>,
) {
    let semaphore = Arc::new(Semaphore::new(concurrency as usize));
    let capabilities = vec!["remote".to_string()];

    loop {
        if *stop.borrow() {
            return;
        }
        let enrolled = tokio::select! {
            _ = stop.changed() => return,
            result = client.enroll(&name, &capabilities) => result,
        };
        if let Err(error) = enrolled {
            note(&status, Err(&error));
            if !sleep_or_stop(&mut stop, RETRY_DELAY).await {
                return;
            }
            continue;
        }
        note(&status, Ok(()));

        loop {
            // Claim only with a free slot: holding a job while waiting for a
            // permit would park work the node cannot start.
            let permit = tokio::select! {
                _ = stop.changed() => return,
                permit = semaphore.clone().acquire_owned() => permit,
            };
            let Ok(permit) = permit else { return };

            let claimed = tokio::select! {
                _ = stop.changed() => return,
                result = client.claim(POLL_WAIT) => result,
            };
            let job = match claimed {
                Ok(Some(job)) => job,
                Ok(None) => {
                    drop(permit);
                    note(&status, Ok(()));
                    continue;
                }
                Err(error) => {
                    drop(permit);
                    note(&status, Err(&error));
                    // Re-enroll on the next outer iteration: the credential may
                    // have expired, and enrolling also refreshes liveness.
                    if !sleep_or_stop(&mut stop, RETRY_DELAY).await {
                        return;
                    }
                    break;
                }
            };

            // The job runs in its own task while the permit keeps the slot: that
            // is what makes `max_concurrency` real. A spawned job is bounded by
            // its own deadline, so stopping the node cannot leave one hanging.
            let job_client = client.clone();
            let job_policy = policy.clone();
            let job_status = status.clone();
            tokio::spawn(async move {
                let outcome = execute(&job_policy, &job).await;
                // A report failure is not retried: the server wakes whoever waits
                // on the job, and a second report would only race the lease sweep.
                let reported = job_client.report(&job, &outcome).await;
                match reported {
                    Ok(()) => note(&job_status, Ok(())),
                    Err(error) => note(&job_status, Err(&error)),
                }
                let _ = job_client.heartbeat().await;
                if let Ok(mut guard) = job_status.lock() {
                    guard.jobs_done = guard.jobs_done.saturating_add(1);
                }
                drop(permit);
            });
        }
    }
}

/// Runs one job. Only `exec` reaches the spawn: `create` / `destroy` / `status`
/// are acknowledgements the node has no local work for, because the remote
/// provider's environment *is* this machine.
async fn execute(policy: &Policy, job: &Job) -> ExecOutcome {
    match job.op.as_str() {
        "" | "exec" => spawn::run(policy, &job.request).await,
        "create" | "destroy" | "status" => ExecOutcome { exit_code: 0, ..Default::default() },
        other => ExecOutcome {
            exit_code: -1,
            error: format!("unsupported_op:{other}"),
            ..Default::default()
        },
    }
}

fn note(status: &Arc<Mutex<Status>>, result: Result<(), &JobError>) {
    let Ok(mut guard) = status.lock() else { return };
    match result {
        Ok(()) => {
            guard.last_heartbeat = unix_seconds();
            guard.last_error.clear();
        }
        Err(error) => guard.last_error = error.to_string(),
    }
}

/// Sleeps unless the node is stopped first. Returns false when it was stopped.
async fn sleep_or_stop(stop: &mut watch::Receiver<bool>, delay: Duration) -> bool {
    // A stop that landed before this call would be missed by the clone below: a
    // freshly cloned receiver counts the current value as seen, so `changed()`
    // would only fire on the *next* send and the caller would park for the whole
    // delay. Checking the value first closes that window.
    if *stop.borrow() {
        return false;
    }
    // The clone shares the channel, so waiting on it leaves `stop` readable in the
    // other arm: the alternative is one borrow too many for the compiler.
    let mut change = stop.clone();
    tokio::select! {
        _ = change.changed() => false,
        _ = tokio::time::sleep(delay) => !*stop.borrow(),
    }
}

fn unix_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A machine identity that is stable once saved. It only has to be unique within
/// one agenthub instance, so process id plus the clock is enough — the value is
/// persisted immediately, so it never changes again.
fn generate_node_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("node-{:x}-{:x}", std::process::id(), nanos as u64)
}

/// The display name the console shows: the hostname when the platform exposes
/// one, otherwise a generic label. It is cosmetic; the identity is the node id.
fn node_name() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    host.unwrap_or_else(|| "agentbuddy desktop".to_string())
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
