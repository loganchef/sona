use serde::{Deserialize, Serialize};

/// A named combination of polish mode and extra instruction.
///
/// Built-in packs are generated on demand and never written to disk; only the
/// user's own packs live in `VoiceSettings::style_packs`. `builtin` exists so
/// the UI can hide edit/delete on rows it does not own.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StylePack {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub instruction: String,
    #[serde(default)]
    pub builtin: bool,
}

fn default_mode() -> String {
    "light".into()
}
