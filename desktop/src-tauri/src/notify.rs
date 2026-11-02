//! The notification bridge: `POST /__shell/notify`.
//!
//! The webview never asks Tauri for anything directly — it talks to the loopback
//! proxy, which is the only thing the window may reach. So a notification request
//! is just a same-origin HTTP call the Rust side answers by handing the title and
//! body to `tauri-plugin-notification`.
//!
//! The webview already decides *whether* a notification is worth showing
//! (idempotency, quiet window, digest), so this side only enforces the one
//! building-level switch the user can flip: `notify_enabled`. A missing OS
//! permission comes back as `denied` and the webview silently falls back to the
//! in-app red dot.
//!
//! The payload's `link` is an in-app path (`/threads/42`). Clicking the toast
//! should land on that page rather than merely raise the window, so the path is
//! parked here and replayed as a hash assignment on the click — the workbench is
//! a hash-agnostic SPA behind a loopback origin, so `window.location.hash` is the
//! one navigation channel that needs no new IPC surface.

use std::sync::{Mutex, OnceLock};

use axum::extract::Request;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

use crate::proxy::ProxyState;

#[derive(Debug, Default, Deserialize)]
struct NotifyPayload {
    title: Option<String>,
    body: Option<String>,
    link: Option<String>,
}

/// The path the next clicked toast should open. One slot, last write wins: the
/// workbench already de-duplicates what it announces, and a click always refers
/// to the most recent toast.
fn pending_link() -> &'static Mutex<Option<String>> {
    static SLOT: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// Whether `link` is a path inside this workbench rather than somewhere else.
///
/// Only a single leading slash is accepted: `//host/x` is protocol-relative and
/// would navigate off-origin, `javascript:` / `data:` are not paths at all, and
/// backslashes plus control characters (including the JS line separators) are
/// rejected because the value ends up inside an `eval` string.
pub fn is_in_app_path(link: &str) -> bool {
    if !link.starts_with('/') || link.starts_with("//") {
        return false;
    }
    !link
        .chars()
        .any(|c| c == '\\' || c.is_control() || c == '\u{2028}' || c == '\u{2029}')
}

/// Parks `link` for the next toast click. Returns whether it was acceptable, so
/// the caller can log a rejection without guessing.
pub fn remember_link(link: &str) -> bool {
    if !is_in_app_path(link) {
        return false;
    }
    match pending_link().lock() {
        Ok(mut slot) => {
            *slot = Some(link.to_string());
            true
        }
        Err(_) => false,
    }
}

/// Takes the parked path, leaving the slot empty — a click navigates once, and a
/// second click on the same toast must not replay the first one's target.
pub fn take_link() -> Option<String> {
    pending_link().lock().ok().and_then(|mut slot| slot.take())
}

/// The JS statement that moves the workbench to `link`, or `None` when the path
/// is not one we are willing to put in a script. The path is JSON-encoded (a
/// quoted, escaped literal is valid JavaScript) instead of being spliced in raw.
pub fn hash_expr(link: &str) -> Option<String> {
    if !is_in_app_path(link) {
        return None;
    }
    let literal = serde_json::to_string(&format!("#{link}")).ok()?;
    Some(format!("window.location.hash = {literal};"))
}

/// Teaches the notification plugin what a click means. Called once from setup,
/// after the plugin is initialised: notifications shown before a handler exists
/// report nothing, which is why this is wiring rather than a per-toast concern.
pub fn install(app: &tauri::AppHandle) {
    let handle = app.clone();
    let registered = app.notification().on_action(move |action| {
        // `tap` is the platform's name for a click on the notification body; the
        // explicit buttons this app never adds report their own ids.
        if action.action_id() != "tap" {
            return;
        }
        let Some(link) = take_link() else { return };
        let Some(expr) = hash_expr(&link) else { return };
        if let Some(window) = handle.get_webview_window("main") {
            // A parked window is hidden, and on some platforms also minimised:
            // restore it before showing, so the navigation is actually visible.
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.eval(&expr);
        }
    });
    if let Err(err) = registered {
        eprintln!("agentbuddy desktop: notification actions unavailable: {err}");
    }
}

pub async fn handle(state: &ProxyState, req: Request) -> Response {
    let payload = match axum::body::to_bytes(req.into_body(), 64 * 1024).await {
        // A body that does not parse is the webview's bug, not the user's: it is
        // the only case that answers with an HTTP error, so the caller notices.
        Ok(bytes) => match serde_json::from_slice::<NotifyPayload>(&bytes) {
            Ok(payload) => payload,
            Err(_) => return invalid("invalid_json"),
        },
        Err(_) => return invalid("invalid_json"),
    };

    let title = payload.title.filter(|t| !t.trim().is_empty());
    let body = payload.body.filter(|b| !b.trim().is_empty());
    let (Some(title), Some(body)) = (title, body) else {
        // An empty title or body is a normal "nothing to say" case: the webview
        // silently drops it, so it is reported as a refusal, not an error.
        return denied("missing_fields");
    };

    // The building-level master switch: when it is off, never disturb the user.
    // Checked before the app handle so a headless proxy still answers correctly.
    if !state.config.read().await.notify_enabled {
        return denied("disabled");
    }

    let Some(app) = &state.app else {
        return denied("no_app");
    };

    // Park the target before showing: a toast can be clicked the instant it
    // appears, and the click handler runs on the plugin's own thread. A link we
    // refuse to replay is dropped rather than failing the notification — the
    // toast is still worth showing. Either way the slot is cleared first, so a
    // click on a toast with no usable target focuses the window instead of
    // replaying an older toast's page.
    let parked = match payload.link.as_deref() {
        Some(link) => remember_link(link),
        None => false,
    };
    if !parked {
        let _ = take_link();
    }

    match app.notification().builder().title(&title).body(&body).show() {
        Ok(()) => (StatusCode::OK, axum::Json(json!({ "ok": true }))).into_response(),
        Err(err) => {
            // A denied OS permission is expected and benign: the webview keeps its
            // own red dot. Anything else is logged but reported the same way.
            eprintln!("agentbuddy desktop: notification failed: {err}");
            // Nothing will be clicked, so do not leave a stale target behind for
            // the next toast to inherit.
            if parked {
                let _ = take_link();
            }
            denied("denied")
        }
    }
}

fn invalid(reason: &str) -> Response {
    (StatusCode::BAD_REQUEST, axum::Json(json!({ "ok": false, "reason": reason }))).into_response()
}

fn denied(reason: &str) -> Response {
    (StatusCode::OK, axum::Json(json!({ "ok": false, "reason": reason }))).into_response()
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

    /// A headless proxy: no window (`app: None`), the only shape the unit tests
    /// can build. It still has to answer every branch correctly.
    async fn state_with(notify_enabled: bool) -> ProxyState {
        let dir = std::env::temp_dir().join(format!("agentbuddy-notify-{}", std::process::id()));
        let store = Arc::new(ConfigStore::new(dir));
        let jar = Arc::new(reqwest::cookie::Jar::default());
        let clients = forward::Clients::new(jar.clone()).expect("the forwarding client builds");
        let config = Arc::new(RwLock::new(AppConfig { notify_enabled, ..Default::default() }));
        let executor = Arc::new(crate::executor::Executor::new(store.clone(), config.clone()));
        ProxyState {
            clients,
            config,
            store,
            self_url: "http://127.0.0.1:0".to_string(),
            app: None,
            jar,
            executor,
            auth: None,
        }
    }

    fn post(body: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/__shell/notify")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    async fn decode(resp: Response) -> (StatusCode, serde_json::Value) {
        let (parts, body) = resp.into_parts();
        let bytes = to_bytes(body, 1 << 20).await.unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (parts.status, json)
    }

    #[tokio::test]
    async fn rejects_malformed_json() {
        let state = state_with(true).await;
        let (status, json) = decode(handle(&state, post("{not json")).await).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["ok"], false);
        assert_eq!(json["reason"], "invalid_json");
    }

    #[tokio::test]
    async fn rejects_a_payload_without_a_title_and_body() {
        let state = state_with(true).await;
        for body in ["{}", r#"{"title":"","body":"x"}"#, r#"{"title":"x","body":"   "}"#] {
            let (status, json) = decode(handle(&state, post(body)).await).await;
            assert_eq!(status, StatusCode::OK, "payload `{body}` must be rejected as missing_fields");
            assert_eq!(json["ok"], false);
            assert_eq!(json["reason"], "missing_fields");
        }
    }

    #[tokio::test]
    async fn denies_when_notifications_are_disabled() {
        let state = state_with(false).await;
        let (status, json) = decode(handle(&state, post(r#"{"title":"Done","body":"Task complete"}"#)).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["ok"], false);
        assert_eq!(json["reason"], "disabled");
    }

    #[tokio::test]
    async fn denies_without_an_app_handle() {
        // A headless proxy has nothing to surface a notification on, but must
        // still answer rather than panic.
        let state = state_with(true).await;
        let (status, json) = decode(handle(&state, post(r#"{"title":"Done","body":"Task complete"}"#)).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["ok"], false);
        assert_eq!(json["reason"], "no_app");
    }

    // The link slot is process-global, so the cases that touch it live in one
    // test: Rust runs them on separate threads and interleaving would be flaky.
    #[test]
    fn parks_an_in_app_path_and_drops_everything_else() {
        let _ = take_link();

        for bad in [
            "",                                  // nothing to navigate to
            "threads/42",                        // relative, not rooted
            "//evil.example/x",                  // protocol-relative
            "https://evil.example/x",            // absolute
            "javascript:alert(1)",               // not a path at all
            "/a\\b",                             // backslash escapes in some parsers
            "/a\u{0}b",                          // control character
            "/a\u{2028}b",                       // JS line separator
        ] {
            assert!(!remember_link(bad), "`{bad}` must be refused");
            assert!(hash_expr(bad).is_none(), "`{bad}` must not become a script");
        }
        assert!(take_link().is_none(), "a refused link must not be stored");

        assert!(remember_link("/threads/42"));
        // Last write wins: the newest toast is the one that can still be clicked.
        assert!(remember_link("/tasks/7"));
        assert_eq!(take_link().as_deref(), Some("/tasks/7"));
        // Taking is destructive, so a second click cannot replay it.
        assert!(take_link().is_none());
    }

    #[test]
    fn builds_a_hash_expression_that_cannot_break_out_of_its_string() {
        assert_eq!(
            hash_expr("/threads/42").as_deref(),
            Some(r##"window.location.hash = "#/threads/42";"##),
        );
        // A quote in the path is escaped, so the statement still parses.
        let quoted = hash_expr("/x\";location=/evil").expect("an in-app path is still allowed");
        assert!(quoted.contains("\\\""));
        assert!(quoted.starts_with("window.location.hash = \""));
    }
}
