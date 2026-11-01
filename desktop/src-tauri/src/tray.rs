//! The tray icon: the one piece of native UI the shell owns.
//!
//! Four entries — open the workbench, change the connection, about, quit — in
//! whichever of the 13 languages the user picked. The menu is rebuilt whenever
//! that language changes.

use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::{AppHandle, Manager};

use crate::config::AppConfig;
use crate::i18n;

pub const TRAY_ID: &str = "main";

const ID_OPEN: &str = "shell.open";
const ID_SETTINGS: &str = "shell.settings";
const ID_ABOUT: &str = "shell.about";
const ID_QUIT: &str = "shell.quit";

pub fn build(app: &AppHandle, config: &AppConfig) -> tauri::Result<()> {
    let menu = menu(app, config)?;
    match app.tray_by_id(TRAY_ID) {
        Some(tray) => tray.set_menu(Some(menu))?,
        None => {
            let icon = app.default_window_icon().cloned();
            let mut builder = tauri::tray::TrayIconBuilder::with_id(TRAY_ID).menu(&menu);
            if let Some(icon) = icon {
                builder = builder.icon(icon);
            }
            let _ = builder.build(app)?;
        }
    }
    Ok(())
}

/// Re-labels the menu, which is what a language change has to do.
pub fn refresh(app: &AppHandle, config: &AppConfig) {
    if let Ok(menu) = menu(app, config) {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn menu(app: &AppHandle, config: &AppConfig) -> tauri::Result<Menu<tauri::Wry>> {
    let lang = config.lang();
    let t = |key: &str| i18n::translate(lang, key);
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, ID_OPEN, t("trayOpen"), true, None::<&str>)?,
            &MenuItem::with_id(app, ID_SETTINGS, t("traySettings"), true, None::<&str>)?,
            &MenuItem::with_id(app, ID_ABOUT, t("trayAbout"), true, None::<&str>)?,
            &MenuItem::with_id(app, ID_QUIT, t("trayQuit"), true, None::<&str>)?,
        ],
    )
}

/// Where a menu entry points. Split out of the handler so the mapping can be
/// checked without a running Tauri app.
fn path_for(id: &str) -> Option<&'static str> {
    match id {
        ID_OPEN => Some("/"),
        ID_SETTINGS => Some("/__shell/connect"),
        ID_ABOUT => Some("/__shell/about"),
        _ => None,
    }
}

pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    // Quit is the only entry that ends the process; everything else opens a
    // page in the one window, which is also how the app comes back from the tray.
    if id == ID_QUIT {
        app.exit(0);
        return;
    }
    if let Some(path) = path_for(id) {
        open(app, path);
    }
}

fn open(app: &AppHandle, path: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Some(base) = app.try_state::<crate::ShellContext>() {
        let url = base.proxy_url.read().map(|url| url.clone()).unwrap_or_default();
        if !url.is_empty() {
            if let Ok(parsed) = url::Url::parse(&format!("{url}{path}")) {
                let _ = window.navigate(parsed);
            }
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_entry_opens_its_own_page() {
        assert_eq!(path_for(ID_OPEN), Some("/"));
        assert_eq!(path_for(ID_SETTINGS), Some("/__shell/connect"));
        assert_eq!(path_for(ID_ABOUT), Some("/__shell/about"));
    }

    #[test]
    fn quit_and_unknown_ids_open_nothing() {
        // Quit ends the process instead of navigating, and an id from a stale
        // menu must not navigate anywhere either.
        assert_eq!(path_for(ID_QUIT), None);
        assert_eq!(path_for("shell.unknown"), None);
        assert_eq!(path_for(""), None);
    }

    #[test]
    fn the_tray_id_is_the_one_tauri_looks_up() {
        assert_eq!(TRAY_ID, "main");
    }
}
