//! Admission control for the loopback proxy.
//!
//! Why it exists: the proxy listens on `127.0.0.1`, which is reachable by every
//! process on the machine — including a browser tab, a malicious npm package's
//! postinstall script, or any other app running as the same user. Binding to the
//! loopback interface keeps the network out; it does not keep the machine out.
//! Without a token, `http://127.0.0.1:<port>/api/...` was an unauthenticated
//! proxy into the user's agenthub session, and `/__shell/config` let any of them
//! re-point the app at a server of their choosing.
//!
//! The design has to work for a WebView that cannot be told to attach a header
//! to a navigation, so the token is delivered as a cookie exactly once:
//!
//! 1. The shell generates 32 random bytes at launch and one single-use nonce.
//! 2. The window opens `/__shell/bootstrap?nonce=…`; the server validates the
//!    nonce, sets `ab_proxy=<token>; HttpOnly; SameSite=Strict; Path=/`, and
//!    redirects to `/`.
//! 3. Every other route — including `/__shell/*` and the static bundle — requires
//!    the cookie (or `Authorization: Bearer`), and requests whose `Origin` names
//!    some other site are refused.
//!
//! The token never enters JavaScript, so a script injected into the console cannot
//! read it out of storage; the browser attaches the cookie itself, which is also
//! why SSE keeps working.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::http::{header, HeaderMap};
use rand::RngCore;

/// The cookie the proxy sets once and then requires.
pub const COOKIE_NAME: &str = "ab_proxy";

/// How long a bootstrap nonce stays usable. A nonce is single use regardless, so
/// this only bounds how long a leaked URL is worth anything.
pub const NONCE_TTL: Duration = Duration::from_secs(60);

/// Admission control state for one process.
pub struct Auth {
    token: String,
    nonce: Mutex<Option<PendingNonce>>,
}

struct PendingNonce {
    value: String,
    issued: Instant,
}

impl Auth {
    /// Generates a fresh token and its first bootstrap nonce.
    pub fn new() -> Self {
        let auth = Self { token: random_hex(), nonce: Mutex::new(None) };
        auth.new_nonce();
        auth
    }

    /// The token, for the bootstrap redirect only.
    pub fn token(&self) -> &str {
        &self.token
    }

    /// Issues a nonce, replacing whatever was outstanding: a second window must
    /// not leave the first one's value valid.
    pub fn new_nonce(&self) -> String {
        let value = random_hex();
        if let Ok(mut slot) = self.nonce.lock() {
            *slot = Some(PendingNonce { value: value.clone(), issued: Instant::now() });
        }
        value
    }

    /// Consumes the outstanding nonce. It is cleared whether or not it matched,
    /// so one guess is all an attacker gets.
    pub fn take_nonce(&self, candidate: &str) -> bool {
        let Ok(mut slot) = self.nonce.lock() else {
            return false;
        };
        let Some(pending) = slot.take() else {
            return false;
        };
        if pending.issued.elapsed() > NONCE_TTL {
            return false;
        }
        constant_time_eq(pending.value.as_bytes(), candidate.as_bytes())
    }

    /// Reports whether a request carries the token, as a cookie or a bearer
    /// header.
    pub fn authorized(&self, headers: &HeaderMap) -> bool {
        if let Some(value) = headers.get(header::AUTHORIZATION) {
            if let Some(raw) = value.to_str().ok() {
                if let Some(bearer) = raw.strip_prefix("Bearer ") {
                    return constant_time_eq(self.token.as_bytes(), bearer.trim().as_bytes());
                }
            }
        }
        let Some(value) = headers.get(header::COOKIE) else {
            return false;
        };
        let Ok(raw) = value.to_str() else {
            return false;
        };
        token_from_cookie(raw)
            .map(|found| constant_time_eq(self.token.as_bytes(), found.as_bytes()))
            .unwrap_or(false)
    }
}

impl Default for Auth {
    fn default() -> Self {
        Self::new()
    }
}

/// Extracts the proxy token from a `Cookie` header.
pub fn token_from_cookie(raw: &str) -> Option<&str> {
    raw.split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE_NAME)
        .map(|(_, value)| value)
}

/// The `Set-Cookie` value that hands the token to the WebView.
pub fn bootstrap_cookie(token: &str) -> String {
    // `HttpOnly` keeps it away from scripts; `SameSite=Strict` means a page on
    // another origin cannot even trigger a request that carries it; `Path=/`
    // covers the console, the API and the shell endpoints.
    format!("{COOKIE_NAME}={token}; HttpOnly; SameSite=Strict; Path=/")
}

/// A random 256 bit value, hex encoded.
fn random_hex() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Compares two byte strings without leaking where they diverge.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers_with_cookie(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_str(value).unwrap());
        headers
    }

    #[test]
    fn rejects_a_request_with_no_token() {
        let auth = Auth::new();
        assert!(!auth.authorized(&HeaderMap::new()));
    }

    #[test]
    fn accepts_the_cookie_it_issued() {
        let auth = Auth::new();
        let cookie = format!("other=1; {}={}", COOKIE_NAME, auth.token());
        assert!(auth.authorized(&headers_with_cookie(&cookie)));
    }

    #[test]
    fn accepts_a_bearer_header() {
        let auth = Auth::new();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", auth.token())).unwrap(),
        );
        assert!(auth.authorized(&headers));
    }

    #[test]
    fn rejects_a_wrong_token_of_the_same_shape() {
        let auth = Auth::new();
        let wrong = "0".repeat(auth.token().len());
        if wrong == auth.token() {
            return; // astronomically unlikely, and the assertion below is moot
        }
        assert!(!auth.authorized(&headers_with_cookie(&format!("{COOKIE_NAME}={wrong}"))));
    }

    #[test]
    fn a_nonce_is_single_use() {
        let auth = Auth::new();
        let nonce = auth.new_nonce();
        assert!(auth.take_nonce(&nonce));
        assert!(!auth.take_nonce(&nonce), "the same nonce must not work twice");
    }

    #[test]
    fn issuing_a_nonce_invalidates_the_previous_one() {
        let auth = Auth::new();
        let first = auth.new_nonce();
        let _second = auth.new_nonce();
        assert!(!auth.take_nonce(&first));
    }

    #[test]
    fn an_unknown_nonce_is_refused() {
        let auth = Auth::new();
        assert!(!auth.take_nonce("not-the-nonce"));
    }

    #[test]
    fn the_cookie_is_http_only_strict_and_root_scoped() {
        let cookie = bootstrap_cookie("abc");
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));
        assert!(cookie.contains("Path=/"));
        assert!(!cookie.contains("Secure"), "the loopback origin is plain http");
    }

    #[test]
    fn two_processes_get_different_tokens() {
        assert_ne!(Auth::new().token(), Auth::new().token());
    }
}
