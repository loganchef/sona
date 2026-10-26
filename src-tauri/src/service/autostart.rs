use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

/// Read the real OS registration instead of a settings flag. The user can remove
/// the login item outside Sona (System Settings, Task Manager, autostart files),
/// so the OS remains the source of truth.
pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| format!("autostart_state: {error}"))
}

/// Enable or disable launch-at-login and return what the OS reports afterwards.
pub fn set_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|error| format!("autostart_set: {error}"))?;

    manager
        .is_enabled()
        .map_err(|error| format!("autostart_state: {error}"))
}
