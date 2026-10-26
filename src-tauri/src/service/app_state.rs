use tauri::AppHandle;

use crate::{dao, model::AppState, service::settings as settings_service};

/// Warm the in-memory caches from disk. Called once during `setup`.
pub async fn initialize(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let settings = settings_service::load_settings(app).await?;
    *state.settings.lock().unwrap() = settings;

    ensure_loaded(app, state).await
}

/// Load every JSON document exactly once, even if the first command arrives
/// before `initialize` finished.
pub async fn ensure_loaded(app: &AppHandle, state: &AppState) -> Result<(), String> {
    if *state.loaded.lock().unwrap() {
        return Ok(());
    }

    let dictionary = dao::dictionary::load(app).await?;
    *state.dictionary.lock().unwrap() = dictionary;

    let history = dao::history::load(app).await?;
    *state.history.lock().unwrap() = history;

    let snippets = dao::snippet::load(app).await?;
    *state.snippets.lock().unwrap() = snippets;

    *state.loaded.lock().unwrap() = true;
    Ok(())
}
