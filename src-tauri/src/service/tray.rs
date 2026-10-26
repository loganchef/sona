//! Menu-bar presence.
//!
//! Both reference apps keep a permanent menu-bar item; it is the only way to
//! start a dictation when no window is open. Items mirror the hotkeys, so the
//! app stays reachable after the main window is closed.

use serde_json::json;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager};

use crate::model::AppState;

fn labels(language: &str) -> [&'static str; 5] {
    if language.starts_with("zh") {
        [
            "开始 / 结束听写",
            "打开 Sona",
            "历史记录",
            "设置",
            "退出 Sona",
        ]
    } else {
        [
            "Start / stop dictation",
            "Open Sona",
            "History",
            "Settings",
            "Quit Sona",
        ]
    }
}

pub fn install(app: &App, handle: &AppHandle) -> tauri::Result<()> {
    let language = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .general
        .language
        .clone();
    let [dictate, open, history, settings, quit] = labels(&language);

    let dictate_item = MenuItem::with_id(handle, "dictate", dictate, true, None::<&str>)?;
    let open_item = MenuItem::with_id(handle, "open", open, true, None::<&str>)?;
    let history_item = MenuItem::with_id(handle, "history", history, true, None::<&str>)?;
    let settings_item = MenuItem::with_id(handle, "settings", settings, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(handle)?;
    let quit_item = MenuItem::with_id(handle, "quit", quit, true, None::<&str>)?;

    let menu = Menu::with_items(
        handle,
        &[
            &dictate_item,
            &separator,
            &open_item,
            &history_item,
            &settings_item,
            &separator,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("sona-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Sona · 说一句，落一行")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            "dictate" => {
                reveal(app);
                let _ = app.emit("sona://tray", json!({ "action": "dictate" }));
            }
            action @ ("open" | "history" | "settings") => {
                reveal(app);
                let _ = app.emit("sona://tray", json!({ "action": action }));
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(handle)?;
    Ok(())
}

fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
