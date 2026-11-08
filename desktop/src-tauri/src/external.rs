//! Links the workbench or the shell's own pages ask the *browser* to open.
//!
//! Tauri answers a new-window request with `Deny` unless a handler says
//! otherwise (wry then marks the request handled and no window appears), so both
//! `window.open(url, '_blank')` and `<a target="_blank">` were silent no-ops in
//! this shell — "Manual download" looked like a dead button. The shell answers
//! the request itself: the operating system's default browser gets the URL and
//! the WebView still gets no window, so nothing about the app's own surface
//! changes.
//!
//! Only plain web pages leave the app. `file:` would reach the user's disk,
//! `javascript:` and registered custom schemes would launch a program of the
//! page's choosing, and credentials in the authority make the address the
//! browser eventually shows a lie.

use std::io;

use url::Url;

/// True for the URLs a page may push out to the operating system.
pub fn is_external(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
}

/// Hands `url` to the default browser.
///
/// Off the caller's thread on purpose: the handler runs on the WebView's message
/// loop, and `ShellExecuteW` can wait while the shell looks the association up.
/// A failure is logged and swallowed — a click that cannot open a browser is not
/// a reason to take the shell down.
pub fn open(url: &Url) {
    let target = url.to_string();
    std::thread::spawn(move || {
        if let Err(err) = spawn(&target) {
            eprintln!("agentbuddy desktop: cannot open {target} in a browser: {err}");
        }
    });
}

/// Starts the platform's URL handler.
///
/// `ShellExecuteW` rather than `cmd /c start`: the URL is page-supplied text and
/// `cmd` would read a `&` in it as a second command.
#[cfg(windows)]
fn spawn(url: &str) -> io::Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            window: *mut core::ffi::c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> isize;
    }

    /// `SW_SHOWNORMAL`: the browser sizes its own window anyway.
    const SHOW_NORMAL: i32 = 1;
    /// `ShellExecuteW` returns 32 or less for every failure, a pseudo-handle above.
    const SHELL_SUCCESS: isize = 32;

    let wide: Vec<u16> = OsStr::new(url).encode_wide().chain(std::iter::once(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SHOW_NORMAL,
        )
    };
    if result <= SHELL_SUCCESS {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
const OPENER: &str = "open";
#[cfg(all(unix, not(target_os = "macos")))]
const OPENER: &str = "xdg-open";

#[cfg(unix)]
fn spawn(url: &str) -> io::Result<()> {
    spawn_with(OPENER, url)
}

/// Detached on purpose: nothing waits for the browser and its output is of no
/// interest. Split out so the "no such program" path is testable without
/// launching anything.
#[cfg(unix)]
fn spawn_with(program: &str, url: &str) -> io::Result<()> {
    std::process::Command::new(program)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(raw: &str) -> Url {
        Url::parse(raw).expect("the test URL parses")
    }

    #[test]
    fn release_pages_leave_the_app() {
        assert!(is_external(&parse("https://github.com/ariacompute/agentbuddy/releases/latest")));
        assert!(is_external(&parse("https://gitee.com/ariacompute/agentbuddy/releases")));
        // A loopback dev server is a web page too.
        assert!(is_external(&parse("http://127.0.0.1:8080/docs")));
    }

    #[test]
    fn everything_that_is_not_a_web_page_stays_inside() {
        for raw in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "mailto:owner@example.com",
            "agentbuddy://open",
            "data:text/html,hi",
        ] {
            assert!(!is_external(&parse(raw)), "{raw} must not reach the OS");
        }
    }

    #[test]
    fn credentials_in_the_authority_are_refused() {
        assert!(!is_external(&parse("https://owner:pw@github.com/ariacompute/agentbuddy")));
        assert!(!is_external(&parse("https://owner@github.com/ariacompute/agentbuddy")));
    }

    #[cfg(unix)]
    #[test]
    fn a_missing_opener_is_an_error_and_not_a_panic() {
        assert!(spawn_with("agentbuddy-no-such-opener", "https://github.com/").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn the_platform_opener_is_the_standard_one() {
        assert!(matches!(OPENER, "open" | "xdg-open"));
    }
}
