//! The tray icon: the one piece of native UI the shell owns.
//!
//! Four entries — open the workbench, change the connection, about, quit — in
//! whichever of the 13 languages the user picked. The menu is rebuilt whenever
//! that language changes.

use std::sync::atomic::{AtomicU32, Ordering};

use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::{AppHandle, Manager};

use crate::config::AppConfig;
use crate::i18n;

pub const TRAY_ID: &str = "main";

/// What the workbench last reported as unread.
///
/// It is kept in the process rather than read back from the window because
/// `refresh` runs on a language change, which rebuilds the menu and would
/// otherwise wipe the badge it is not being told about again.
static UNREAD: AtomicU32 = AtomicU32::new(0);

/// The badge for a count, in the user's language. Empty at zero: "0 unread" is a
/// badge nobody wants.
pub fn badge_text(lang: &str, count: u32) -> String {
    if count == 0 {
        return String::new();
    }
    i18n::translate(lang, "trayUnread").replace("{n}", &badge_number(count))
}

/// The number itself, capped where the tray can still render it.
fn badge_number(count: u32) -> String {
    if count > 99 {
        "99+".to_string()
    } else {
        count.to_string()
    }
}

/// The title a platform that supports one shows. Windows has no tray title, so
/// the tooltip carries the number there and this is `None` at zero everywhere.
fn title_for(count: u32) -> Option<String> {
    if count == 0 {
        None
    } else {
        Some(badge_number(count))
    }
}

/// Tells the tray how much is unread. The tooltip is the part every platform
/// shows; the title is the numeric badge macOS and the Linux appindicator add.
pub fn set_unread(app: &AppHandle, lang: &str, count: u32) {
    UNREAD.store(count, Ordering::Relaxed);
    apply_badge(app, lang, count);
}

fn apply_badge(app: &AppHandle, lang: &str, count: u32) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let text = badge_text(lang, count);
    let tooltip = if text.is_empty() { APP_NAME.to_string() } else { text };
    let _ = tray.set_tooltip(Some(tooltip));
    let title = title_for(count);
    let _ = tray.set_title(title.as_deref());
}

/// The tooltip an idle tray carries. It is the product name, which is a proper
/// noun and therefore the same in every language.
const APP_NAME: &str = "agentbuddy";

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
    // A badge set before the icon existed (an early notification) is applied now.
    apply_badge(app, config.lang(), UNREAD.load(Ordering::Relaxed));
    Ok(())
}

/// Re-labels the menu, which is what a language change has to do.
pub fn refresh(app: &AppHandle, config: &AppConfig) {
    if let Ok(menu) = menu(app, config) {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    // The badge is rebuilt too: its tooltip is in the language that just changed,
    // and the count has not changed with it.
    apply_badge(app, config.lang(), UNREAD.load(Ordering::Relaxed));
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

    #[test]
    fn an_empty_inbox_carries_no_badge() {
        // Zero is not "0 unread": the tray shows nothing at all.
        assert_eq!(badge_text("en", 0), "");
        assert_eq!(title_for(0), None);
    }

    #[test]
    fn the_badge_counts_up_to_ninety_nine_and_then_says_more() {
        assert_eq!(badge_text("en", 1), "1 unread");
        assert_eq!(badge_text("en", 42), "42 unread");
        assert_eq!(badge_text("en", 99), "99 unread");
        // Past 99 the exact number stops fitting in a menu bar.
        assert_eq!(badge_text("en", 100), "99+ unread");
        assert_eq!(title_for(100).as_deref(), Some("99+"));
        assert_eq!(title_for(7).as_deref(), Some("7"));
    }

    #[test]
    fn every_language_has_its_own_badge_wording() {
        // The shell's copy is 13 languages; a language that fell back to English
        // would be a badge nobody translated.
        for (code, _) in crate::i18n::LANGUAGES {
            let text = badge_text(code, 3);
            assert!(!text.is_empty(), "{code} has no badge wording");
            assert!(text.contains('3'), "{code} drops the number: {text}");
            if code != "en" {
                assert_ne!(text, badge_text("en", 3), "{code} repeats the English badge");
            }
        }
    }
}
