//! Static responses: the workbench bundle, and the two pages the shell owns.

use std::collections::BTreeMap;

use axum::body::Body;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS};
use axum::http::{Response as HttpResponse, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::{EmbeddedFile, RustEmbed};
use serde_json::json;

use crate::i18n;
use crate::proxy::csp;

/// Marker the Rust side replaces with the boot object for `shell.html`.
pub const BOOT_MARKER: &str = "/*__SHELL_BOOT__*/";

/// The closing body tag is the anchor for the app version injection: it survives
/// the Vue build's HTML minifier (unlike an HTML comment) and the inline script
/// it is replaced with still runs before the deferred module script mounts Vue.
pub const APP_VERSION_INJECT_AT: &str = "</body>";

/// The first element of the workbench's own `index.html`, and the anchor for the
/// saved preferences. They have to be planted before `theme-init.js` — the very
/// first `<script>` in that head — reads the theme, so this is the only place
/// that is both stable across builds and early enough.
pub const PREFS_INJECT_AT: &str = "<head>";

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
///
/// It takes the whole config because the app shell it serves is seeded with the
/// saved language and theme; the plain-text fallback only needs the language.
pub fn serve_console(path: &str, config: &crate::config::AppConfig) -> Response {
    let rel = path.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    let (served, file) = if let Some(file) = Console::get(rel) {
        (rel, file)
    } else if is_asset(rel) {
        // A missing *file* must not be answered with the app shell: the browser
        // would get HTML where it asked for a script or a stylesheet, and report
        // a MIME error instead of the 404 that actually happened.
        return (
            StatusCode::NOT_FOUND,
            [(CONTENT_TYPE, "text/plain; charset=utf-8")],
            "not found",
        )
            .into_response();
    } else if let Some(file) = Console::get("index.html") {
        // SPA fallback: a client route that is not a real file resolves to the
        // app shell, so it gets the same version stamp as the root.
        ("index.html", file)
    } else {
        return console_missing(config.lang());
    };
    if served == "index.html" {
        return console_index(&file, config);
    }
    file_response(served, &file)
}

/// True when a path names a file rather than a client route. A route segment
/// may contain dots in principle, but the console's own routes never do and a
/// missing asset is the far more likely case.
fn is_asset(rel: &str) -> bool {
    rel.rsplit('/').next().map(|name| name.contains('.')).unwrap_or(false)
}

/// Serves the workbench's `index.html` with the shell's own injections: the
/// saved language and theme at the top of `<head>`, and the version stamp at the
/// end, so the login screen can show it the way the shell's own about page shows
/// `boot.version`. The Vue bundle is a single build with no per-build metadata,
/// so the stamp is written here from the constants the crate was compiled with.
fn console_index(file: &EmbeddedFile, config: &crate::config::AppConfig) -> Response {
    let nonce = csp::new_nonce();
    let html = render_console_index(file, config, &nonce);
    let (name, value) = csp::header(&nonce);
    HttpResponse::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .header(CACHE_CONTROL, "no-cache")
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(name, value)
        .body(Body::from(html.into_bytes()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Builds the console `index.html` with two injections: the saved preferences at
/// the top of `<head>`, and the app version stamp at the end of `<body>`. Kept
/// separate from the response wrapper so it can be unit-tested without prying
/// bytes out of an `axum::body::Body`.
///
/// Both are inline scripts, so both carry the response's nonce and `script-src`
/// can stay `'self'`.
fn render_console_index(
    file: &EmbeddedFile,
    config: &crate::config::AppConfig,
    nonce: &str,
) -> String {
    let stamp = app_version_stamp();
    let seed = prefs_seed_script(config, nonce);
    // `replacen(.., 1)`: a `<head>` inside a comment, or a future `<header>`,
    // must not attract the injection.
    String::from_utf8_lossy(&file.data)
        .replacen(PREFS_INJECT_AT, &format!("{}{seed}", PREFS_INJECT_AT), 1)
        // Wrapped in a <script> so the browser executes the assignment (setting
        // the global the login view reads) instead of rendering it as visible text.
        .replace(
            APP_VERSION_INJECT_AT,
            &format!(
                "<script nonce=\"{nonce}\">window.__AGENTBUDDY_VERSION__ = {stamp:?};</script></body>"
            ),
        )
}

/// Plants the shell's saved language and theme in the page's own storage before
/// the page reads it.
///
/// The window is served from `http://127.0.0.1:<port>` and the OS picks a fresh
/// port on every start, so the origin — and with it `localStorage` — is empty at
/// every launch. Without this the workbench comes back on the system language
/// and the light theme no matter what was chosen, which is indistinguishable
/// from "the setting was never saved". Both values come from closed sets
/// (`AppConfig::lang` and `AppConfig::theme` return `&'static str`), so `{:?}`
/// cannot smuggle a quote or a `</script>` out of a hand-edited config.
///
/// Existing values win: a reload inside one run keeps what the page has just
/// written, and only a fresh origin (every launch) is seeded. A page without
/// storage (a WebView with cookies blocked) skips the whole block.
fn prefs_seed_script(config: &crate::config::AppConfig, nonce: &str) -> String {
    let lang = config.lang();
    let theme = config.theme();
    format!(
        "<script nonce=\"{nonce}\">(function(){{try{{var s=window.localStorage;\
         if(!s.getItem('agentbuddy.lang'))s.setItem('agentbuddy.lang',{lang:?});\
         if(!s.getItem('agentbuddy.theme'))s.setItem('agentbuddy.theme',{theme:?});\
         }}catch(e){{}}}})();</script>"
    )
}

/// The desktop shell's `vX.Y.Z@<7-char commit>` stamp. `VERSION` is the build
/// version derived from the latest git tag (no `v` prefix; see `crate::VERSION`);
/// the commit comes from `AGENTBUDDY_COMMIT` at build time and falls back to
/// `unknown` for local builds (see `crate::COMMIT`).
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
    let nonce = csp::new_nonce();
    let html = render_shell_page(&file, config, page, &nonce);
    let (name, value) = csp::header(&nonce);
    HttpResponse::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .header(CACHE_CONTROL, "no-cache")
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(name, value)
        .body(Body::from(html.into_bytes()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Builds `shell.html` with the boot object injected. Kept separate from the
/// response wrapper so it can be unit-tested without prying bytes out of an
/// `axum::body::Body`.
fn render_shell_page(
    file: &EmbeddedFile,
    config: &crate::config::AppConfig,
    page: &str,
    nonce: &str,
) -> String {
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
        "defaultServerUrl": crate::config::DEFAULT_SERVER_URL,
        "insecure": config.accept_invalid_certs,
        "background": config.background,
        "notifyEnabled": config.notify_enabled,
        "notifyQuietMinutes": config.notify_quiet_minutes,
        "configured": config.is_configured(),
        "languages": i18n::LANGUAGES,
        "dirs": dirs,
        "tables": tables,
    });
    // Two substitutions: the nonce every inline script declares, and the boot
    // object. The marker is only ever written as `nonce="__CSP_NONCE__"`.
    String::from_utf8_lossy(&file.data)
        .replace(csp::NONCE_MARKER, nonce)
        .replace(BOOT_MARKER, &format!("window.__SHELL__ = {boot};"))
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
        // An embedded asset is served with the type the build gave it; sniffing
        // would let a `.js` that a bundler mislabelled behave as HTML.
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
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
    use axum::body::to_bytes;
    use axum::http::header::CONTENT_SECURITY_POLICY;

    fn built() -> bool {
        Console::get("index.html").is_some()
    }

    /// A shell config in one language and theme, without the rest of the fields.
    fn cfg(lang: &str) -> crate::config::AppConfig {
        crate::config::AppConfig { lang: lang.to_string(), ..Default::default() }
    }

    async fn body_of(response: Response) -> String {
        let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("the body must be readable");
        String::from_utf8_lossy(&bytes).to_string()
    }

    /// The stamp is the crate version with a `v` prefix and the build commit
    /// trimmed to seven characters — `vX.Y.Z@<7-char commit>`.
    #[test]
    fn stamps_version_with_short_commit() {
        // The real function, not a copy of its format string: the login screen
        // renders this verbatim and the about page has to agree with it.
        let stamp = app_version_stamp();
        assert_eq!(
            stamp,
            format!("v{}@{}", crate::VERSION, &crate::COMMIT[..crate::COMMIT.len().min(7)]),
        );

        let (version, commit) = stamp
            .trim_start_matches('v')
            .split_once('@')
            .expect("the stamp is vX.Y.Z@<commit>");
        assert_eq!(version, crate::VERSION);
        assert!(commit.len() <= 7, "the commit must be trimmed: {commit}");
        assert!(!commit.contains('@'), "the stamp must have exactly one `@`: {stamp}");
    }

    #[test]
    fn tells_a_missing_asset_apart_from_a_client_route() {
        assert!(is_asset("assets/index-abc.js"));
        assert!(is_asset("theme-init.js"));
        assert!(is_asset("favicon.svg"));
        assert!(!is_asset("trace"));
        assert!(!is_asset("tasks/123"));
        assert!(!is_asset(""));
    }

    /// The console's index.html carries the version assignment so the login
    /// screen can render it.
    #[test]
    fn injects_app_version_into_index_html() {
        if !built() {
            eprintln!("skipping: web/dist has not been built");
            return;
        }
        let file = Console::get("index.html").unwrap();
        let html = render_console_index(&file, &cfg("en"), "n0nce");
        assert!(
            html.contains("window.__AGENTBUDDY_VERSION__"),
            "the app version stamp is missing from index.html"
        );
        assert!(
            html.contains("nonce=\"n0nce\""),
            "the version stamp must declare the response nonce, or the policy blocks it"
        );
        assert!(
            html.contains(&app_version_stamp()),
            "the injected stamp does not match app_version_stamp()"
        );
    }

    /// The window's origin carries the proxy's port, and the OS picks a new one
    /// on every start — so the page's `localStorage` is empty at every launch.
    /// The saved language and theme have to be planted there, and before
    /// `theme-init.js` runs, or the app comes back on the system language and the
    /// light theme however often the user changes them.
    #[test]
    fn seeds_the_saved_language_and_theme_before_the_theme_script() {
        if !built() {
            eprintln!("skipping: web/dist has not been built");
            return;
        }
        let file = Console::get("index.html").unwrap();
        let config = crate::config::AppConfig {
            lang: "zh".into(),
            theme: "dark".into(),
            ..Default::default()
        };
        let html = render_console_index(&file, &config, "n0nce");

        assert!(html.contains("s.setItem('agentbuddy.lang',\"zh\")"), "{html}");
        assert!(html.contains("s.setItem('agentbuddy.theme',\"dark\")"), "{html}");
        // Only what is missing is filled in: a reload inside one run keeps what
        // the page has just written.
        assert!(html.contains("if(!s.getItem('agentbuddy.lang'))"), "{html}");
        assert!(html.contains("if(!s.getItem('agentbuddy.theme'))"), "{html}");
        // Without the nonce the policy blocks it, and the theme would flash.
        assert!(html.contains("<script nonce=\"n0nce\">(function()"), "{html}");

        let seed = html.find("agentbuddy.theme").expect("the theme was not seeded");
        let pre_paint = html.find("/theme-init.js").expect("the pre-paint theme script is gone");
        assert!(seed < pre_paint, "the seed must run before the theme is read");
    }

    /// The defaults are what a first run gets: light, and a language we ship.
    #[test]
    fn seeds_light_and_a_valid_language_by_default() {
        if !built() {
            eprintln!("skipping: web/dist has not been built");
            return;
        }
        let file = Console::get("index.html").unwrap();
        let config = crate::config::AppConfig::default();
        let html = render_console_index(&file, &config, "n0nce");
        assert!(html.contains("s.setItem('agentbuddy.theme',\"light\")"), "{html}");
        assert!(
            html.contains(&format!("s.setItem('agentbuddy.lang',\"{}\")", config.lang())),
            "the seed must carry the language the shell would render in: {html}"
        );
    }

    /// A client route resolves to the app shell, and that shell is delivered with
    /// its own nonce — the policy is per response, so two requests must not share
    /// one.
    #[tokio::test]
    async fn a_client_route_gets_the_shell_with_a_fresh_nonce() {
        if !built() {
            eprintln!("skipping: web/dist has not been built");
            return;
        }

        let first = serve_console("/threads/42", &cfg("en"));
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(
            first.headers().get(CONTENT_TYPE).unwrap().to_str().unwrap(),
            "text/html; charset=utf-8",
        );
        let policy = first
            .headers()
            .get(CONTENT_SECURITY_POLICY)
            .expect("an HTML response must carry the policy")
            .to_str()
            .unwrap()
            .to_string();
        assert!(policy.contains("nonce-"), "the policy must name the nonce: {policy}");
        assert!(!policy.contains("script-src 'self' 'unsafe-inline'"), "{policy}");
        let first_nonce = policy
            .split("'nonce-")
            .nth(1)
            .and_then(|rest| rest.split('\'').next())
            .expect("the policy has no nonce value")
            .to_string();

        let second = serve_console("/threads/43", &cfg("en"));
        let second_policy = second
            .headers()
            .get(CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(
            !second_policy.contains(&first_nonce),
            "two responses shared a nonce: {second_policy}"
        );

        let html = body_of(first).await;
        assert!(html.contains("window.__AGENTBUDDY_VERSION__"), "the shell lost its version stamp");
    }

    /// A missing *file* is a 404, never the app shell: answering a script request
    /// with HTML turns a clear 404 into a MIME error in the browser console.
    #[tokio::test]
    async fn a_missing_asset_is_a_404_instead_of_the_shell() {
        if !built() {
            eprintln!("skipping: web/dist has not been built");
            return;
        }
        let response = serve_console("/assets/does-not-exist.js", &cfg("en"));
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers().get(CONTENT_TYPE).unwrap(), "text/plain; charset=utf-8");
        // No policy on a plain-text answer: nothing here can execute.
        assert!(response.headers().get(CONTENT_SECURITY_POLICY).is_none());
        assert_eq!(body_of(response).await, "not found");
    }

    #[test]
    fn hashed_assets_are_cached_forever_and_the_shell_is_revalidated() {
        if !built() {
            eprintln!("skipping: web/dist has not been built");
            return;
        }
        let Some(file) = Console::get("theme-init.js").or_else(|| Console::get("index.html")) else {
            eprintln!("skipping: web/dist has no asset to serve");
            return;
        };

        let hashed = file_response("assets/app-1234.js", &file);
        assert_eq!(hashed.status(), StatusCode::OK);
        assert_eq!(
            hashed.headers().get(CACHE_CONTROL).unwrap(),
            "public, max-age=31536000, immutable",
        );

        // Anything outside assets/ may change between builds, so it is revalidated.
        let plain = file_response("theme-init.js", &file);
        assert_eq!(plain.headers().get(CACHE_CONTROL).unwrap(), "no-cache");
    }

    /// The bundle is served from a plain http origin, so the browser must take
    /// the declared type for granted — otherwise a file that a bundler
    /// mislabelled could execute as a document.
    #[tokio::test]
    async fn nothing_the_shell_serves_may_be_sniffed() {
        if built() {
            for response in [serve_console("/", &cfg("en")), serve_console("/trace", &cfg("en"))] {
                assert_eq!(
                    response.headers().get(X_CONTENT_TYPE_OPTIONS).map(|v| v.to_str().unwrap()),
                    Some("nosniff"),
                );
            }
        }
        let shell = shell_page("connect", &crate::config::AppConfig::default());
        assert_eq!(
            shell.headers().get(X_CONTENT_TYPE_OPTIONS).map(|v| v.to_str().unwrap()),
            Some("nosniff"),
        );
    }

    /// The shell page carries the boot object the connection page reads, and it
    /// must never drift from Rust: the languages table and the RTL directions
    /// are rendered straight from `i18n`.
    #[test]
    fn renders_shell_page_with_the_boot_object() {
        let Some(file) = Shell::get("shell.html") else {
            eprintln!("skipping: assets/shell.html is missing");
            return;
        };
        let html =
            render_shell_page(&file, &crate::config::AppConfig::default(), "connect", "n0nce");
        assert!(html.contains("window.__SHELL__"), "the boot object is missing");
        assert!(
            !html.contains(csp::NONCE_MARKER),
            "every inline script must have been stamped with the response nonce"
        );
        assert!(html.contains("\"version\""), "the boot object must carry the version stamp");
        assert!(html.contains("\"languages\""), "the boot object must carry the language table");
        assert!(html.contains("\"dirs\""), "the boot object must carry the RTL/LTR directions");
        assert!(html.contains("\"page\":\"connect\""), "the boot object must carry the page name");
        assert!(
            html.contains(&format!(
                "\"defaultServerUrl\":\"{}\"",
                crate::config::DEFAULT_SERVER_URL
            )),
            "the boot object must carry the default server address"
        );
    }

    /// The pre-filled address lives in one Rust constant, not in 13 copy blocks
    /// that could drift apart: every language's boot object must carry the same
    /// value, and every language's copy table must still be there.
    #[test]
    fn every_language_gets_the_same_default_server_address() {
        let Some(file) = Shell::get("shell.html") else {
            eprintln!("skipping: assets/shell.html is missing");
            return;
        };
        let expected = format!("\"defaultServerUrl\":\"{}\"", crate::config::DEFAULT_SERVER_URL);
        for (code, _) in crate::i18n::LANGUAGES {
            let config = crate::config::AppConfig {
                lang: code.to_string(),
                ..Default::default()
            };
            let html = render_shell_page(&file, &config, "connect", "n0nce");
            assert!(
                html.contains(&format!("\"lang\":\"{code}\"")),
                "{code} did not reach the boot object"
            );
            assert!(
                html.contains(&format!("\"{code}\":{{")),
                "{code} copy table is missing from the boot object"
            );
            assert!(html.contains(&expected), "{code} lost the default server address");
        }
    }

    /// A boot field nobody reads would still leave the first-run address empty.
    /// The connection page has to consume it both as the value and as the hint
    /// shown after the field is cleared, and no stale example may remain.
    #[test]
    fn the_connection_page_reads_the_boot_default() {
        let Some(file) = Shell::get("shell.html") else {
            eprintln!("skipping: assets/shell.html is missing");
            return;
        };
        let html = String::from_utf8_lossy(&file.data);
        assert!(
            html.matches("boot.defaultServerUrl").count() >= 2,
            "the connection page no longer pre-fills the default server address"
        );
        assert!(
            !html.contains("agenthub.example.com"),
            "a stale example address is still shown in the server field"
        );
    }

    /// The about page is the same file with a different `page`, so the boot
    /// object is what tells the two apart — nothing in the HTML decides it.
    #[test]
    fn the_shell_page_name_reaches_the_boot_object() {
        let Some(file) = Shell::get("shell.html") else {
            eprintln!("skipping: assets/shell.html is missing");
            return;
        };
        let html = render_shell_page(&file, &crate::config::AppConfig::default(), "about", "n0nce");
        assert!(html.contains("\"page\":\"about\""), "the about page lost its name");
        // And the two pages agree on the stamp the shell shows.
        assert!(html.contains(&app_version_stamp()));
    }
}
