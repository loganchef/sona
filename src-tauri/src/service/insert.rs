use std::process::Command;

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::model::InsertOutcome;

/// Deliver text to the focused application.
///
/// The clipboard is the transport (it survives IMEs, rich editors and remote
/// desktops); a synthetic paste is the trigger. When the synthetic paste is not
/// possible the text stays on the clipboard and the UI says so — losing the
/// dictation is the one outcome we refuse.
pub async fn deliver(app: &AppHandle, text: &str, strategy: &str) -> InsertOutcome {
    if text.trim().is_empty() {
        return InsertOutcome {
            inserted: false,
            copied: false,
            reason: Some("empty".into()),
        };
    }

    let copied = app.clipboard().write_text(text.to_string()).is_ok();
    if !copied {
        return InsertOutcome {
            inserted: false,
            copied: false,
            reason: Some("clipboard_write_failed".into()),
        };
    }

    // The capsule may be frontmost (the user clicked it, or the compositor gave
    // it focus). Hiding it first hands focus back to the app the user was in,
    // so the paste lands where the caret is instead of inside our own webview.
    release_capsule(app);

    if strategy == "copy" {
        return InsertOutcome {
            inserted: false,
            copied: true,
            reason: Some("copy_only".into()),
        };
    }

    match paste().await {
        Ok(()) => InsertOutcome {
            inserted: true,
            copied: true,
            reason: None,
        },
        Err(reason) => InsertOutcome {
            inserted: false,
            copied: true,
            reason: Some(reason),
        },
    }
}

/// Hide the floating capsule and give the previous app a beat to regain focus.
fn release_capsule(app: &AppHandle) {
    #[cfg(desktop)]
    {
        use tauri::Manager;

        if let Some(window) = app.get_webview_window("capsule") {
            let _ = window.hide();
            std::thread::sleep(std::time::Duration::from_millis(160));
        }
    }

    #[cfg(not(desktop))]
    let _ = app;
}

async fn paste() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(paste_blocking)
        .await
        .map_err(|error| format!("paste_join: {error}"))?
}

#[cfg(target_os = "macos")]
fn paste_blocking() -> Result<(), String> {
    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .output()
        .map_err(|error| format!("paste_spawn: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "paste_denied: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(target_os = "windows")]
fn paste_blocking() -> Result<(), String> {
    let script = "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^v')";
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|error| format!("paste_spawn: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "paste_failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn paste_blocking() -> Result<(), String> {
    // X11 first, then Wayland's wtype, then ydotool for compositors without either.
    let attempts: [(&str, &[&str]); 3] = [
        ("xdotool", &["key", "--clearmodifiers", "ctrl+v"]),
        ("wtype", &["-M", "ctrl", "v", "-m", "ctrl"]),
        ("ydotool", &["key", "29:1", "47:1", "47:0", "29:0"]),
    ];

    let mut last = String::from("paste_no_tool");

    for (program, args) in attempts {
        match Command::new(program).args(args).output() {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                last = format!(
                    "paste_{program}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
            Err(error) => last = format!("paste_{program}_missing: {error}"),
        }
    }

    Err(last)
}
