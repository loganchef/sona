//! Read what is selected in the frontmost application.
//!
//! There is no portable "give me the selection" call, so we use the clipboard as
//! a probe: park a sentinel on it, ask the focused app to copy, and look at what
//! comes back. Whatever the user had on the clipboard is put back afterwards —
//! a rewrite must not eat the clipboard.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::model::AppState;
use crate::service::{insert, pipeline, settings as settings_service};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SelectionOutcome {
    pub before: String,
    pub after: String,
    pub inserted: bool,
    pub reason: Option<String>,
}

/// Copy the current selection into `out`, restoring the user's clipboard afterwards.
pub async fn read(app: &AppHandle) -> Result<String, String> {
    let clipboard = app.clipboard();
    let previous = clipboard.read_text().ok();
    let sentinel = format!("sona-probe-{}", uuid::Uuid::new_v4());

    clipboard
        .write_text(sentinel.clone())
        .map_err(|error| format!("clipboard_write_failed: {error}"))?;

    let copied = tauri::async_runtime::spawn_blocking(copy_blocking)
        .await
        .map_err(|error| format!("copy_join: {error}"))?;

    // Give the target app a beat to answer the keystroke.
    tokio::time::sleep(Duration::from_millis(180)).await;

    let captured = clipboard.read_text().unwrap_or_default();
    restore(app, previous);

    copied?;

    if captured == sentinel {
        return Err("no_selection".into());
    }

    let trimmed = captured.trim().to_string();
    if trimmed.is_empty() {
        return Err("no_selection".into());
    }

    Ok(trimmed)
}

fn restore(app: &AppHandle, previous: Option<String>) {
    let clipboard = app.clipboard();
    match previous {
        Some(text) => {
            let _ = clipboard.write_text(text);
        }
        None => {
            let _ = clipboard.clear();
        }
    }
}

/// Rewrite or translate the selection and put the result back in place.
pub async fn rewrite(
    app: &AppHandle,
    state: &AppState,
    mode: Option<String>,
    language: Option<String>,
) -> Result<SelectionOutcome, String> {
    let before = read(app).await?;
    let after = pipeline::polish_text(before.clone(), mode, language, state).await?;

    if after.trim().is_empty() {
        return Err("empty_rewrite".into());
    }

    let strategy = settings_service::get_cached_settings(state).voice.insert;
    let outcome = insert::deliver(app, &after, &strategy).await;

    reveal_capsule(app);

    Ok(SelectionOutcome {
        before,
        after,
        inserted: outcome.inserted,
        reason: outcome.reason,
    })
}

fn reveal_capsule(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("capsule") {
        let _ = window.show();
    }
}

#[cfg(target_os = "macos")]
fn copy_blocking() -> Result<(), String> {
    use std::process::Command;

    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"c\" using command down",
        ])
        .output()
        .map_err(|error| format!("copy_spawn: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "copy_denied: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(target_os = "windows")]
fn copy_blocking() -> Result<(), String> {
    use std::process::Command;

    let script = "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^c')";
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|error| format!("copy_spawn: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "copy_failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn copy_blocking() -> Result<(), String> {
    use std::process::Command;

    // Wayland has no global synthetic key API; X11 does, through xdotool.
    for (program, args) in [
        ("wtype", vec!["-M", "ctrl", "c", "-m", "ctrl"]),
        ("xdotool", vec!["key", "--clearmodifiers", "ctrl+c"]),
    ] {
        if let Ok(output) = Command::new(program).args(&args).output() {
            if output.status.success() {
                return Ok(());
            }
        }
    }

    Err("copy_unavailable".into())
}
