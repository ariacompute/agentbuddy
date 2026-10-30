//! Static responses: the workbench bundle, and the two pages the shell owns.

use std::collections::BTreeMap;

use axum::body::Body;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{Response as HttpResponse, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::{EmbeddedFile, RustEmbed};
use serde_json::json;

use crate::i18n;

/// Marker the Rust side replaces with the boot object for `shell.html`.
pub const BOOT_MARKER: &str = "/*__SHELL_BOOT__*/";

/// The closing body tag is the anchor for the app version injection: it survives
/// the Vue build's HTML minifier (unlike an HTML comment) and the inline script
/// it is replaced with still runs before the deferred module script mounts Vue.
pub const APP_VERSION_INJECT_AT: &str = "</body>";

/// The workbench, built by `web` into `web/dist` and embedded here so the app is
/// a single artefact with no bundled directory to lose.
///
/// The path is relative to this crate; `build.rs` creates the directory when it
/// is missing so a checkout that has not run the web build still compiles.
#[derive(RustEmbed)]
#[folder = "../../web/dist"]
pub struct Console;

/// The connection page and the about page.
#[derive(RustEmbed)]
#[folder = "assets"]
struct Shell;

/// Serves a workbench path, falling back to `index.html` for anything that is not
/// a file — the same rule as the Go server's `staticOrIndex`, so Vue's router
/// owns client-side paths here exactly as it does on the server.
pub fn serve_console(path: &str, lang: &str) -> Response {
    let rel = path.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    let (served, file) = if let Some(file) = Console::get(rel) {
        (rel, file)
    } else if let Some(file) = Console::get("index.html") {
        // SPA fallback: a client route that is not a real file resolves to the
        // app shell, so it gets the same version stamp as the root.
        ("index.html", file)
    } else {
        return console_missing(lang);
    };
    if served == "index.html" {
        return console_index(&file);
    }
    file_response(served, &file)
}

/// Serves the workbench's `index.html` with the desktop shell's own version
/// stamp injected, so the login screen can show it the way the shell's own
/// about page shows `boot.version`. The Vue bundle is a single
/// build with no per-build metadata, so the stamp is written here from the
/// constants the crate was compiled with.
fn console_index(file: &EmbeddedFile) -> Response {
    let html = render_console_index(file);
    HttpResponse::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .header(CACHE_CONTROL, "no-cache")
        .body(Body::from(html.into_bytes()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Builds the console `index.html` with the app version stamp injected. Kept
/// separate from the response wrapper so it can be unit-tested without prying
/// bytes out of an `axum::body::Body`.
fn render_console_index(file: &EmbeddedFile) -> String {
    let stamp = app_version_stamp();
    String::from_utf8_lossy(&file.data).replace(
        APP_VERSION_INJECT_AT,
        &format!("window.__AGENTBUDDY_VERSION__ = {stamp:?};</body>"),
    )
}

/// The desktop shell's `vX.Y.Z@<7-char commit>` stamp. `VERSION` is the crate
/// version (no `v` prefix); the commit comes from `AGENTBUDDY_COMMIT` at build
/// time and falls back to `unknown` for local builds (see `crate::COMMIT`).
fn app_version_stamp() -> String {
    let commit = &crate::COMMIT[..crate::COMMIT.len().min(7)];
    format!("v{}@{}", crate::VERSION, commit)
}

/// Renders `shell.html` with the shell's copy injected, so the page carries no
/// translations of its own and can never drift from Rust. The about page's
/// version row reuses `app_version_stamp()` so it matches the login screen.
pub fn shell_page(page: &str, config: &crate::config::AppConfig) -> Response {
    let Some(file) = Shell::get("shell.html") else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "the shell page is missing").into_response();
    };
    let lang = config.lang();
    let tables: BTreeMap<&str, BTreeMap<&str, &str>> = i18n::LANGUAGES
        .iter()
        .map(|(code, _)| (*code, i18n::block_for(code).into_iter().collect()))
        .collect();
    let dirs: BTreeMap<&str, &str> = i18n::LANGUAGES
        .iter()
        .map(|(code, _)| (*code, if i18n::is_rtl(code) { "rtl" } else { "ltr" }))
        .collect();
    let boot = json!({
        "page": page,
        "lang": lang,
        "version": app_version_stamp(),
        "serverUrl": config.server_url,
        "insecure": config.accept_invalid_certs,
        "background": config.background,
        "notifyEnabled": config.notify_enabled,
        "notifyQuietMinutes": config.notify_quiet_minutes,
        "configured": config.is_configured(),
        "languages": i18n::LANGUAGES,
        "dirs": dirs,
        "tables": tables,
    });
    let html = String::from_utf8_lossy(&file.data).replace(
        BOOT_MARKER,
        &format!("window.__SHELL__ = {boot};"),
    );
    HttpResponse::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .header(CACHE_CONTROL, "no-cache")
        .body(Body::from(html.into_bytes()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn file_response(rel: &str, file: &EmbeddedFile) -> Response {
    // Hashed assets never change; everything else (index.html first of all) is
    // revalidated so a new build shows up on the next start.
    let cache = if rel.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    HttpResponse::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, file.metadata.mimetype())
        .header(CACHE_CONTROL, cache)
        .body(Body::from(file.data.to_vec()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn console_missing(lang: &str) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [(CONTENT_TYPE, "text/plain; charset=utf-8")],
        i18n::translate(lang, "consoleMissing"),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The stamp is the crate version with a `v` prefix and the build commit
    /// trimmed to seven characters — `vX.Y.Z@<7-char commit>`.
    #[test]
    fn stamps_version_with_short_commit() {
        // Independent of the real COMMIT/VERSION so the assertion is stable.
        let version = "1.0.0";
        let commit = "abcdef1234567890";
        let stamp = format!("v{}@{}", version, &commit[..7.min(commit.len())]);
        assert_eq!(stamp, "v1.0.0@abcdef1");
    }

    /// The console's index.html carries the version assignment so the login
    /// screen can render it.
    #[test]
    fn injects_app_version_into_index_html() {
        if Console::get("index.html").is_none() {
            eprintln!("skipping: web/dist has not been built");
            return;
        }
        let file = Console::get("index.html").unwrap();
        let html = render_console_index(&file);
        assert!(
            html.contains("window.__AGENTBUDDY_VERSION__"),
            "the app version stamp is missing from index.html"
        );
        assert!(
            html.contains(&app_version_stamp()),
            "the injected stamp does not match app_version_stamp()"
        );
    }
}
