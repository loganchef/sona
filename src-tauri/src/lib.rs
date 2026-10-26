pub mod commands;
pub mod dao;
pub mod model;
pub mod service;
pub mod util;

use commands::*;
use model::AppState;
use tauri::Manager;

/// A background launch (`--hidden`, passed by the login item) still has to show
/// the window when setup is unfinished; otherwise the app looks dead on first run.
fn should_show_main(start_hidden: bool, onboarded: bool) -> bool {
    !(start_hidden && onboarded)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Must be the first plugin: a second launch hands its arguments to this
    // instance and exits instead of starting a rival tray icon and hotkey.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // Desktop-only host capabilities: window geometry, global hotkeys, login item.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--hidden"]),
            ))
            // Visibility is decided by `--hidden` + onboarding below, not by the
            // last session: restoring `VISIBLE` would undo background launches.
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::all()
                            - tauri_plugin_window_state::StateFlags::VISIBLE,
                    )
                    .build(),
            )
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .manage(AppState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();

            if let Err(error) = tauri::async_runtime::block_on(async {
                service::app_state::initialize(&app_handle, state.inner()).await
            }) {
                eprintln!("failed to initialize app state: {error}");
            }

            // The main window starts hidden in the config so a login launch does
            // not flash the whole app. Show it unless autostart asked for a
            // background launch *and* setup is already done.
            let start_hidden = std::env::args().any(|arg| arg == "--hidden");
            let onboarded = state.settings.lock().unwrap().general.onboarded;
            if let Some(main) = app.get_webview_window("main") {
                if should_show_main(start_hidden, onboarded) {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }

            // The capsule is a floating surface: it must never appear on launch.
            if let Some(capsule) = app.get_webview_window("capsule") {
                let _ = capsule.hide();
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                if let Err(error) = service::tray::install(app, &app_handle) {
                    eprintln!("tray unavailable: {error}");
                }
            }

            let voice = state.settings.lock().unwrap().voice.clone();
            let status = service::hotkey::apply(&app_handle, &voice);
            if !status.failed.is_empty() {
                eprintln!("hotkey registration issues: {:?}", status.failed);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // system
            get_app_info,
            get_system_locale,
            get_hotkey_status,
            get_autostart,
            set_autostart,
            // settings
            get_settings,
            update_setting,
            reset_settings,
            // style packs
            list_style_packs,
            apply_style_pack,
            // dictionary & snippets
            list_dictionary,
            save_dictionary_entry,
            delete_dictionary_entry,
            list_snippets,
            save_snippet,
            delete_snippet,
            // history & stats
            list_history,
            update_history_entry,
            delete_history_entry,
            clear_history,
            get_stats,
            // dictation
            run_dictation,
            get_pending_dictation,
            retry_pending_dictation,
            discard_pending_dictation,
            polish_text,
            preview_transcript,
            rewrite_selection,
            export_diagnostics,
            insert_text,
            // probes
            probe_local_asr,
            test_provider_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::should_show_main;

    #[test]
    fn normal_launch_always_shows_the_window() {
        assert!(should_show_main(false, true));
        assert!(should_show_main(false, false));
    }

    #[test]
    fn background_launch_stays_hidden_only_after_setup() {
        assert!(!should_show_main(true, true));
        assert!(should_show_main(true, false));
    }
}
