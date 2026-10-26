use serde::{Deserialize, Serialize};

use super::HistoryEntry;

/// Audio arrives base64-encoded because Tauri's JSON bridge handles that far
/// better than a byte array, and every client (desktop, Android, iOS) can
/// produce it the same way.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationRequest {
    pub audio_base64: String,
    #[serde(default = "default_mime")]
    pub mime: String,
    #[serde(default)]
    pub duration_ms: u64,
    /// Milliseconds of actual voice detected in the recording (client-side VAD).
    /// Used to tell a real sentence from a hallucinated subtitle on silence.
    #[serde(default)]
    pub voiced_ms: u64,
    /// Foreground application name, used for history labels only.
    #[serde(default)]
    pub app: String,
    /// Text around the caret; trimmed to `contextChars` before it leaves the device.
    #[serde(default)]
    pub context: String,
    /// "auto" | "zh-CN" | "en"; overrides settings when present.
    #[serde(default)]
    pub output_language: Option<String>,
}

fn default_mime() -> String {
    "audio/webm".into()
}

/// A dictation that failed somewhere after the audio was captured.
///
/// The bytes stay in memory only: they are never written to disk, never listed
/// in history, and disappear when the app quits. Retrying is one click, with the
/// same audio the user already spoke.
#[derive(Debug, Clone)]
pub struct PendingDictation {
    pub request: DictationRequest,
    pub error: String,
    pub created_at: String,
}

impl PendingDictation {
    /// Metadata only: the audio and the caret context never cross the bridge.
    pub fn info(&self) -> PendingInfo {
        PendingInfo {
            error: self.error.clone(),
            created_at: self.created_at.clone(),
            duration_ms: self.request.duration_ms,
            app: self.request.app.clone(),
        }
    }
}

/// What the UI is allowed to see about the pending take — no audio, no context.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInfo {
    pub error: String,
    pub created_at: String,
    pub duration_ms: u64,
    pub app: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertOutcome {
    pub inserted: bool,
    pub copied: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationResult {
    pub entry: HistoryEntry,
    pub text: String,
    pub raw: String,
    pub insert: InsertOutcome,
}
