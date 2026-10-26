use serde::{Deserialize, Serialize};

use super::{ProviderSettings, StylePack};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub onboarded: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            language: default_language(),
            onboarded: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_surface")]
    pub surface: String,
    #[serde(default)]
    pub compact: bool,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            surface: default_surface(),
            compact: false,
            page_size: default_page_size(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeySettings {
    #[serde(default = "default_dictate_hotkey")]
    pub dictate: String,
    #[serde(default = "default_cancel_hotkey")]
    pub cancel: String,
    #[serde(default = "default_ask_hotkey")]
    pub ask: String,
    /// Cycle through style packs without opening the app.
    #[serde(default = "default_style_hotkey")]
    pub style: String,
}

impl Default for HotkeySettings {
    fn default() -> Self {
        Self {
            dictate: default_dictate_hotkey(),
            cancel: default_cancel_hotkey(),
            ask: default_ask_hotkey(),
            style: default_style_hotkey(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAsrSettings {
    #[serde(default)]
    pub enabled: bool,
    /// Any OpenAI-compatible server on this machine (faster-whisper-server,
    /// whisper.cpp's server, LM Studio…). Empty key is fine — it is local.
    #[serde(default = "default_local_asr_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub model_dir: String,
}

fn default_local_asr_base_url() -> String {
    "http://127.0.0.1:8080/v1".into()
}

impl Default for LocalAsrSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: default_local_asr_base_url(),
            model: String::new(),
            model_dir: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSettings {
    /// raw | light | structured | formal
    #[serde(default = "default_mode")]
    pub mode: String,
    /// auto | zh-CN | en
    #[serde(default = "default_output_language")]
    pub output_language: String,
    #[serde(default)]
    pub asr: ProviderSettings,
    #[serde(default)]
    pub polish: ProviderSettings,
    /// paste | copy
    #[serde(default = "default_insert")]
    pub insert: String,
    /// Characters of surrounding text sent as polish context; 0 disables it.
    #[serde(default = "default_context_chars")]
    pub context_chars: u32,
    #[serde(default = "default_true")]
    pub dictionary_enabled: bool,
    #[serde(default)]
    pub hotkeys: HotkeySettings,
    #[serde(default)]
    pub local_asr: LocalAsrSettings,
    /// Extra instruction appended to the polish prompt — the user's own style.
    #[serde(default)]
    pub custom_instruction: String,
    /// Named mode + instruction combinations authored by the user. Built-ins
    /// live in `service::style_pack` and are never persisted.
    #[serde(default)]
    pub style_packs: Vec<StylePack>,
    /// Id of the pack last applied; only an id, so renaming a pack is cheap.
    #[serde(default)]
    pub active_style_pack: String,
    /// Packs the global style hotkey should skip. An explicit exclusion list
    /// keeps the default "cycle everything" behaviour for older settings and
    /// lets a new built-in join the cycle without a migration.
    #[serde(default)]
    pub excluded_style_packs: Vec<String>,
    /// Show a provisional transcript while the user is still speaking.
    #[serde(default)]
    pub live_preview: bool,
    /// Short blips when the microphone opens and closes.
    #[serde(default = "default_true")]
    pub sound_feedback: bool,
    /// Hold the dictate hotkey to talk instead of tapping it to start and stop.
    ///
    /// Fresh installs default to hold, matching the product promise. The
    /// `serde(default)` above deliberately stays `false`, so a settings file
    /// written before this field existed keeps the tap behaviour its owner
    /// learned instead of changing under them.
    #[serde(default)]
    pub hold_to_talk: bool,
    /// Stop recording by itself once the speaker has been quiet for `silence_ms`.
    #[serde(default = "default_true")]
    pub auto_stop: bool,
    #[serde(default = "default_silence_ms")]
    pub silence_ms: u32,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            mode: default_mode(),
            output_language: default_output_language(),
            asr: ProviderSettings::default(),
            polish: ProviderSettings::default(),
            insert: default_insert(),
            context_chars: default_context_chars(),
            dictionary_enabled: true,
            hotkeys: HotkeySettings::default(),
            local_asr: LocalAsrSettings::default(),
            custom_instruction: String::new(),
            style_packs: Vec::new(),
            active_style_pack: String::new(),
            excluded_style_packs: Vec::new(),
            live_preview: false,
            sound_feedback: true,
            hold_to_talk: true,
            auto_stop: true,
            silence_ms: default_silence_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub ui: UiSettings,
    #[serde(default)]
    pub voice: VoiceSettings,
}

pub const THEMES: [&str; 3] = ["light", "dark", "system"];
pub const SURFACES: [&str; 2] = ["solid", "glass"];
pub const LANGUAGES: [&str; 2] = ["en", "zh-CN"];
pub const MODES: [&str; 4] = ["raw", "light", "structured", "formal"];
pub const OUTPUT_LANGUAGES: [&str; 3] = ["auto", "zh-CN", "en"];
pub const INSERT_STRATEGIES: [&str; 2] = ["paste", "copy"];

fn default_language() -> String {
    "en".into()
}

fn default_theme() -> String {
    "system".into()
}

fn default_surface() -> String {
    "solid".into()
}

fn default_page_size() -> u32 {
    20
}

fn default_mode() -> String {
    "light".into()
}

fn default_output_language() -> String {
    "auto".into()
}

fn default_insert() -> String {
    "paste".into()
}

fn default_context_chars() -> u32 {
    300
}

fn default_silence_ms() -> u32 {
    1_200
}

fn default_true() -> bool {
    true
}

fn default_dictate_hotkey() -> String {
    // A bare modifier (right Option / right Alt) is what the commercial tools
    // use, but the global-shortcut plugin only accepts full accelerators, and
    // registering a bare key would swallow it system-wide.
    "Alt+Space".into()
}

fn default_cancel_hotkey() -> String {
    "Escape".into()
}

fn default_ask_hotkey() -> String {
    "Alt+Enter".into()
}

fn default_style_hotkey() -> String {
    "Alt+Shift+P".into()
}
