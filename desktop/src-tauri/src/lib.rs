//! The agentbuddy desktop shell.
//!
//! It carries no backend of its own: it opens the agentbuddy workbench (served by
//! an agenthub server) and keeps it pointed at a server the user chooses. The
//! interesting parts are the loopback proxy (which makes the workbench's relative
//! URLs, cookies and SSE work against a remote server), the connection
//! configuration, the notification bridge, and the 13-language copy for the few
//! pieces of UI the shell owns.

use std::sync::{Arc, RwLock as StdRwLock};

use tauri::Manager;

pub mod config;
pub mod console;
pub mod executor;
pub mod external;
pub mod i18n;
pub mod notify;
pub mod proxy;
pub mod session;
pub mod single;
pub mod tray;
pub mod upgrade;

/// The build version, used by the `vX.Y.Z@<7-char commit>` stamp. Derived at
/// build time from the latest git tag (see `build.rs` / `AGENTBUDDY_VERSION`), so
/// it tracks the real release tag instead of the `Cargo.toml` package version;
/// falls back to `CARGO_PKG_VERSION` when git or its tags are unavailable.
pub const VERSION: &str = match option_env!("AGENTBUDDY_VERSION") {
    Some(v) if !v.is_empty() => v,
    _ => env!("CARGO_PKG_VERSION"),
};
/// The build commit, 7-char short hash. Derived at build time by `build.rs`
/// from git (or `AGENTBUDDY_COMMIT` if the CI supplies one); `unknown` only
/// when neither is available.
pub const COMMIT: &str = match option_env!("AGENTBUDDY_COMMIT") {
    Some(commit) => commit,
    None => "unknown",
};

/// What the tray needs and the proxy fills in once it is listening.
pub struct ShellContext {
    pub config: config::SharedConfig,
    pub proxy_url: Arc<StdRwLock<String>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        // The updater's commands are never exposed to the WebView: it is used
        // from Rust only, through /__shell/upgrade. The release workflow injects
        // the same key here (runtime verification) and into tauri.conf.json's
        // plugins.updater.pubkey (tauri build's signing check).
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(upgrade::UPDATER_PUBKEY)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();

            let dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("agentbuddy-desktop"));

            // One copy per user. With "keep running in the tray" on (the
            // default) the window is only parked, so launching the app again
            // must raise that parked window — keeping its page, its proxy and
            // its session — instead of starting a second everything. Done before
            // the config, the tray and the proxy: a second launch then costs
            // nothing and shows nothing.
            match single::claim(&dir) {
                single::Claim::AlreadyRunning => {
                    // The copy that is already running has been asked to come
                    // forward. This process has nothing left to do.
                    std::process::exit(0);
                }
                single::Claim::Primary(instance) => {
                    let raise = handle.clone();
                    instance.serve(move || {
                        // Until the proxy answers, the window is hidden on
                        // purpose and the startup below is about to show it:
                        // raising it now would only flash the blank stub. From
                        // the moment there is a URL, this is the parked window
                        // the launch is asking for.
                        let ready = raise
                            .try_state::<ShellContext>()
                            .map(|state| {
                                state.proxy_url.read().map(|url| !url.is_empty()).unwrap_or(false)
                            })
                            .unwrap_or(false);
                        if !ready {
                            return;
                        }
                        let Some(window) = raise.get_webview_window("main") else {
                            return;
                        };
                        // A parked window is hidden and may also be minimised:
                        // restore it before showing, so the launch lands on the
                        // page it left.
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    });
                }
            }

            // Before anything that looks the window up. It is built in code
            // rather than in tauri.conf.json because it carries the new-window
            // handler, and a config-declared window cannot be given one.
            main_window(app)?;

            // The session cookie is a bearer token, so it goes to the OS
            // credential store — the file next to config.json is only the
            // fallback for machines that have none.
            let store = Arc::new(config::ConfigStore::keyring_or_file(dir));
            let initial = store.load();

            let shared = Arc::new(tokio::sync::RwLock::new(initial.clone()));
            let proxy_url = Arc::new(StdRwLock::new(String::new()));
            app.manage(ShellContext { config: shared.clone(), proxy_url: proxy_url.clone() });

            tray::build(&handle, &initial)?;
            app.on_menu_event(tray::on_menu_event);

            // Clicking a toast should land on the page it is about, not just
            // raise the window. Registered once, before the proxy can forward a
            // single notification.
            notify::install(&handle);

            // Closing the window either parks it in the tray (when the user kept
            // "run in the background" on) or lets it close — which ends the app,
            // because the shell has no other window to fall back on. The
            // preference lives in the shell config and can change while the window
            // is open, so it is read at close time rather than captured once.
            if let Some(window) = app.get_webview_window("main") {
                let parked = window.clone();
                let close_config = shared.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if close_config.blocking_read().background {
                            api.prevent_close();
                            let _ = parked.hide();
                        }
                    }
                });
            }

            // The window stays hidden until the proxy answers: the first thing it
            // shows is the workbench (or the connection page), never a blank frame.
            let started = shared.clone();
            let persisted = store.clone();
            let shell = handle.clone();
            tauri::async_runtime::spawn(async move {
                match proxy::start(started, persisted, shell.clone()).await {
                    Ok(proxy) => {
                        if let Ok(mut url) = proxy_url.write() {
                            *url = proxy.url.clone();
                        }
                        if let Some(window) = shell.get_webview_window("main") {
                            // The window opens the bootstrap URL, not the root:
                            // that one redirect is how the WebView receives the
                            // proxy cookie it cannot be given any other way.
                            let target =
                                proxy.bootstrap_url.clone().unwrap_or_else(|| proxy.url.clone());
                            if let Ok(url) = url::Url::parse(&target) {
                                let _ = window.navigate(url);
                            }
                            let _ = window.show();
                        }
                    }
                    Err(err) => eprintln!("agentbuddy desktop: {err}"),
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("agentbuddy desktop: cannot start the app");
}

/// The one window the shell owns.
///
/// It is built here while everything else about it matches the `app.windows`
/// entry it replaced (size, minimums, hidden until the proxy answers).
///
/// `on_new_window` is the reason it is not declared in `tauri.conf.json`: Tauri
/// denies a new-window request by default, so `window.open` and
/// `<a target="_blank">` in the workbench and in the shell's own pages were dead
/// clicks — "Manual download" among them. The handler hands a web page to the OS
/// browser and still denies the WebView a window it could not manage.
fn main_window(app: &tauri::App) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("agentbuddy")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 600.0)
        .resizable(true)
        .center()
        // The startup below shows the window once there is a URL to show, so the
        // first frame it paints is the workbench, never the stub.
        .visible(false)
        .on_new_window(|url, _features| {
            if external::is_external(&url) {
                external::open(&url);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}
