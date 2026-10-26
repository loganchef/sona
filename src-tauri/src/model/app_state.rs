use std::sync::Mutex;

use super::{AppSettings, DictionaryEntry, HistoryEntry, PendingDictation, Snippet};

/// Warm caches over the JSON documents on disk. Disk stays the source of truth;
/// these mutexes exist so list commands do not re-read files on every invoke.
pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub dictionary: Mutex<Vec<DictionaryEntry>>,
    pub history: Mutex<Vec<HistoryEntry>>,
    pub snippets: Mutex<Vec<Snippet>>,
    /// Last take that failed after recording; kept in memory for a retry.
    pub pending: Mutex<Option<PendingDictation>>,
    pub loaded: Mutex<bool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(AppSettings::default()),
            dictionary: Mutex::new(Vec::new()),
            history: Mutex::new(Vec::new()),
            snippets: Mutex::new(Vec::new()),
            pending: Mutex::new(None),
            loaded: Mutex::new(false),
        }
    }
}
