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
}
