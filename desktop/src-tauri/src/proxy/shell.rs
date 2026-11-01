//! The shell's own endpoints: `/__shell/*`.
//!
//! They exist so the connection page can talk to the Rust side without any IPC
//! permissions at all — it is a plain same-origin page talking to the loopback
//! proxy, which is already the only thing the window is allowed to reach.

use std::time::Duration;

use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use tauri::Manager;

use crate::config::{normalize_server_url, UrlError};
use crate::proxy::{forward, static_files, ProxyState};
use crate::notify;

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
struct ConfigPayload {
    server_url: Option<String>,
    accept_invalid_certs: Option<bool>,
    lang: Option<String>,
    background: Option<bool>,
    notify_enabled: Option<bool>,
    notify_quiet_minutes: Option<u16>,
    executor_enabled: Option<bool>,
    executor_root: Option<String>,
    executor_allowlist: Option<Vec<String>>,
    executor_max_concurrency: Option<u16>,
    executor_api_key: Option<String>,
}

/// The settings screen's execution-node block. Everything here is local: the
/// server never decides whether this machine accepts work.
#[derive(Debug, Deserialize)]
struct ExecutorPayload {
    enabled: Option<bool>,
    root: Option<String>,
    allowlist: Option<Vec<String>>,
    max_concurrency: Option<u16>,
    api_key: Option<String>,
}

pub async fn handle(state: &ProxyState, req: Request) -> Response {
    let method = req.method().as_str().to_ascii_uppercase();
    let path = req.uri().path().to_string();
    match (method.as_str(), path.as_str()) {
        ("GET", "/__shell" | "/__shell/" | "/__shell/connect") => page(state, "connect").await,
        ("GET", "/__shell/about") => page(state, "about").await,
        ("GET", "/__shell/config") => read_config(state).await,
        ("POST", "/__shell/config") => save_config(state, req).await,
        ("GET", "/__shell/executor") => read_executor(state),
        ("POST", "/__shell/executor") => save_executor(state, req).await,
        ("POST", "/__shell/test") => test_connection(req).await,
        ("POST", "/__shell/notify") => notify::handle(state, req).await,
        ("POST", "/__shell/hide") => hide_window(state),
        _ => (
            StatusCode::NOT_FOUND,
            axum::Json(json!({ "code": "not_found" })),
        )
            .into_response(),
    }
}

async fn page(state: &ProxyState, name: &str) -> Response {
    // Clone and drop the guard before rendering: keeping it would block a
    // connection save that is in flight.
    let config = state.config.read().await.clone();
    static_files::shell_page(name, &config)
}

async fn read_config(state: &ProxyState) -> Response {
    let config = state.config.read().await;
    axum::Json(json!({
        "serverUrl": config.server_url,
        "acceptInvalidCerts": config.accept_invalid_certs,
        "lang": config.lang(),
        "background": config.background,
        "notifyEnabled": config.notify_enabled,
        "notifyQuietMinutes": config.notify_quiet_minutes,
        // The execution-node block lives here too, so one read describes the
        // whole shell; the live state (running, last error) comes from
        // /__shell/executor, which is the only place that can answer it.
        "executorEnabled": config.executor_enabled,
        "executorRoot": config.executor_root,
        "executorAllowlist": config.executor_allowlist,
        "executorMaxConcurrency": config.executor_max_concurrency,
        "executorNodeId": config.executor_node_id,
        "executorHasApiKey": !config.executor_api_key.is_empty(),
    }))
    .into_response()
}

/// The execution node's live state. It is a separate endpoint from
/// `/__shell/config` because it changes without anyone saving: the loop enrolls,
/// polls and fails on its own.
fn read_executor(state: &ProxyState) -> Response {
    axum::Json(json!({
        "status": state.executor.status(),
        "limits": {
            "maxOutputBytes": crate::executor::policy::DEFAULT_MAX_OUTPUT,
            "timeoutSeconds": crate::executor::policy::DEFAULT_TIMEOUT.as_secs(),
        },
        "shellsRefused": true,
    }))
    .into_response()
}

/// Switches the node on or off and rewrites its policy. Validation happens before
/// the save, so a bad root or a shell in the whitelist is refused with a stable
/// reason instead of being stored and failing on the next job.
async fn save_executor(state: &ProxyState, req: Request) -> Response {
    let Some(payload) = decode_executor(req).await else {
        return failure("invalid_json", StatusCode::BAD_REQUEST);
    };
    {
        let mut config = state.config.write().await;
        if let Some(enabled) = payload.enabled {
            config.executor_enabled = enabled;
        }
        if let Some(root) = payload.root {
            config.executor_root = root.trim().to_string();
        }
        if let Some(allowlist) = payload.allowlist {
            config.executor_allowlist = allowlist
                .into_iter()
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .collect();
        }
        if let Some(max) = payload.max_concurrency {
            // A desktop has a handful of cores; more than 8 concurrent commands
            // is a configuration mistake, not a policy.
            config.executor_max_concurrency = max.clamp(1, 8);
        }
        if let Some(key) = payload.api_key {
            config.executor_api_key = key.trim().to_string();
        }
    }

    let snapshot = state.config.read().await.clone();
    if snapshot.executor_enabled {
        if let Err(error) = crate::executor::Policy::new(&snapshot.executor_root, &snapshot.executor_allowlist) {
            return failure(error.reason(), StatusCode::BAD_REQUEST);
        }
    }
    if let Err(err) = state.store.save(&snapshot) {
        eprintln!("agentbuddy desktop: cannot save the execution node settings: {err}");
        return failure("not_saved", StatusCode::INTERNAL_SERVER_ERROR);
    }
    state.executor.apply().await;
    axum::Json(json!({ "ok": true, "status": state.executor.status() })).into_response()
}

async fn save_config(state: &ProxyState, req: Request) -> Response {
    let Some(payload) = decode(req).await else {
        return failure("invalid_json", StatusCode::BAD_REQUEST);
    };
    let mut config = state.config.write().await;
    if let Some(raw) = payload.server_url {
        let url = if raw.trim().is_empty() {
            String::new()
        } else {
            match normalize_server_url(&raw) {
                Ok(url) => url,
                Err(_) => return failure("invalid", StatusCode::BAD_REQUEST),
            }
        };
        // The saved session belongs to whichever server we are leaving; never
        // replay it to a different one. If the new server already has a stored
        // session, resume it in the jar so the switch is seamless.
        if url != config.server_url {
            let _ = state.store.save_session(&config.server_url, "");
            if !url.is_empty() {
                crate::proxy::seed_jar_from_store(&state.jar, &state.store, &url);
            }
        }
        config.server_url = url;
    }
    if let Some(insecure) = payload.accept_invalid_certs {
        config.accept_invalid_certs = insecure;
    }
    if let Some(lang) = payload.lang {
        config.lang = lang;
    }
    if let Some(background) = payload.background {
        config.background = background;
    }
    if let Some(notify_enabled) = payload.notify_enabled {
        config.notify_enabled = notify_enabled;
    }
    if let Some(quiet) = payload.notify_quiet_minutes {
        // A sane ceiling keeps the stored preference meaningful.
        config.notify_quiet_minutes = quiet.min(1440);
    }
    // The execution-node block travels with the rest of the config so a settings
    // screen can save everything in one call; /__shell/executor is the focused
    // endpoint that also reports whether the node came up.
    let executor_touched = payload.executor_enabled.is_some()
        || payload.executor_root.is_some()
        || payload.executor_allowlist.is_some()
        || payload.executor_max_concurrency.is_some()
        || payload.executor_api_key.is_some();
    if let Some(enabled) = payload.executor_enabled {
        config.executor_enabled = enabled;
    }
    if let Some(root) = payload.executor_root {
        config.executor_root = root.trim().to_string();
    }
    if let Some(allowlist) = payload.executor_allowlist {
        config.executor_allowlist = allowlist
            .into_iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect();
    }
    if let Some(max) = payload.executor_max_concurrency {
        config.executor_max_concurrency = max.clamp(1, 8);
    }
    if let Some(key) = payload.executor_api_key {
        config.executor_api_key = key.trim().to_string();
    }
    // Refuse an unusable policy before it is stored: enabling the node with a
    // relative root would otherwise look saved and silently never run.
    if config.executor_enabled {
        if let Err(error) =
            crate::executor::Policy::new(&config.executor_root, &config.executor_allowlist)
        {
            return failure(error.reason(), StatusCode::BAD_REQUEST);
        }
    }
    let snapshot = config.clone();
    drop(config);

    if let Err(err) = state.store.save(&snapshot) {
        eprintln!("agentbuddy desktop: cannot save the connection: {err}");
        return failure("not_saved", StatusCode::INTERNAL_SERVER_ERROR);
    }
    // The tray menu is written in the user's language, so it has to follow.
    if let Some(app) = &state.app {
        crate::tray::refresh(app, &snapshot);
    }
    if executor_touched {
        // Pointing the shell at a different server changes who the node reports
        // to, so the loop is rebuilt even when only the URL changed.
        state.executor.apply().await;
    }
    axum::Json(json!({ "ok": true })).into_response()
}

async fn test_connection(req: Request) -> Response {
    let Some(payload) = decode(req).await else {
        return failure("invalid_json", StatusCode::BAD_REQUEST);
    };
    let base = match normalize_server_url(payload.server_url.as_deref().unwrap_or("")) {
        Ok(base) => base,
        Err(UrlError::Empty) => return failure("empty", StatusCode::BAD_REQUEST),
        Err(UrlError::Invalid) => return failure("invalid", StatusCode::BAD_REQUEST),
    };
    let insecure = payload.accept_invalid_certs.unwrap_or(false);
    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(insecure)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(crate::proxy::CONNECT_TIMEOUT)
        .timeout(PROBE_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(_) => return failure("unexpected", StatusCode::INTERNAL_SERVER_ERROR),
    };
    match client.get(format!("{base}/healthz")).send().await {
        // Any HTTP answer at all means the address was right: /healthz is the
        // one endpoint every deployment serves, including gated ones.
        Ok(resp) => axum::Json(json!({ "ok": true, "status": resp.status().as_u16() })).into_response(),
        Err(err) => {
            let reason = forward::classify(&err);
            eprintln!("agentbuddy desktop: the connection test failed ({reason})");
            failure(reason, StatusCode::OK)
        }
    }
}

fn hide_window(state: &ProxyState) -> Response {
    if let Some(app) = &state.app {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
    axum::Json(json!({ "ok": true })).into_response()
}

async fn decode(req: Request) -> Option<ConfigPayload> {
    let bytes = to_bytes(req.into_body(), MAX_BODY).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

async fn decode_executor(req: Request) -> Option<ExecutorPayload> {
    let bytes = to_bytes(req.into_body(), MAX_BODY).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// A refused shell request. `code` mirrors `reason` on purpose: the workbench's
/// API client reads `code`, and the shell must obey the same "never prose, always
/// a machine code" rule agenthub does.
fn failure(reason: &str, status: StatusCode) -> Response {
    (status, axum::Json(json!({ "ok": false, "code": reason, "reason": reason }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppConfig, ConfigStore};
    use crate::proxy::forward;
    use axum::body::to_bytes;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tokio::sync::RwLock;

    async fn state() -> ProxyState {
        let dir = std::env::temp_dir().join(format!("agentbuddy-shell-{}", std::process::id()));
        let store = Arc::new(ConfigStore::new(dir));
        let jar = Arc::new(reqwest::cookie::Jar::default());
        let clients = forward::Clients::new(jar.clone()).expect("the forwarding client builds");
        let config = Arc::new(RwLock::new(AppConfig::default()));
        let executor = Arc::new(crate::executor::Executor::new(store.clone(), config.clone()));
        ProxyState {
            clients,
            config,
            store,
            self_url: "http://127.0.0.1:0".to_string(),
            app: None,
            jar,
            executor,
        }
    }

    fn req(method: &str, path: &str) -> Request<Body> {
        Request::builder().method(method).uri(path).body(Body::empty()).unwrap()
    }

    async fn decode(resp: Response) -> (StatusCode, serde_json::Value) {
        let (parts, body) = resp.into_parts();
        let bytes = to_bytes(body, 1 << 20).await.unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (parts.status, json)
    }

    #[tokio::test]
    async fn unknown_shell_route_returns_not_found() {
        let state = state().await;
        let (status, json) = decode(handle(&state, req("GET", "/__shell/nope")).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json["code"], "not_found");
    }

    #[tokio::test]
    async fn hide_answers_ok_without_a_window() {
        // With no app handle the handler must not crash; it simply has nothing to hide.
        let state = state().await;
        let (status, json) = decode(handle(&state, req("POST", "/__shell/hide")).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["ok"], true);
    }

    #[tokio::test]
    async fn read_config_echoes_the_current_settings() {
        let state = state().await;
        let (status, json) = decode(handle(&state, req("GET", "/__shell/config")).await).await;
        assert_eq!(status, StatusCode::OK);
        // The defaults from AppConfig.
        assert_eq!(json["background"], true);
        assert_eq!(json["notifyEnabled"], true);
        assert_eq!(json["notifyQuietMinutes"], 0);
        assert_eq!(json["acceptInvalidCerts"], false);
        // The node is off and has no identity until it is switched on.
        assert_eq!(json["executorEnabled"], false);
        assert_eq!(json["executorNodeId"], "");
        assert_eq!(json["executorHasApiKey"], false);
    }

    #[tokio::test]
    async fn the_executor_endpoint_reports_off_until_it_is_switched_on() {
        let state = state().await;
        let (status, json) = decode(handle(&state, req("GET", "/__shell/executor")).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["status"]["enabled"], false);
        assert_eq!(json["status"]["running"], false);
        assert_eq!(json["shellsRefused"], true);
        assert!(json["limits"]["maxOutputBytes"].as_u64().unwrap() > 0);
        assert!(json["limits"]["timeoutSeconds"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn enabling_the_executor_with_a_relative_root_is_refused() {
        let state = state().await;
        let body = serde_json::json!({
            "enabled": true,
            "root": "relative/path",
            "allowlist": ["git"],
        });
        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/executor")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["ok"], false);
        assert_eq!(json["reason"], "root_unusable");
        // Nothing was persisted, so the node is still off.
        assert!(!state.store.load().executor_enabled);
    }

    #[tokio::test]
    async fn enabling_the_executor_with_a_shell_whitelisted_is_refused() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-shell-root-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = state().await;
        let body = serde_json::json!({
            "enabled": true,
            "root": dir.to_string_lossy(),
            "allowlist": ["sh"],
        });
        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/executor")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["reason"], "command_not_allowed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn saving_the_executor_settings_without_enabling_persists_a_draft() {
        let state = state().await;
        let body = serde_json::json!({ "allowlist": ["git", " ", "npm"], "max_concurrency": 99 });
        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/executor")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["ok"], true);
        let saved = state.store.load();
        // Blank lines are dropped and the concurrency is clamped, not accepted.
        assert_eq!(saved.executor_allowlist, vec!["git".to_string(), "npm".to_string()]);
        assert_eq!(saved.executor_max_concurrency, 8);
        assert!(!saved.executor_enabled);
    }

    #[tokio::test]
    async fn an_unreadable_executor_body_is_rejected() {
        let state = state().await;
        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/executor")
                    .header("content-type", "application/json")
                    .body(Body::from("{ not json"))
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["reason"], "invalid_json");
    }
}
