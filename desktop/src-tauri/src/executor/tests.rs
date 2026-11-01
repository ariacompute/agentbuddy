//! State-machine tests for the execution node.
//!
//! The spawn and policy tests live next to the code they cover; these are about
//! the lifecycle the settings screen drives: off by default, refused loudly when
//! it cannot run, running once it can, and stopped when it is switched off.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use super::*;
use crate::config::AppConfig;

fn scratch() -> std::path::PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "agentbuddy-executor-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Builds an executor over a private config file, so two tests never share one.
async fn executor_with(config: AppConfig) -> Arc<Executor> {
    let store = Arc::new(ConfigStore::new(scratch()));
    store.save(&config).unwrap();
    let shared = Arc::new(tokio::sync::RwLock::new(config));
    Arc::new(Executor::new(store, shared))
}

/// A server that accepts enrollment and answers every poll with "nothing to do".
async fn fake_server() -> String {
    use axum::http::StatusCode;
    use axum::routing::{any, post};

    let app = axum::Router::new()
        .route(
            "/api/sandbox-nodes",
            post(|_body: String| async { axum::Json(serde_json::json!({"id": "node"})) }),
        )
        .route(
            "/api/sandbox-nodes/{id}/jobs",
            any(|_headers: axum::http::HeaderMap| async { StatusCode::NO_CONTENT }),
        )
        .route(
            "/api/sandbox-nodes/{id}/heartbeat",
            post(|| async { axum::Json(serde_json::json!({"ok": true})) }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://127.0.0.1:{port}")
}

#[tokio::test]
async fn the_node_is_off_until_it_is_switched_on() {
    let executor = executor_with(AppConfig::default()).await;
    executor.apply().await;
    let status = executor.status();
    assert!(!status.enabled);
    assert!(!status.running);
    assert!(status.node_id.is_empty(), "a node that never ran has no identity");
    assert!(status.last_error.is_empty());
}

#[tokio::test]
async fn enabling_without_a_server_is_refused_with_a_reason() {
    let executor = executor_with(AppConfig { executor_enabled: true, executor_root: "/tmp".into(), ..Default::default() }).await;
    executor.apply().await;
    let status = executor.status();
    assert!(status.enabled);
    assert!(!status.running, "a node with no server cannot run");
    assert_eq!(status.last_error, "server_not_configured");
}

#[tokio::test]
async fn enabling_with_an_unusable_root_is_refused_with_a_reason() {
    let server = fake_server().await;
    let executor = executor_with(AppConfig {
        server_url: server,
        executor_enabled: true,
        executor_root: "relative/root".into(),
        executor_allowlist: vec!["git".into()],
        ..Default::default()
    })
    .await;
    executor.apply().await;
    let status = executor.status();
    assert!(!status.running);
    assert_eq!(status.last_error, "root_unusable");
}

#[tokio::test]
async fn enabling_with_a_usable_configuration_starts_the_loop_and_keeps_an_identity() {
    let server = fake_server().await;
    let root = scratch();
    let store = Arc::new(ConfigStore::new(root.clone()));
    let config = AppConfig {
        server_url: server,
        executor_enabled: true,
        executor_root: root.join("work").to_string_lossy().to_string(),
        executor_allowlist: vec!["git".into()],
        executor_max_concurrency: 2,
        ..Default::default()
    };
    std::fs::create_dir_all(root.join("work")).unwrap();
    let shared = Arc::new(tokio::sync::RwLock::new(config.clone()));
    let executor = Arc::new(Executor::new(store.clone(), shared));

    executor.apply().await;
    let status = executor.status();
    assert!(status.running, "the loop must start: {}", status.last_error);
    assert!(status.last_error.is_empty());
    assert!(!status.node_id.is_empty(), "an identity is generated on first enable");
    assert_eq!(status.max_concurrency, 2);

    // The identity is persisted, so a restart re-enrolls the same node.
    let saved = store.load();
    assert_eq!(saved.executor_node_id, status.node_id);
    assert!(saved.executor_enabled);

    executor.stop().await;
    assert!(!executor.status().running, "stopping must report offline");
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn switching_it_off_stops_a_running_loop() {
    let server = fake_server().await;
    let root = scratch();
    let config = AppConfig {
        server_url: server,
        executor_enabled: true,
        executor_root: root.to_string_lossy().to_string(),
        executor_allowlist: vec!["git".into()],
        ..Default::default()
    };
    let store = Arc::new(ConfigStore::new(root.clone()));
    let shared = Arc::new(tokio::sync::RwLock::new(config));
    let executor = Arc::new(Executor::new(store, shared.clone()));

    executor.apply().await;
    assert!(executor.status().running);

    {
        let mut guard = shared.write().await;
        guard.executor_enabled = false;
    }
    executor.apply().await;
    let status = executor.status();
    assert!(!status.running);
    assert!(!status.enabled);
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn an_unreachable_server_is_reported_and_the_loop_keeps_retrying() {
    let root = scratch();
    let config = AppConfig {
        // Port 1 on loopback: nothing listens, so enrollment fails in transport.
        server_url: "http://127.0.0.1:1".into(),
        executor_enabled: true,
        executor_root: root.to_string_lossy().to_string(),
        executor_allowlist: vec!["git".into()],
        ..Default::default()
    };
    let store = Arc::new(ConfigStore::new(root.clone()));
    let shared = Arc::new(tokio::sync::RwLock::new(config));
    let executor = Arc::new(Executor::new(store, shared));

    executor.apply().await;
    assert!(executor.status().running, "the loop runs even when the server is down");
    // Give the first enrollment attempt time to fail and be recorded.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let status = executor.status();
    assert!(
        status.last_error.starts_with("unreachable"),
        "the failure must be visible: {}",
        status.last_error
    );
    executor.stop().await;
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_generated_identity_is_unique_and_path_safe() {
    let first = generate_node_id();
    let second = generate_node_id();
    assert_ne!(first, second);
    assert!(first.starts_with("node-"));
    assert!(first.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    assert!(first.len() <= 64, "the server caps node ids at 64 characters");
}

#[test]
fn the_display_name_is_never_empty() {
    let name = node_name();
    assert!(!name.trim().is_empty());
}

#[test]
fn the_clock_is_wall_time_in_seconds() {
    let before = unix_seconds();
    let after = unix_seconds();
    // A monotonic counter or an uptime would break every `last_seen` the server
    // compares against its own clock.
    assert!(before > 1_700_000_000, "the clock must be wall time, not an uptime");
    assert!(after >= before);
}

#[tokio::test]
async fn switching_the_node_off_interrupts_a_pending_wait() {
    // The loop parks between polls. Switching the node off must return at once
    // rather than waiting the interval out, or the window would look unresponsive
    // for the rest of that window.
    let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
    let waiter = tokio::spawn(async move {
        let started = std::time::Instant::now();
        // `sleep_or_stop` answers "did the delay run to completion?", so being cut
        // short is a false here.
        let slept_fully = sleep_or_stop(&mut stop_rx, std::time::Duration::from_secs(30)).await;
        (slept_fully, started.elapsed())
    });

    stop_tx.send(true).unwrap();
    let (slept_fully, elapsed) = waiter.await.unwrap();
    assert!(!slept_fully, "the wait must report that it was cut short");
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "stopping must not wait for the timer: {elapsed:?}"
    );
}

#[tokio::test]
async fn only_exec_reaches_the_spawn() {
    let root = scratch();
    let allow = vec!["echo".to_string()];
    let policy = Policy::new(root.to_str().unwrap(), &allow).unwrap();

    // The remote provider's environment *is* this machine, so the lifecycle
    // verbs are acknowledgements rather than local work.
    for op in ["create", "destroy", "status"] {
        let job = Job { id: "j".into(), op: op.into(), lease_id: "l".into(), request: ExecRequest::default() };
        let outcome = execute(&policy, &job).await;
        assert_eq!(outcome.exit_code, 0, "{op} must be acknowledged");
        assert!(outcome.error.is_empty());
    }

    let unknown = Job { id: "j".into(), op: "teleport".into(), lease_id: "l".into(), request: ExecRequest::default() };
    let outcome = execute(&policy, &unknown).await;
    assert_eq!(outcome.error, "unsupported_op:teleport");

    // And a refused command comes back as a reason, not a panic.
    let refused = Job {
        id: "j".into(),
        op: "exec".into(),
        lease_id: "l".into(),
        request: ExecRequest { command: "rm".into(), ..Default::default() },
    };
    assert_eq!(execute(&policy, &refused).await.error, "command_not_allowed");
    let _ = std::fs::remove_dir_all(&root);
}
