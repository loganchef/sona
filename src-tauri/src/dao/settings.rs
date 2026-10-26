use tauri::AppHandle;

use super::storage;
use crate::{model::AppSettings, util::constants::SETTINGS_FILE};

pub async fn load_settings(app: &AppHandle) -> Result<Option<AppSettings>, String> {
    storage::read_json::<AppSettings>(app, SETTINGS_FILE).await
}

pub async fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    storage::write_json(app, SETTINGS_FILE, settings).await
}
