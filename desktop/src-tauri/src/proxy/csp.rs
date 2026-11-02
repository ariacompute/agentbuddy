//! The content security policy for the pages the shell serves itself.
//!
//! Why the proxy has to send it: the window opens `http://127.0.0.1:<port>`, a
//! plain loopback origin. `tauri.conf.json`'s `security.csp` covers the assets
//! Tauri serves over its own protocol; it never reaches a response that came
//! from this proxy — so a policy written only there would be a policy nobody
//! enforces. The header is emitted here, on the HTML the proxy hands out.
//!
//! Why a nonce: three scripts have to run before the app does — the theme
//! resolution that prevents a flash of the wrong grey scale (the workbench's,
//! now external, and the shell page's) and the version stamp the login screen
//! reads. Rather than letting the whole origin use `unsafe-inline`, each
//! response mints one nonce, the inline scripts declare it, and `script-src`
//! stays `'self'` plus that single value. A nonce is unpredictable per response,
//! so an injected `<script>` cannot guess it.
//!
//! `style-src` keeps `'unsafe-inline'`: both pages carry their own `<style>`
//! block (the shell page is a single file with no bundle to load) and Vue
//! applies per-element styles that a nonce cannot cover. Inline styles cannot
//! execute, which is the line that matters here.

use rand::RngCore;

use axum::http::header::{HeaderName, HeaderValue, CONTENT_SECURITY_POLICY};

/// Placeholder the HTML carries until a response mints its nonce. Both the
/// shell page and the injected version stamp use it, so one replacement point
/// covers every inline script.
pub const NONCE_MARKER: &str = "__CSP_NONCE__";

/// A fresh nonce for one response, 128 bits hex encoded.
pub fn new_nonce() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The policy for one response.
///
/// `connect-src 'self'` is enough because the workbench only ever speaks
/// relative URLs back to this origin; SSE is an ordinary same-origin request.
pub fn policy(nonce: &str) -> String {
    format!(
        "default-src 'self'; \
         script-src 'self' 'nonce-{nonce}'; \
         style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob:; \
         font-src 'self' data:; \
         connect-src 'self'; \
         media-src 'self' blob:; \
         worker-src 'self' blob:; \
         object-src 'none'; \
         base-uri 'none'; \
         form-action 'self'; \
         frame-ancestors 'none'"
    )
}

/// The header pair to attach to an HTML response.
pub fn header(nonce: &str) -> (HeaderName, HeaderValue) {
    let value = HeaderValue::from_str(&policy(nonce))
        // The policy is built from literals plus a hex nonce, so this cannot
        // fail; the fallback keeps a broken build from panicking a request.
        .unwrap_or_else(|_| HeaderValue::from_static("default-src 'none'"));
    (CONTENT_SECURITY_POLICY, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_response_gets_a_different_nonce() {
        assert_ne!(new_nonce(), new_nonce());
        assert_eq!(new_nonce().len(), 32, "128 bits, hex encoded");
    }

    #[test]
    fn the_policy_names_the_nonce_and_forbids_inline_scripts() {
        let policy = policy("abc123");
        assert!(policy.contains("script-src 'self' 'nonce-abc123'"));
        // The one thing this policy exists to prevent.
        assert!(!policy.contains("script-src 'self' 'unsafe-inline'"));
        assert!(!policy.contains("script-src *"));
    }

    #[test]
    fn the_policy_closes_the_usual_escapes() {
        let policy = policy("n");
        for directive in [
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "connect-src 'self'",
        ] {
            assert!(policy.contains(directive), "{directive} is missing");
        }
    }

    #[test]
    fn the_header_is_well_formed() {
        let (name, value) = header("abc");
        assert_eq!(name.as_str(), "content-security-policy");
        assert!(value.to_str().unwrap().contains("nonce-abc"));
    }
}
