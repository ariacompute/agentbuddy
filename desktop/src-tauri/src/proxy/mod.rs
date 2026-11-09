//! The loopback reverse proxy.
//!
//! Why a proxy at all: the workbench is written for the web. Every request it
//! makes is a relative URL (`/api/...`, `BASE = ''` in `web/src/lib/api.js`) and
//! every request carries `credentials: 'include'`, so the session cookie has to
//! live on the origin the page came from. Serving the workbench from a
//! `tauri://`-style custom protocol would break both — and Tauri v2 custom
//! protocol responses are a single buffered byte vector, which cannot carry a
//! server-sent event stream at all.
//!
//! So the shell serves the workbench from `http://127.0.0.1:<random port>`, where
//! anything the workbench asks for is forwarded to the server the user configured.
//! Relative URLs, `HttpOnly` cookies, SSE and file downloads then behave exactly
//! as they do in a browser, and neither the workbench nor the Go server changes.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::cookie::Jar;
use url::Url;

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Router;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::config::{ConfigStore, SharedConfig};

pub mod auth;
pub mod csp;
pub mod forward;
pub mod shell;
pub mod static_files;

/// Everything under this prefix belongs to the shell, never to the server.
pub const SHELL_PREFIX: &str = "/__shell";

/// The one route reachable without a token: it trades a single-use nonce for the
/// proxy cookie and then redirects. Without it the WebView could never obtain the
/// token, because it cannot be told to attach a header to a navigation.
pub const BOOTSTRAP_PATH: &str = "/__shell/bootstrap";

/// Bounded so a server that never answers does not hang the handshake; there is
/// deliberately no overall timeout, because SSE streams stay open.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Console requests are JSON-RPC envelopes; 32 MiB is far past anything they
/// need while still stopping an accidental runaway upload.
pub const MAX_REQUEST_BODY: usize = 32 * 1024 * 1024;

#[derive(Clone)]
pub struct ProxyState {
    pub clients: forward::Clients,
    pub config: SharedConfig,
    pub store: Arc<ConfigStore>,
    /// The loopback origin, used to rewrite redirects that point back at the
    /// server so an OAuth round trip stays inside the app.
    pub self_url: String,
    /// `None` only in tests, which drive the proxy without a window.
    pub app: Option<tauri::AppHandle>,
    /// The cookie jar the proxy forwards on every upstream request. It is the
    /// authority on the current agenthub session (the WebView's own cookie
    /// header is dropped before forwarding), so it is persisted to disk and
    /// re-seeded on launch to survive an app restart.
    pub jar: Arc<Jar>,
    /// The execution node. It lives in this process, not in the webview, so the
    /// workbench page never gains filesystem or command access — and it is the
    /// same object the settings screen toggles.
    pub executor: Arc<crate::executor::Executor>,
    /// Admission control. `None` only in the test router, which has no window to
    /// bootstrap a cookie into.
    pub auth: Option<Arc<auth::Auth>>,
    /// How many notifications the workbench has not read. It lives here rather
    /// than in the tray so a language change (which rebuilds the menu) can put
    /// the same number back instead of losing it.
    pub unread: Arc<Mutex<u32>>,
    /// Release checks and installs. `None` in headless tests, where there is
    /// neither a window to install into nor a timer worth starting.
    pub upgrade: Option<Arc<crate::upgrade::Upgrader>>,
}

pub struct ProxyHandle {
    pub port: u16,
    pub url: String,
    /// Where the window should open: it trades the nonce for the cookie and then
    /// lands on `/`. `None` when admission control is off (tests).
    pub bootstrap_url: Option<String>,
    /// Kept so the listener task is not dropped at the end of `start`.
    _task: JoinHandle<()>,
}

#[derive(Debug)]
pub enum ProxyError {
    Bind(std::io::Error),
    Client(reqwest::Error),
}

impl std::fmt::Display for ProxyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProxyError::Bind(err) => write!(f, "cannot listen on 127.0.0.1: {err}"),
            ProxyError::Client(err) => write!(f, "cannot build the forwarding client: {err}"),
        }
    }
}

/// Binds 127.0.0.1 on a port the OS picks, so two instances never collide and
/// nothing outside the machine can reach it.
pub async fn start(
    config: SharedConfig,
    store: Arc<ConfigStore>,
    app: tauri::AppHandle,
) -> Result<ProxyHandle, ProxyError> {
    start_inner(config, store, Some(app)).await
}

async fn start_inner(
    config: SharedConfig,
    store: Arc<ConfigStore>,
    app: Option<tauri::AppHandle>,
) -> Result<ProxyHandle, ProxyError> {
    let jar = Arc::new(reqwest::cookie::Jar::default());
    // Resume the previous session so a relaunch does not force a fresh login:
    // the saved cookie is replayed into the jar for the configured server.
    if let Some(server) = config.read().await.server_url() {
        seed_jar_from_store(&jar, &store, &server);
    }
    let clients = forward::Clients::new(jar.clone()).map_err(ProxyError::Client)?;

    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(ProxyError::Bind)?;
    let port = listener.local_addr().map_err(ProxyError::Bind)?.port();
    let url = format!("http://127.0.0.1:{port}");

    let executor = Arc::new(crate::executor::Executor::new(store.clone(), config.clone()));
    // Admission control is tied to the presence of a window: the token is handed
    // to a WebView through a bootstrap redirect, so a headless router (the tests
    // drive one) has nobody to hand it to and runs the plain forwarding path.
    let auth = if app.is_some() { Some(Arc::new(auth::Auth::new())) } else { None };
    let bootstrap_url = auth
        .as_ref()
        .map(|auth| format!("{url}{BOOTSTRAP_PATH}?nonce={}", auth.new_nonce()));
    // Only a real window gets the daily timer and an AppHandle to install with.
    // The headless routers the tests drive stay completely quiet — no outbound
    // release probes from a unit test.
    let upgrade = app.as_ref().map(|_| {
        let upgrader = crate::upgrade::Upgrader::new(config.clone(), store.clone(), app.clone());
        upgrader.start_timer();
        upgrader
    });
    let state = ProxyState {
        clients,
        config,
        store,
        self_url: url.clone(),
        app,
        jar,
        executor: executor.clone(),
        auth,
        unread: Arc::new(Mutex::new(0)),
        upgrade,
    };
    let router = Router::new().fallback(dispatch).with_state(state);
    let task = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, router).await {
            eprintln!("agentbuddy desktop: the loopback proxy stopped: {err}");
        }
    });

    // The node starts after the listener, in its own task: a server that is down
    // must not delay the window, and the settings screen has to answer while the
    // loop is still retrying its first enrollment.
    tokio::spawn(async move { executor.apply().await });

    Ok(ProxyHandle { port, url, bootstrap_url, _task: task })
}

async fn dispatch(State(state): State<ProxyState>, req: Request) -> Response {
    let path = req.uri().path().to_string();

    // A same-origin WebView sends `Origin: http://127.0.0.1:<port>`; a page on
    // another site sends its own. Refusing a foreign origin blocks the simplest
    // drive-by ("open a tab at the loopback port and read the console") even
    // before the cookie check, and it costs nothing when the header is absent
    // (curl, the tests, a native client holding a bearer token).
    if let Some(origin) = req.headers().get("origin").and_then(|value| value.to_str().ok()) {
        if !origin.is_empty() && origin != state.self_url {
            return refusal(StatusCode::FORBIDDEN, "proxy_origin_refused");
        }
    }

    if let Some(auth) = &state.auth {
        if path != BOOTSTRAP_PATH && !auth.authorized(req.headers()) {
            return refusal(StatusCode::UNAUTHORIZED, "proxy_unauthorized");
        }
    }

    if path == SHELL_PREFIX || path.starts_with(&format!("{SHELL_PREFIX}/")) {
        return shell::handle(&state, req).await;
    }

    let config = state.config.read().await.clone();

    if is_remote_path(&path) {
        // A path the console could never have asked for is refused here rather
        // than normalised somewhere behind three layers: `..` would walk out of
        // the mount prefix and reach endpoints this proxy was pointed at for a
        // different reason, and `//` or a backslash is how a normalising server
        // ends up somewhere else again.
        if path_is_unsafe(&path) {
            return refusal(StatusCode::BAD_REQUEST, "invalid_target");
        }
        return forward::forward(&state, req).await;
    }
    // Before the user has pointed the shell at a server, the workbench would be
    // four screens of nothing, so the root shows the connection page instead.
    if !config.is_configured() && (path.is_empty() || path == "/" || path == "/index.html") {
        return static_files::shell_page("connect", &config);
    }
    static_files::serve_console(&path, &config)
}

/// The paths that belong to the server rather than to the console bundle.
///
/// `/.well-known/` is easy to miss — the Vite dev proxy does not list it — but
/// it is how another agent discovers this one. Every server endpoint added since
/// (channels, connectors, audio, backups, computers, schedules, router, sandboxes)
/// hangs off `/api`, so a new one needs no entry here — only a new *prefix* would.
pub fn is_remote_path(path: &str) -> bool {
    path == "/api"
        || path.starts_with("/api/")
        || path == "/a2a"
        || path.starts_with("/a2a/")
        || path == "/healthz"
        || path == "/.well-known"
        || path.starts_with("/.well-known/")
}

/// True when a path that is about to be forwarded carries something that changes
/// where it lands once a server (or a proxy in front of it) normalises it.
///
/// The check runs on the *raw* path, before percent-decoding is anybody's
/// problem: `%2e%2e%2f` is the same traversal as `../`, and a server that decodes
/// before it routes would see the one and not the other. A legitimate agenthub
/// route never contains a dot segment, a doubled slash, a backslash or an
/// encoded separator, so refusing them costs nothing.
pub fn path_is_unsafe(path: &str) -> bool {
    if path.contains("..") || path.contains('\\') || path.contains("//") {
        return true;
    }
    let lower = path.to_ascii_lowercase();
    ["%2e", "%2f", "%5c", "%00"].iter().any(|needle| lower.contains(*needle))
}

/// What the console gets when it calls an endpoint with no server configured.
pub fn not_configured() -> Response {
    forward::upstream_json(StatusCode::SERVICE_UNAVAILABLE, "server_not_configured")
}

/// Refuses a request that never reached the console.
///
/// The body is a machine code, never prose: the shell and the workbench both
/// translate `proxy_unauthorized` / `proxy_origin_refused` locally, the same way
/// agenthub reports its own errors.
fn refusal(status: StatusCode, code: &str) -> Response {
    forward::upstream_json(status, code)
}

/// Replays the saved session cookie for `server` into `jar`.
///
/// The jar holds the agenthub session, so restoring it on launch (or when the
/// shell is re-pointed at a server) is what keeps the user signed in across an
/// app restart instead of dropping them back to the login page.
pub fn seed_jar_from_store(jar: &Arc<Jar>, store: &ConfigStore, server: &str) {
    if let Some(cookie) = store.load_session_cookie(server) {
        if let Ok(url) = Url::parse(server) {
            for part in cookie.split(';') {
                let part = part.trim();
                if !part.is_empty() {
                    jar.add_cookie_str(part, &url);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwards_the_prefixes_the_workbench_uses() {
        for path in [
            "/api/resources",
            "/api/tasks/1/events",
            "/api/channels",
            "/api/connectors",
            "/api/threads/1/audio",
            "/api/backups/1/download",
            "/api/auth/oauth/github",
            "/a2a",
            "/a2a/agent-card",
            "/a2a/stream",
            "/healthz",
            "/.well-known/agent.json",
        ] {
            assert!(is_remote_path(path), "{path} belongs to the server");
        }
    }

    #[test]
    fn keeps_the_console_and_the_shell_local() {
        for path in ["/", "/index.html", "/assets/index-abc.js", "/favicon.svg", "/trace", "/__shell/connect"] {
            assert!(!is_remote_path(path), "{path} must not be forwarded");
        }
    }

    #[test]
    fn does_not_mistake_a_lookalike_for_an_api_path() {
        assert!(!is_remote_path("/apifoo"));
        assert!(!is_remote_path("/a2a-live"));
    }

    /// Every route the console really uses stays forwardable: the traversal
    /// check must not cost a legitimate request.
    #[test]
    fn accepts_the_paths_the_console_actually_asks_for() {
        for path in [
            "/api",
            "/api/resources",
            "/api/tasks/42/artifacts/1",
            "/api/files/7/content",
            "/api/threads/9/audio?a=1",
            "/a2a",
            "/healthz",
            "/.well-known/agent.json",
        ] {
            assert!(!path_is_unsafe(path), "{path} must be forwarded");
        }
    }

    #[test]
    fn refuses_a_path_that_would_land_somewhere_else() {
        for path in [
            "/api/../__shell/config",   // walks out of the prefix
            "/api/tasks/../../admin",   // the same, deeper
            "/api/%2e%2e/secret",       // the encoded spelling
            "/api\\..\\secret",         // a backslash normalises to a separator
            "/api//internal",           // a doubled slash is a different URL server-side
            "/api/x%2fy",               // encoded separator
            "/api/x%5Cy",               // encoded backslash
            "/api/x%00y",               // encoded NUL truncates in C parsers
        ] {
            assert!(path_is_unsafe(path), "{path} must be refused");
        }
    }

    // ---- end to end: a real proxy, a real (fake) server, real HTTP ----

    use crate::config::AppConfig;

    /// A proxy listening on its own port, with the config the caller asked for.
    async fn proxy_with(config: AppConfig) -> ProxyHandle {
        let dir = std::env::temp_dir().join(format!("agentbuddy-proxy-{}", port_stamp()));
        let store = Arc::new(ConfigStore::new(dir));
        start_inner(Arc::new(tokio::sync::RwLock::new(config)), store, None)
            .await
            .expect("the proxy must start")
    }

    fn port_stamp() -> String {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let pid = std::process::id();
        format!("{}-{}", pid, NEXT.fetch_add(1, Ordering::Relaxed))
    }

    /// A state with admission control switched on. `start_inner` can only build
    /// one with a real window, so the gate is driven here, against `dispatch`.
    async fn state_with_auth() -> (ProxyState, Arc<auth::Auth>) {
        let dir = std::env::temp_dir().join(format!("agentbuddy-gate-{}", port_stamp()));
        let store = Arc::new(ConfigStore::new(dir));
        let jar = Arc::new(reqwest::cookie::Jar::default());
        let clients = forward::Clients::new(jar.clone()).expect("the forwarding client builds");
        let config = Arc::new(tokio::sync::RwLock::new(AppConfig::default()));
        let executor = Arc::new(crate::executor::Executor::new(store.clone(), config.clone()));
        let auth = Arc::new(auth::Auth::new());
        let state = ProxyState {
            clients,
            config,
            store,
            self_url: "http://127.0.0.1:41234".to_string(),
            app: None,
            jar,
            executor,
            auth: Some(auth.clone()),
            unread: Arc::new(Mutex::new(0)),
            upgrade: None,
        };
        (state, auth)
    }

    fn request(method: &str, path: &str, headers: &[(&str, &str)]) -> Request {
        let mut builder = Request::builder().method(method).uri(path);
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        builder.body(axum::body::Body::empty()).expect("the test request builds")
    }

    /// The status and machine code of a refusal.
    async fn code_of(resp: Response) -> (u16, String) {
        let (parts, body) = resp.into_parts();
        let bytes = axum::body::to_bytes(body, 1 << 20).await.expect("the body must be readable");
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        (parts.status.as_u16(), json["code"].as_str().unwrap_or_default().to_string())
    }

    #[tokio::test]
    async fn refuses_a_request_that_has_no_proxy_token() {
        let (state, _) = state_with_auth().await;
        let (status, code) = code_of(dispatch(State(state), request("GET", "/", &[])).await).await;
        assert_eq!(status, 401);
        assert_eq!(code, "proxy_unauthorized");
    }

    /// A traversal is refused at the gate, with a machine code, before any
    /// upstream connection is even considered.
    #[tokio::test]
    async fn refuses_a_traversing_path_before_it_can_be_forwarded() {
        let (state, auth) = state_with_auth().await;
        let cookie = format!("{}={}", auth::COOKIE_NAME, auth.token());
        for path in ["/api/../__shell/config", "/api/%2e%2e/x", "/api//x"] {
            let (status, code) = code_of(
                dispatch(State(state.clone()), request("GET", path, &[("cookie", &cookie)])).await,
            )
            .await;
            assert_eq!(status, 400, "{path} must be a client error");
            assert_eq!(code, "invalid_target", "{path}");
        }
    }

    #[tokio::test]
    async fn admits_the_cookie_the_bootstrap_handed_out() {
        let (state, auth) = state_with_auth().await;
        let cookie = format!("{}={}", auth::COOKIE_NAME, auth.token());
        let resp = dispatch(State(state), request("GET", "/", &[("cookie", &cookie)])).await;
        // Unconfigured, the root is the connection page — the point is that the
        // gate let the request through at all.
        assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn admits_a_bearer_token_for_a_native_client() {
        let (state, auth) = state_with_auth().await;
        let bearer = format!("Bearer {}", auth.token());
        let resp = dispatch(State(state), request("GET", "/healthz", &[("authorization", &bearer)])).await;
        assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_cookie_with_the_wrong_token_is_not_admitted() {
        let (state, auth) = state_with_auth().await;
        let cookie = format!("{}={}", auth::COOKIE_NAME, "0".repeat(auth.token().len()));
        let resp = dispatch(State(state), request("GET", "/", &[("cookie", &cookie)])).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn refuses_a_foreign_origin_before_it_looks_at_the_token() {
        let (state, auth) = state_with_auth().await;
        let cookie = format!("{}={}", auth::COOKIE_NAME, auth.token());
        let (status, code) = code_of(
            dispatch(
                State(state),
                request("POST", "/__shell/config", &[("cookie", &cookie), ("origin", "https://evil.example")]),
            )
            .await,
        )
        .await;
        assert_eq!(status, 403);
        assert_eq!(code, "proxy_origin_refused");
    }

    #[tokio::test]
    async fn admits_the_origin_the_window_itself_uses() {
        let (state, auth) = state_with_auth().await;
        let cookie = format!("{}={}", auth::COOKIE_NAME, auth.token());
        let resp = dispatch(
            State(state),
            request("GET", "/", &[("cookie", &cookie), ("origin", "http://127.0.0.1:41234")]),
        )
        .await;
        assert_ne!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn the_bootstrap_route_is_the_one_way_in_without_a_token() {
        let (state, auth) = state_with_auth().await;
        let nonce = auth.new_nonce();
        let resp =
            dispatch(State(state), request("GET", &format!("{BOOTSTRAP_PATH}?nonce={nonce}"), &[])).await;
        assert_eq!(resp.status(), StatusCode::SEE_OTHER);
    }

    /// A stand-in agenthub server: `/healthz`, and an `/api/me` that sets a
    /// session cookie the way a production deployment does.
    async fn spawn_server() -> String {
        use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, SET_COOKIE};
        use axum::routing::get;
        use axum::Json as AxumJson;

        let app = axum::Router::new()
            .route(
                "/healthz",
                get(|| async { ([(CONTENT_TYPE, "application/json")], AxumJson(serde_json::json!({"ok":true}))) }),
            )
            .route(
                "/api/me",
                get(|| async {
                    (
                        [
                            (CONTENT_TYPE, "application/json".to_string()),
                            (CACHE_CONTROL, "no-store".to_string()),
                            (
                                SET_COOKIE,
                                "session=abc; Path=/api; Domain=hub.example.com; Secure; HttpOnly; SameSite=None"
                                    .to_string(),
                            ),
                        ],
                        AxumJson(serde_json::json!({"email":"owner@example.com"})),
                    )
                }),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://127.0.0.1:{port}")
    }

    /// A server that writes one event, waits for the gate, then writes another.
    /// It is deliberately raw TCP: the point is to control exactly when the
    /// bytes hit the wire.
    async fn spawn_gated_stream() -> (String, tokio::sync::oneshot::Sender<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (gate_tx, gate_rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut head = Vec::new();
            let mut byte = [0u8; 1];
            while !head.ends_with(b"\r\n\r\n") {
                if socket.read(&mut byte).await.unwrap_or(0) == 0 {
                    break;
                }
                head.push(byte[0]);
            }
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
            socket.write_all(b"event: first\ndata: one\n\n").await.unwrap();
            socket.flush().await.unwrap();
            // The second half is only written once the test has seen the first.
            let _ = gate_rx.await;
            socket.write_all(b"event: last\ndata: two\n\n").await.unwrap();
            let _ = socket.flush().await;
        });
        (format!("http://127.0.0.1:{port}"), gate_tx)
    }

    #[tokio::test]
    async fn serves_the_connection_page_until_a_server_is_configured() {
        let proxy = proxy_with(AppConfig::default()).await;
        let resp = reqwest::get(format!("{}/", proxy.url)).await.unwrap();
        assert_eq!(resp.status(), 200);
        let body = resp.text().await.unwrap();
        // The Rust copy is injected, so the page has no strings of its own.
        assert!(body.contains("window.__SHELL__"), "the boot object is missing");
        assert!(body.contains("Connect to AgentBuddy"));
    }

    #[tokio::test]
    async fn about_page_version_matches_the_login_stamp() {
        let proxy = proxy_with(AppConfig::default()).await;
        let resp = reqwest::get(format!("{}/__shell/about", proxy.url)).await.unwrap();
        assert_eq!(resp.status(), 200);
        let body = resp.text().await.unwrap();
        // The about page reuses the same stamp the login screen renders.
        let commit = &crate::COMMIT[..crate::COMMIT.len().min(7)];
        let stamp = format!("v{}@{}", crate::VERSION, commit);
        assert!(
            body.contains(&stamp),
            "the about page version should match the login stamp {stamp}"
        );
    }

    #[tokio::test]
    async fn refuses_api_calls_while_unconfigured() {
        let proxy = proxy_with(AppConfig::default()).await;
        let resp = reqwest::get(format!("{}/api/resources", proxy.url)).await.unwrap();
        assert_eq!(resp.status(), 503);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["code"], "server_not_configured");
    }

    #[tokio::test]
    async fn forwards_to_the_server_and_rewrites_the_session_cookie() {
        let server = spawn_server().await;
        let proxy = proxy_with(AppConfig { server_url: server.clone(), ..Default::default() }).await;

        let client = reqwest::Client::new();
        let resp = client.get(format!("{}/api/me", proxy.url)).send().await.unwrap();
        assert_eq!(resp.status(), 200);
        let cookies: Vec<String> = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .map(|value| value.to_str().unwrap().to_string())
            .collect();
        assert_eq!(cookies, vec!["session=abc; HttpOnly; SameSite=Lax; Path=/".to_string()]);
        // The header that would stop the WebView from storing it is gone.
        assert!(!cookies[0].to_lowercase().contains("secure"));
        assert!(!cookies[0].to_lowercase().contains("domain"));

        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["email"], "owner@example.com");
    }

    #[tokio::test]
    async fn streams_server_sent_events_without_buffering() {
        let (server, gate) = spawn_gated_stream().await;
        let proxy = proxy_with(AppConfig { server_url: server, ..Default::default() }).await;

        let client = reqwest::Client::new();
        let mut resp =
            client.get(format!("{}/api/tasks/1/events", proxy.url)).send().await.unwrap();
        assert_eq!(resp.status(), 200);
        assert!(resp.headers().get("content-length").is_none(), "a stream must not declare a length");
        assert_eq!(
            resp.headers().get("content-type").unwrap().to_str().unwrap(),
            "text/event-stream"
        );

        // The server is holding the second event back until we release it. If
        // the proxy buffered the body, this read would not return at all.
        let first = tokio::time::timeout(std::time::Duration::from_secs(5), resp.chunk())
            .await
            .expect("the proxy buffered the stream instead of forwarding it")
            .unwrap()
            .expect("the stream ended before the first event");
        assert_eq!(String::from_utf8_lossy(&first), "event: first\ndata: one\n\n");

        let _ = gate.send(());
        let second = tokio::time::timeout(std::time::Duration::from_secs(5), resp.chunk())
            .await
            .expect("the stream stopped after the first event")
            .unwrap()
            .expect("the stream ended before the last event");
        assert_eq!(String::from_utf8_lossy(&second), "event: last\ndata: two\n\n");
    }

    #[tokio::test]
    async fn falls_back_to_the_console_for_a_client_route() {
        // The console bundle is a build artefact; where it is not built the
        // shell says so instead, which is the other half of this behaviour.
        if static_files::Console::get("index.html").is_none() {
            eprintln!("skipping: web/dist has not been built");
            return;
        }
        let proxy = proxy_with(AppConfig { server_url: "http://127.0.0.1:1".into(), ..Default::default() })
            .await;
        let resp = reqwest::get(format!("{}/trace", proxy.url)).await.unwrap();
        assert_eq!(resp.status(), 200);
        let body = resp.text().await.unwrap();
        assert!(body.contains("<div id=\"app\""), "the console shell did not come back");
        // The route hands the shell config to the page it serves: without the
        // seed the workbench would forget the chosen language and theme at every
        // launch, because the proxy's port (and so the page's origin) is new.
        assert!(
            body.contains("agentbuddy.theme"),
            "the console shell was not seeded with the saved preferences"
        );
    }

    #[tokio::test]
    async fn saves_the_connection_and_hands_it_back() {
        let server = spawn_server().await;
        let dir = std::env::temp_dir().join(format!("agentbuddy-save-{}", port_stamp()));
        let store = Arc::new(ConfigStore::new(dir));
        let proxy = start_inner(
            Arc::new(tokio::sync::RwLock::new(AppConfig::default())),
            store.clone(),
            None,
        )
        .await
        .unwrap();
        let client = reqwest::Client::new();

        let saved: serde_json::Value = client
            .post(format!("{}/__shell/config", proxy.url))
            .json(&serde_json::json!({ "server_url": format!("{server}/"), "lang": "zh-TW", "background": true, "notify_enabled": true, "notify_quiet_minutes": 15 }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(saved["ok"], true);
        assert_eq!(store.load().server_url, server, "the trailing slash is dropped once");
        assert_eq!(store.load().lang(), "zh-TW");
        assert!(store.load().background);
        assert!(store.load().notify_enabled);
        assert_eq!(store.load().notify_quiet_minutes, 15);

        let probe: serde_json::Value = client
            .post(format!("{}/__shell/test", proxy.url))
            .json(&serde_json::json!({ "server_url": server }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(probe["ok"], true, "the server answers /healthz");

        let bad: serde_json::Value = client
            .post(format!("{}/__shell/test", proxy.url))
            .json(&serde_json::json!({ "server_url": "hub.example.com" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(bad["ok"], false);
        assert_eq!(bad["reason"], "invalid");
    }

    #[tokio::test]
    async fn rejects_a_notification_when_disabled() {
        // Notifications are on by default, so the test has to turn them off: a
        // default config would take the `no_app` branch instead.
        let proxy = proxy_with(AppConfig { notify_enabled: false, ..AppConfig::default() }).await;
        let client = reqwest::Client::new();
        let resp: serde_json::Value = client
            .post(format!("{}/__shell/notify", proxy.url))
            .json(&serde_json::json!({ "title": "Done", "body": "Task complete" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["reason"], "disabled");
    }

    #[tokio::test]
    async fn clamps_quiet_minutes_to_a_sane_ceiling() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-quiet-{}", port_stamp()));
        let store = Arc::new(ConfigStore::new(dir.clone()));
        let proxy = start_inner(
            Arc::new(tokio::sync::RwLock::new(AppConfig::default())),
            store.clone(),
            None,
        )
        .await
        .unwrap();
        let client = reqwest::Client::new();
        let saved: serde_json::Value = client
            .post(format!("{}/__shell/config", proxy.url))
            .json(&serde_json::json!({ "notify_quiet_minutes": 5000 }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(saved["ok"], true);
        // The stored preference is capped so a stray large value stays meaningful.
        assert_eq!(store.load().notify_quiet_minutes, 1440);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn connection_test_rejects_an_empty_url() {
        let proxy = proxy_with(AppConfig::default()).await;
        let client = reqwest::Client::new();
        let resp: serde_json::Value = client
            .post(format!("{}/__shell/test", proxy.url))
            .json(&serde_json::json!({ "server_url": "" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["reason"], "empty");
    }

    /// A stand-in agenthub that issues a session cookie on `/api/login` and
    /// reports on `/api/ping` the `Cookie` header it actually received — which is
    /// how the test proves the proxy's jar carried the session upstream.
    async fn spawn_session_server() -> (String, Arc<std::sync::Mutex<Option<String>>>) {
        use axum::http::header::{COOKIE, SET_COOKIE};
        use axum::routing::get;

        let seen = Arc::new(std::sync::Mutex::new(None));
        let seen_for_ping = seen.clone();
        let app = axum::Router::new()
            .route(
                "/api/login",
                get(|| async {
                    ([(SET_COOKIE, "sid=ABC; Path=/; HttpOnly".to_string())], "ok")
                }),
            )
            .route(
                "/api/ping",
                get(move |headers: axum::http::HeaderMap| async move {
                    let cookie = headers
                        .get(COOKIE)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    *seen_for_ping.lock().unwrap() = Some(cookie.clone());
                    cookie
                }),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://127.0.0.1:{port}"), seen)
    }

    /// The desktop shell must keep the user signed in across an app restart.
    /// `start_inner` is what runs on every launch, so two successive launches
    /// that share one on-disk store must carry the same session cookie upstream.
    #[tokio::test]
    async fn resumes_the_session_after_a_restart() {
        let (server, seen) = spawn_session_server().await;
        let dir = std::env::temp_dir().join(format!("agentbuddy-session-{}", port_stamp()));
        let store = Arc::new(ConfigStore::new(dir.clone()));
        let config = || Arc::new(tokio::sync::RwLock::new(AppConfig {
            server_url: server.clone(),
            ..Default::default()
        }));

        // First launch: log in (sets the cookie) and let it persist to disk.
        let proxy1 = start_inner(config(), store.clone(), None).await.unwrap();
        let client = reqwest::Client::new();
        let first = client
            .get(format!("{}/api/login", proxy1.url))
            .send()
            .await
            .unwrap();
        assert!(first.status().is_success());
        // The persistence write is offloaded to a detached thread; give it a beat.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // Second launch, same store — like the user quitting and reopening the app.
        let proxy2 = start_inner(config(), store.clone(), None).await.unwrap();
        let echoed = client
            .get(format!("{}/api/ping", proxy2.url))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(echoed, "sid=ABC", "the session cookie must survive a restart");

        // And the persisted file must not replay a cookie to a different server.
        let other = seen.clone();
        assert!(store.load_session_cookie(&server).is_some());
        assert!(store.load_session_cookie("https://elsewhere.example.com").is_none());
        drop(other);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A proxy with admission control, served from a real port.
    ///
    /// `start_inner` can only build the gate when a window exists, so this
    /// assembles the same state and serves it with `axum::serve`: the test then
    /// drives the handshake with a real HTTP client instead of calling
    /// `dispatch` directly, which is the only way to prove the cookie actually
    /// survives a socket.
    async fn spawn_gated_proxy(config: AppConfig) -> (String, Arc<auth::Auth>) {
        let dir = std::env::temp_dir().join(format!("agentbuddy-gated-{}", port_stamp()));
        let store = Arc::new(ConfigStore::new(dir));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let url = format!("http://127.0.0.1:{port}");

        let jar = Arc::new(reqwest::cookie::Jar::default());
        let clients = forward::Clients::new(jar.clone()).expect("the forwarding client builds");
        let config = Arc::new(tokio::sync::RwLock::new(config));
        let executor = Arc::new(crate::executor::Executor::new(store.clone(), config.clone()));
        let gate = Arc::new(auth::Auth::new());
        let state = ProxyState {
            clients,
            config,
            store: store.clone(),
            self_url: url.clone(),
            app: None,
            jar,
            executor,
            auth: Some(gate.clone()),
            unread: Arc::new(Mutex::new(0)),
            upgrade: None,
        };
        let router = Router::new().fallback(dispatch).with_state(state);
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        (url, gate)
    }

    /// Bounds every step so a broken proxy fails the test instead of parking it.
    async fn within(
        label: &str,
        fut: impl std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
    ) -> reqwest::Response {
        tokio::time::timeout(std::time::Duration::from_secs(5), fut)
            .await
            .unwrap_or_else(|_| panic!("{label} did not answer in time"))
            .unwrap_or_else(|err| panic!("{label} failed: {err}"))
    }

    /// The whole shell session over real sockets, in one flow:
    /// no token → bootstrap → cookie → forwarded API call → shell notify →
    /// foreign origin. Each step is covered on its own above; together they are
    /// what catches "wired up but never reachable".
    #[tokio::test]
    async fn a_whole_shell_session_over_real_sockets() {
        use axum::http::header::{COOKIE, LOCATION, ORIGIN, SET_COOKIE};

        let server = spawn_server().await;
        let (url, gate) =
            spawn_gated_proxy(AppConfig { server_url: server, ..AppConfig::default() }).await;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();

        // 1. No token: refused before the upstream is ever contacted.
        let denied = within("no-token request", client.get(format!("{url}/api/me")).send()).await;
        assert_eq!(denied.status(), 401);
        let body: serde_json::Value = denied.json().await.unwrap();
        assert_eq!(body["code"], "proxy_unauthorized");

        // 2. The URL the window opens: a single-use nonce becomes the cookie.
        let nonce = gate.new_nonce();
        let boot = within(
            "bootstrap",
            client.get(format!("{url}{BOOTSTRAP_PATH}?nonce={nonce}")).send(),
        )
        .await;
        assert_eq!(boot.status(), 303);
        assert_eq!(boot.headers().get(LOCATION).unwrap().to_str().unwrap(), "/");
        let set_cookie = boot.headers().get(SET_COOKIE).unwrap().to_str().unwrap().to_string();
        assert!(set_cookie.contains("HttpOnly"), "the script must not read the token");
        // What a browser keeps and sends back on every later request.
        let cookie = set_cookie.split(';').next().unwrap().to_string();
        assert!(cookie.starts_with(&format!("{}=", auth::COOKIE_NAME)));

        // 3. With the cookie, a real upstream call goes through and the server's
        //    session cookie is rewritten for the loopback origin.
        let forwarded = within(
            "forwarded request",
            client.get(format!("{url}/api/me")).header(COOKIE, &cookie).send(),
        )
        .await;
        assert_eq!(forwarded.status(), 200);
        let cookies: Vec<String> = forwarded
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .map(|value| value.to_str().unwrap().to_string())
            .collect();
        assert_eq!(cookies, vec!["session=abc; HttpOnly; SameSite=Lax; Path=/".to_string()]);
        let who: serde_json::Value = forwarded.json().await.unwrap();
        assert_eq!(who["email"], "owner@example.com");

        // 4. The shell's own endpoint answers with a machine code — a headless
        //    process has nothing to raise a toast on, and the workbench treats a
        //    refusal as normal, not as an error.
        let notified = within(
            "shell notify",
            client
                .post(format!("{url}/__shell/notify"))
                .header(COOKIE, &cookie)
                .json(&serde_json::json!({ "title": "Task finished", "body": "all green", "link": "/threads/1" }))
                .send(),
        )
        .await;
        assert_eq!(notified.status(), 200);
        let answer: serde_json::Value = notified.json().await.unwrap();
        assert_eq!(answer["ok"], false);
        assert_eq!(answer["reason"], "no_app");

        // 5. A page on another site is refused even holding a valid cookie.
        let foreign = within(
            "foreign origin",
            client
                .get(format!("{url}/api/me"))
                .header(COOKIE, &cookie)
                .header(ORIGIN, "https://evil.example")
                .send(),
        )
        .await;
        assert_eq!(foreign.status(), 403);
        let body: serde_json::Value = foreign.json().await.unwrap();
        assert_eq!(body["code"], "proxy_origin_refused");
    }
}
