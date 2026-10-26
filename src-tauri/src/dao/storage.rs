use std::path::PathBuf;

use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager};

/// Resolve (and lazily create) the per-user application data directory.
pub async fn get_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))
}

/// Read and deserialize a JSON document. `Ok(None)` means "not created yet".
pub async fn read_json<T: DeserializeOwned>(
    app: &AppHandle,
    file_name: &str,
) -> Result<Option<T>, String> {
    let path = get_app_data_dir(app).await?.join(file_name);

    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {file_name}: {error}"))?;

    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| format!("failed to parse {file_name}: {error}"))
}

/// Serialize a value as pretty JSON into the application data directory.
///
/// The file is created with owner-only permissions on unix: settings carry API
/// keys, and a world-readable config is the classic way to leak them.
pub async fn write_json<T: Serialize>(
    app: &AppHandle,
    file_name: &str,
    value: &T,
) -> Result<(), String> {
    let dir = get_app_data_dir(app).await?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("failed to create data dir: {error}"))?;

    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize {file_name}: {error}"))?;

    let path = dir.join(file_name);
    std::fs::write(&path, raw).map_err(|error| format!("failed to write {file_name}: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(())
}
