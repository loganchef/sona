use tauri::AppHandle;

use crate::{
    dao,
    model::{AppState, HistoryEntry},
};

/// Hard cap on stored dictations; older entries roll off so the JSON document
/// stays small enough to load at startup on a phone.
const HISTORY_LIMIT: usize = 500;

pub fn list(state: &AppState, limit: Option<usize>) -> Vec<HistoryEntry> {
    let entries = state.history.lock().unwrap();
    let take = limit.unwrap_or(HISTORY_LIMIT).min(HISTORY_LIMIT);
    entries.iter().rev().take(take).cloned().collect()
}

pub async fn push(entry: HistoryEntry, app: &AppHandle, state: &AppState) -> Result<(), String> {
    let mut entries = state.history.lock().unwrap().clone();
    entries.push(entry);
    if entries.len() > HISTORY_LIMIT {
        let overflow = entries.len() - HISTORY_LIMIT;
        entries.drain(0..overflow);
    }

    dao::history::save(app, &entries).await?;
    *state.history.lock().unwrap() = entries;
    Ok(())
}

/// Rewrite one entry's final text. The user fixing a word here is the honest
/// version of "learn from edits": nothing is read from other applications, and
/// the change stays in our own history.
pub async fn update_text(
    id: String,
    text: String,
    app: &AppHandle,
    state: &AppState,
) -> Result<HistoryEntry, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("history_text_required".into());
    }

    let mut entries = state.history.lock().unwrap().clone();
    let index = entries
        .iter()
        .position(|entry| entry.id == id)
        .ok_or_else(|| "history_not_found".to_string())?;

    let entry = &mut entries[index];
    entry.text = trimmed.clone();
    entry.chars = trimmed.chars().count() as u32;
    entry.edited = true;
    let updated = entry.clone();

    dao::history::save(app, &entries).await?;
    *state.history.lock().unwrap() = entries;
    Ok(updated)
}

pub async fn delete(id: String, app: &AppHandle, state: &AppState) -> Result<(), String> {
    let mut entries = state.history.lock().unwrap().clone();
    entries.retain(|entry| entry.id != id);
    dao::history::save(app, &entries).await?;
    *state.history.lock().unwrap() = entries;
    Ok(())
}

pub async fn clear(app: &AppHandle, state: &AppState) -> Result<(), String> {
    dao::history::save(app, &[]).await?;
    *state.history.lock().unwrap() = Vec::new();
    Ok(())
}
