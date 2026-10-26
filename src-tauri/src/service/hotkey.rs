use serde::Serialize;

use crate::model::VoiceSettings;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    /// False on mobile, where there is no global keyboard hook.
    pub supported: bool,
    pub registered: Vec<String>,
    pub failed: Vec<HotkeyFailure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyFailure {
    pub accelerator: String,
    pub reason: String,
}

/// What is registered right now, without touching the system.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn status(app: &tauri::AppHandle, settings: &VoiceSettings) -> HotkeyStatus {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let manager = app.global_shortcut();
    let mut status = HotkeyStatus {
        supported: true,
        ..Default::default()
    };

    for accelerator in [
        &settings.hotkeys.dictate,
        &settings.hotkeys.ask,
        &settings.hotkeys.style,
    ] {
        if !is_registerable(accelerator) {
            status.failed.push(HotkeyFailure {
                accelerator: accelerator.clone(),
                reason: "needs_modifier".into(),
            });
            continue;
        }
        match manager.is_registered(accelerator.as_str()) {
            true => status.registered.push(accelerator.clone()),
            false => status.failed.push(HotkeyFailure {
                accelerator: accelerator.clone(),
                reason: "not_registered".into(),
            }),
        }
    }

    status
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn status(_app: &tauri::AppHandle, _settings: &VoiceSettings) -> HotkeyStatus {
    HotkeyStatus::default()
}

/// An accelerator is only safe to register globally when it carries a modifier or
/// is a function/media key. Registering a bare `Escape` would swallow the key for
/// every application on the system.
pub fn is_registerable(accelerator: &str) -> bool {
    let trimmed = accelerator.trim();
    if trimmed.is_empty() {
        return false;
    }

    if trimmed.contains('+') {
        return true;
    }

    let upper = trimmed.to_ascii_uppercase();
    (upper.starts_with('F') && upper[1..].parse::<u8>().is_ok())
        || upper.starts_with("MEDIA")
        || upper.starts_with("AUDIOVOLUME")
}

/// What a press or release means for dictation.
///
/// Toggle mode must ignore the release: otherwise every tap would start and
/// stop the take in the same instant. Hold mode needs both edges.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DictateStep {
    Start,
    Stop,
    Toggle,
    Ignore,
}

fn dictate_step(hold_to_talk: bool, pressed: bool) -> DictateStep {
    match (hold_to_talk, pressed) {
        (true, true) => DictateStep::Start,
        (true, false) => DictateStep::Stop,
        (false, true) => DictateStep::Toggle,
        (false, false) => DictateStep::Ignore,
    }
}

/// Park the capsule at the lower third of the screen the user is looking at.
/// It is deliberately not focused: the app the user was typing in keeps focus so
/// the synthetic paste lands in the right place.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn place_capsule(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };

    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let position = monitor.position().to_logical::<f64>(scale);
    let capsule = window
        .outer_size()
        .map(|value| value.to_logical::<f64>(scale))
        .unwrap_or(tauri::LogicalSize::new(460.0, 120.0));

    let x = position.x + (size.width - capsule.width) / 2.0;
    let y = position.y + size.height - capsule.height - 180.0;

    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn apply(app: &tauri::AppHandle, settings: &VoiceSettings) -> HotkeyStatus {
    use tauri::{Emitter, Manager};
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let mut status = HotkeyStatus {
        supported: true,
        ..Default::default()
    };

    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    let bindings = [
        ("dictate", settings.hotkeys.dictate.clone()),
        ("ask", settings.hotkeys.ask.clone()),
        ("style", settings.hotkeys.style.clone()),
    ];

    for (action, accelerator) in bindings {
        if !is_registerable(&accelerator) {
            status.failed.push(HotkeyFailure {
                accelerator,
                reason: "needs_modifier".into(),
            });
            continue;
        }

        let action_owned = action.to_string();
        let accelerator_owned = accelerator.clone();

        let hold_to_talk = settings.hold_to_talk;
        let result = manager.on_shortcut(accelerator.as_str(), move |app, _shortcut, event| {
            let pressed = event.state() == ShortcutState::Pressed;

            // The selection hotkey is a different job: copy what is selected,
            // rewrite it, paste it back. It must not wake the recording capsule,
            // or focus would leave the text we are about to replace. A release
            // here is noise.
            if action_owned == "ask" {
                if !pressed {
                    return;
                }
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<crate::model::AppState>();
                    match crate::service::selection::rewrite(&handle, state.inner(), None, None)
                        .await
                    {
                        Ok(outcome) => {
                            let _ = handle.emit("sona://selection", outcome);
                        }
                        Err(reason) => {
                            let _ = handle.emit(
                                "sona://selection-error",
                                serde_json::json!({ "reason": reason }),
                            );
                        }
                    }
                });
                return;
            }

            // The style hotkey is a one-shot switch. It does not open the
            // microphone; the capsule only reports which pack is now active.
            if action_owned == "style" {
                if !pressed {
                    return;
                }

                // The capsule is usually hidden while the user is not
                // dictating. Show it for a moment so switching packs has a
                // visible confirmation instead of a silent settings change.
                if let Some(capsule) = app.get_webview_window("capsule") {
                    place_capsule(&capsule);
                    let _ = capsule.show();
                }

                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<crate::model::AppState>();
                    match crate::service::settings::cycle_style_pack(&handle, state.inner()).await {
                        Ok(pack) => {
                            let _ = handle.emit("sona://style-pack", pack);
                        }
                        Err(reason) => {
                            let _ = handle.emit(
                                "sona://style-pack-error",
                                serde_json::json!({ "reason": reason }),
                            );
                        }
                    }
                });
                return;
            }

            let step = dictate_step(hold_to_talk, pressed);
            if step == DictateStep::Ignore {
                return;
            }

            // Wake the floating capsule before the recording starts. On release
            // it is already visible, so there is nothing to do.
            if step != DictateStep::Stop {
                if let Some(capsule) = app.get_webview_window("capsule") {
                    place_capsule(&capsule);
                    let _ = capsule.show();
                }
            }

            let action = match step {
                DictateStep::Start => "dictate-start",
                DictateStep::Stop => "dictate-stop",
                DictateStep::Toggle => "dictate",
                DictateStep::Ignore => return,
            };

            let _ = app.emit(
                "sona://hotkey",
                serde_json::json!({
                    "action": action,
                    "accelerator": accelerator_owned,
                }),
            );
        });

        match result {
            Ok(()) => status.registered.push(accelerator),
            Err(error) => status.failed.push(HotkeyFailure {
                accelerator,
                reason: error.to_string(),
            }),
        }
    }

    status
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn apply(_app: &tauri::AppHandle, _settings: &VoiceSettings) -> HotkeyStatus {
    HotkeyStatus {
        supported: false,
        registered: Vec::new(),
        failed: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{dictate_step, is_registerable, DictateStep};

    #[test]
    fn rejects_bare_keys() {
        assert!(!is_registerable("Escape"));
        assert!(!is_registerable(""));
        assert!(!is_registerable("A"));
    }

    #[test]
    fn hold_mode_starts_on_press_and_stops_on_release() {
        assert_eq!(dictate_step(true, true), DictateStep::Start);
        assert_eq!(dictate_step(true, false), DictateStep::Stop);
    }

    #[test]
    fn toggle_mode_ignores_the_release_edge() {
        assert_eq!(dictate_step(false, true), DictateStep::Toggle);
        assert_eq!(dictate_step(false, false), DictateStep::Ignore);
    }

    #[test]
    fn accepts_combinations_and_function_keys() {
        assert!(is_registerable("Alt+Space"));
        assert!(is_registerable("CmdOrControl+Shift+D"));
        assert!(is_registerable("F9"));
        assert!(is_registerable("MediaPlayPause"));
    }
}
