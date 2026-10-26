use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub created_at: String,
    /// Verbatim ASR output.
    pub raw: String,
    /// What actually reached the cursor.
    pub text: String,
    pub mode: String,
    pub asr_model: String,
    pub polish_model: String,
    pub duration_ms: u64,
    pub asr_ms: u64,
    pub polish_ms: u64,
    pub chars: u32,
    #[serde(default)]
    pub app: String,
    #[serde(default)]
    pub inserted: bool,
    #[serde(default)]
    pub copied: bool,
    /// The user fixed the text by hand in history.
    #[serde(default)]
    pub edited: bool,
}

/// One day of activity, for the little bar strip on the dashboard.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    pub date: String,
    pub count: u32,
    pub chars: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub today_count: u32,
    pub today_chars: u32,
    pub today_seconds: u32,
    pub total_count: u32,
    pub avg_asr_ms: u64,
    pub avg_polish_ms: u64,
    /// Rough typing-time saved: chars / 4 per second, minus the seconds spoken.
    pub saved_minutes: u32,
    pub streak_days: u32,
    /// Characters per minute of speech, today.
    pub chars_per_min: u32,
    /// Last 14 days, oldest first, zeros included.
    pub days: Vec<DayStat>,
}
