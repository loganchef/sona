use tauri::AppHandle;

use super::storage;
use crate::{model::Snippet, util::constants::SNIPPETS_FILE};

pub async fn load(app: &AppHandle) -> Result<Vec<Snippet>, String> {
    Ok(storage::read_json::<Vec<Snippet>>(app, SNIPPETS_FILE)
        .await?
        .unwrap_or_default())
}

pub async fn save(app: &AppHandle, snippets: &[Snippet]) -> Result<(), String> {
    storage::write_json(app, SNIPPETS_FILE, &snippets.to_vec()).await
}
