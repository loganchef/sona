use tauri::AppHandle;

use super::storage;
use crate::{model::DictionaryEntry, util::constants::DICTIONARY_FILE};

pub async fn load(app: &AppHandle) -> Result<Vec<DictionaryEntry>, String> {
    Ok(
        storage::read_json::<Vec<DictionaryEntry>>(app, DICTIONARY_FILE)
            .await?
            .unwrap_or_default(),
    )
}

pub async fn save(app: &AppHandle, entries: &[DictionaryEntry]) -> Result<(), String> {
    storage::write_json(app, DICTIONARY_FILE, &entries.to_vec()).await
}
