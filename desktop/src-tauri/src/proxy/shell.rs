//! The shell's own endpoints: `/__shell/*`.
//!
//! They exist so the connection page can talk to the Rust side without any IPC
//! permissions at all — it is a plain same-origin page talking to the loopback
//! proxy, which is already the only thing the window is allowed to reach.

use std::time::Duration;

use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use tauri::Manager;

use crate::config::{normalize_server_url, UrlError};
use crate::proxy::{auth, forward, static_files, BOOTSTRAP_PATH, ProxyState};
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
    upgrade_auto_check: Option<bool>,
    upgrade_skipped_version: Option<String>,
}

/// The settings screen's execution-node block. Everything here is local: the
/// server never decides whether this machine accepts work.
/// The badge the workbench reports. `count` is required: a request that omits it
/// is a bug in the caller, not "clear the badge".
#[derive(Debug, Deserialize)]
struct BadgePayload {
    count: Option<u32>,
}

/// The largest count the tray badge keeps. Past that the number stops fitting and
/// the same ceiling is applied to the tooltip and the title.
const MAX_BADGE: u32 = 999;

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
        // The only route reachable without the proxy cookie. `dispatch` lets it
        // through for exactly that reason; see `auth` for the handshake.
        ("GET", BOOTSTRAP_PATH) => bootstrap(state, req).await,
        ("GET", "/__shell" | "/__shell/" | "/__shell/connect") => page(state, "connect").await,
        ("GET", "/__shell/about") => page(state, "about").await,
        ("GET", "/__shell/config") => read_config(state).await,
        ("POST", "/__shell/config") => save_config(state, req).await,
        ("GET", "/__shell/executor") => read_executor(state),
        ("POST", "/__shell/executor") => save_executor(state, req).await,
        ("POST", "/__shell/test") => test_connection(req).await,
        ("POST", "/__shell/notify") => notify::handle(state, req).await,
        // The unread count the workbench pushes after every change of a count it
        // renders anyway: the tray is the same number, seen when the window is
        // hidden.
        ("POST", "/__shell/badge") => set_badge(state, req).await,
        ("POST", "/__shell/hide") => hide_window(state),
        // Release checks. All three inherit the proxy cookie and Origin gate
        // from `dispatch`; none of them grants the page a Tauri permission.
        ("GET", "/__shell/upgrade") => read_upgrade(state).await,
        ("POST", "/__shell/upgrade/check") => check_upgrade(state).await,
        ("POST", "/__shell/upgrade/install") => install_upgrade(state).await,
        _ => (
            StatusCode::NOT_FOUND,
            axum::Json(json!({ "code": "not_found" })),
        )
            .into_response(),
    }
}

async fn bootstrap(state: &ProxyState, req: Request) -> Response {
    // With admission control off (the test router) there is no token to hand out.
    let Some(auth) = state.auth.as_ref() else {
        return failure("proxy_auth_disabled", StatusCode::NOT_FOUND);
    };
    let nonce = req.uri().query().and_then(|query| query_param(query, "nonce")).unwrap_or_default();
    if !auth.take_nonce(nonce) {
        return failure("proxy_nonce_refused", StatusCode::FORBIDDEN);
    }
    // 303: whatever method arrived, the exchange lands on `/` as a GET. The
    // cookie carries the token from here on; the nonce is spent.
    (
        StatusCode::SEE_OTHER,
        [
            (header::SET_COOKIE, auth::bootstrap_cookie(auth.token())),
            (header::LOCATION, "/".to_string()),
        ],
    )
        .into_response()
}

/// Reads one key out of a raw query string.
///
/// A nonce is hex, so it needs no percent-decoding and the shell needs no URL
/// form dependency for this one lookup.
fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(name, _)| *name == key)
        .map(|(_, value)| value)
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
        // The update preferences live in the same config so one save describes
        // the whole shell; the live check state is /__shell/upgrade.
        "upgradeAutoCheck": config.upgrade_auto_check,
        "upgradeSkippedVersion": config.upgrade_skipped_version,
        // Where the agenthub session is kept: "keyring", "file" or "memory".
        // A machine-code, not prose — the settings screen localizes it.
        "sessionBackend": state.store.session_backend(),
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
    if let Some(auto) = payload.upgrade_auto_check {
        config.upgrade_auto_check = auto;
    }
    if let Some(skipped) = payload.upgrade_skipped_version {
        // A version string, not free text: it is persisted and later compared
        // to a release tag. An empty value clears the skip.
        let value = skipped.trim();
        if value.is_empty() || crate::upgrade::source::valid_tag(value) {
            config.upgrade_skipped_version = value.to_string();
        }
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

/// The state the settings card, the sidebar banner and the about page read.
/// The two preferences come from the config rather than the cached snapshot so
/// a change made through `/__shell/config` is visible without another check.
async fn read_upgrade(state: &ProxyState) -> Response {
    let Some(upgrade) = &state.upgrade else {
        return failure("not_configured", StatusCode::NOT_FOUND);
    };
    let mut snapshot = upgrade.snapshot().await;
    let config = state.config.read().await;
    snapshot.auto_check = config.upgrade_auto_check;
    snapshot.skipped_version = if config.upgrade_skipped_version.trim().is_empty() {
        None
    } else {
        Some(config.upgrade_skipped_version.clone())
    };
    axum::Json(snapshot).into_response()
}

/// Manual "Check for updates": always allowed, even with auto-checking off.
async fn check_upgrade(state: &ProxyState) -> Response {
    let Some(upgrade) = &state.upgrade else {
        return failure("not_configured", StatusCode::NOT_FOUND);
    };
    axum::Json(upgrade.check_now(true).await).into_response()
}

/// Only the settings card calls this, and only after the user pressed the
/// button. A refusal is an HTTP error carrying a machine code, so the API
/// client turns it into an `ApiError` the UI can localise.
async fn install_upgrade(state: &ProxyState) -> Response {
    let Some(upgrade) = &state.upgrade else {
        return failure("not_configured", StatusCode::NOT_FOUND);
    };
    match upgrade.install().await {
        Ok(snapshot) => axum::Json(snapshot).into_response(),
        Err(code) => failure(code.as_str(), StatusCode::BAD_REQUEST),
    }
}

/// Records the unread count and mirrors it onto the tray.
///
/// The value is clamped rather than refused: a workbench that counted a hundred
/// thousand events still wants a badge, and the tray can only render "99+". The
/// count is kept here so a language change (which rebuilds the tray) can put the
/// same number back.
async fn set_badge(state: &ProxyState, req: Request) -> Response {
    let Some(payload) = decode_badge(req).await else {
        return failure("invalid_json", StatusCode::BAD_REQUEST);
    };
    let Some(count) = payload.count else {
        return failure("invalid_count", StatusCode::BAD_REQUEST);
    };
    let count = count.min(MAX_BADGE);
    if let Ok(mut slot) = state.unread.lock() {
        *slot = count;
    }
    let lang = state.config.read().await.lang();
    if let Some(app) = &state.app {
        crate::tray::set_unread(app, lang, count);
    }
    axum::Json(json!({ "ok": true, "count": count })).into_response()
}

async fn decode_badge(req: Request) -> Option<BadgePayload> {
    let bytes = to_bytes(req.into_body(), MAX_BODY).await.ok()?;
    serde_json::from_slice(&bytes).ok()
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
            // The tests drive the shell handlers directly; admission control is
            // exercised in `proxy::auth` and in the end-to-end proxy tests.
            auth: None,
            unread: Arc::new(std::sync::Mutex::new(0)),
            upgrade: None,
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

    /// A headless upgrader: no window, so it can never install — but the GET
    /// route and the config round-trip are fully testable.
    async fn state_with_upgrade() -> ProxyState {
        let mut state = state().await;
        state.upgrade = Some(crate::upgrade::Upgrader::new(
            state.config.clone(),
            state.store.clone(),
            None,
        ));
        state
    }

    fn json_post(path: &str, body: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn the_upgrade_routes_answer_not_configured_without_a_window() {
        let state = state().await;
        for (method, path) in [
            ("GET", "/__shell/upgrade"),
            ("POST", "/__shell/upgrade/check"),
            ("POST", "/__shell/upgrade/install"),
        ] {
            let (status, json) = decode(handle(&state, req(method, path)).await).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}");
            assert_eq!(json["code"], "not_configured");
        }
    }

    #[tokio::test]
    async fn the_upgrade_state_is_readable_without_touching_the_network() {
        let state = state_with_upgrade().await;
        let (status, json) = decode(handle(&state, req("GET", "/__shell/upgrade")).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["status"], "idle");
        assert_eq!(json["currentVersion"], crate::VERSION);
        assert_eq!(json["autoCheck"], true);
        assert!(json["latestVersion"].is_null());
    }

    #[tokio::test]
    async fn the_config_endpoint_persists_the_update_preferences() {
        let state = state().await;
        let (status, _) = decode(
            handle(
                &state,
                json_post(
                    "/__shell/config",
                    r#"{"upgrade_auto_check":false,"upgrade_skipped_version":"0.9.0"}"#,
                ),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (_, json) = decode(handle(&state, req("GET", "/__shell/config")).await).await;
        assert_eq!(json["upgradeAutoCheck"], false);
        assert_eq!(json["upgradeSkippedVersion"], "0.9.0");
    }

    #[tokio::test]
    async fn a_hostile_skipped_version_is_not_stored() {
        let state = state().await;
        let (status, _) = decode(
            handle(
                &state,
                json_post(
                    "/__shell/config",
                    r#"{"upgrade_skipped_version":"../../etc/passwd"}"#,
                ),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (_, json) = decode(handle(&state, req("GET", "/__shell/config")).await).await;
        assert_eq!(json["upgradeSkippedVersion"], "");
    }

    /// The same state, with admission control on — the only configuration in
    /// which bootstrap has a token to hand out.
    async fn state_with_auth() -> ProxyState {
        let mut state = state().await;
        state.auth = Some(Arc::new(auth::Auth::new()));
        state
    }

    async fn reply(resp: Response) -> (StatusCode, axum::http::HeaderMap) {
        let (parts, body) = resp.into_parts();
        let _ = to_bytes(body, 1 << 20).await;
        (parts.status, parts.headers)
    }

    #[tokio::test]
    async fn bootstrap_trades_the_nonce_for_the_proxy_cookie() {
        let state = state_with_auth().await;
        let auth = state.auth.clone().unwrap();
        let nonce = auth.new_nonce();
        let (status, headers) =
            reply(handle(&state, req("GET", &format!("/__shell/bootstrap?nonce={nonce}"))).await)
                .await;
        assert_eq!(status, StatusCode::SEE_OTHER);
        assert_eq!(headers.get("location").unwrap(), "/");
        let cookie = headers.get("set-cookie").unwrap().to_str().unwrap();
        assert!(cookie.starts_with(&format!("{}={}", auth::COOKIE_NAME, auth.token())));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));
        assert!(cookie.contains("Path=/"));
        // The nonce bought exactly one redirect.
        let (again, _) =
            reply(handle(&state, req("GET", &format!("/__shell/bootstrap?nonce={nonce}"))).await)
                .await;
        assert_eq!(again, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn bootstrap_refuses_a_nonce_it_did_not_issue() {
        let state = state_with_auth().await;
        let (status, headers) = reply(handle(&state, req("GET", "/__shell/bootstrap?nonce=abc")).await).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(headers.get("set-cookie").is_none(), "a refused nonce must not mint a cookie");
    }

    #[tokio::test]
    async fn bootstrap_without_a_nonce_is_refused() {
        let state = state_with_auth().await;
        let (status, _) = reply(handle(&state, req("GET", "/__shell/bootstrap")).await).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn bootstrap_reports_itself_unavailable_when_admission_control_is_off() {
        let state = state().await;
        let (status, json) = decode(handle(&state, req("GET", "/__shell/bootstrap")).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json["code"], "proxy_auth_disabled");
    }

    #[tokio::test]
    async fn reissuing_a_nonce_retires_the_earlier_url() {
        // Two windows (or a reload with a new URL) must not leave the previous
        // bootstrap link usable: it is a bearer credential in a query string.
        let state = state_with_auth().await;
        let auth = state.auth.clone().unwrap();
        let first = auth.new_nonce();
        let second = auth.new_nonce();

        let (stale, _) =
            reply(handle(&state, req("GET", &format!("/__shell/bootstrap?nonce={first}"))).await)
                .await;
        assert_eq!(stale, StatusCode::FORBIDDEN);

        let (fresh, headers) =
            reply(handle(&state, req("GET", &format!("/__shell/bootstrap?nonce={second}"))).await)
                .await;
        assert_eq!(fresh, StatusCode::SEE_OTHER);
        assert!(headers.get("set-cookie").is_some());
    }

    #[tokio::test]
    async fn bootstrap_reads_the_nonce_out_of_a_busy_query_string() {
        // The window URL may grow other parameters; only the named one counts.
        let state = state_with_auth().await;
        let auth = state.auth.clone().unwrap();
        let nonce = auth.new_nonce();
        let path = format!("/__shell/bootstrap?lang=zh&nonce={nonce}&theme=light");
        let (status, _) = reply(handle(&state, req("GET", &path)).await).await;
        assert_eq!(status, StatusCode::SEE_OTHER);
    }

    #[tokio::test]
    async fn bootstrap_only_answers_get() {
        // A cross-site form post must not be able to burn the nonce, and a
        // preflight must not learn anything from this route.
        let state = state_with_auth().await;
        let auth = state.auth.clone().unwrap();
        let nonce = auth.new_nonce();
        let (status, json) = decode(
            handle(&state, req("POST", &format!("/__shell/bootstrap?nonce={nonce}"))).await,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json["code"], "not_found");
        // The nonce is untouched, so the real window can still redeem it.
        assert!(auth.take_nonce(&nonce));
    }

    #[tokio::test]
    async fn the_badge_endpoint_records_the_unread_count() {
        let state = state().await;
        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/badge")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"count":7}"#))
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["ok"], true);
        assert_eq!(json["count"], 7);
        // The count lives in the shell, so a language change can re-apply it.
        assert_eq!(*state.unread.lock().unwrap(), 7);

        // Zero is how the workbench says "all read".
        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/badge")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"count":0}"#))
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["count"], 0);
        assert_eq!(*state.unread.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn the_badge_is_capped_rather_than_refused() {
        let state = state().await;
        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/badge")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"count":100000}"#))
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["count"], MAX_BADGE);
        assert_eq!(*state.unread.lock().unwrap(), MAX_BADGE);
    }

    #[tokio::test]
    async fn a_badge_without_a_count_is_a_client_error() {
        let state = state().await;
        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/badge")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"unread":3}"#))
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["reason"], "invalid_count");
        assert_eq!(*state.unread.lock().unwrap(), 0);

        let (status, json) = decode(
            handle(
                &state,
                Request::builder()
                    .method("POST")
                    .uri("/__shell/badge")
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
        // The test store is the file backend; a real install says "keyring".
        assert_eq!(json["sessionBackend"], "file");
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
