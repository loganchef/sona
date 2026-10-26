use tauri::AppHandle;

use super::storage;
use crate::{model::HistoryEntry, util::constants::HISTORY_FILE};

pub async fn load(app: &AppHandle) -> Result<Vec<HistoryEntry>, String> {
    Ok(storage::read_json::<Vec<HistoryEntry>>(app, HISTORY_FILE)
        .await?
        .unwrap_or_default())
}

pub async fn save(app: &AppHandle, entries: &[HistoryEntry]) -> Result<(), String> {
    storage::write_json(app, HISTORY_FILE, &entries.to_vec()).await
}
