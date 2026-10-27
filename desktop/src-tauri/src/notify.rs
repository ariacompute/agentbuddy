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

use axum::extract::Request;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use tauri_plugin_notification::NotificationExt;

use crate::proxy::ProxyState;

#[derive(Debug, Default, Deserialize)]
struct NotifyPayload {
    title: Option<String>,
    body: Option<String>,
    #[allow(dead_code)]
    link: Option<String>,
}

pub async fn handle(state: &ProxyState, req: Request) -> Response {
    let payload = match axum::body::to_bytes(req.into_body(), 64 * 1024).await {
        Ok(bytes) => serde_json::from_slice::<NotifyPayload>(&bytes).unwrap_or_default(),
        Err(_) => return invalid("invalid_json"),
    };

    let title = payload.title.filter(|t| !t.trim().is_empty());
    let body = payload.body.filter(|b| !b.trim().is_empty());
    let (Some(title), Some(body)) = (title, body) else {
        return invalid("missing_fields");
    };

    // The building-level master switch: when it is off, never disturb the user.
    // Checked before the app handle so a headless proxy still answers correctly.
    if !state.config.read().await.notify_enabled {
        return denied("disabled");
    }

    let Some(app) = &state.app else {
        return denied("no_app");
    };

    match app.notification().builder().title(&title).body(&body).show() {
        Ok(()) => (StatusCode::OK, axum::Json(json!({ "ok": true }))).into_response(),
        Err(err) => {
            // A denied OS permission is expected and benign: the webview keeps its
            // own red dot. Anything else is logged but reported the same way.
            eprintln!("agentbuddy desktop: notification failed: {err}");
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
