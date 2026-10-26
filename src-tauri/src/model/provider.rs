use serde::{Deserialize, Serialize};

/// One OpenAI-compatible endpoint (ASR or chat) with its credential.
///
/// `preset` only decides the defaults; `base_url` and `model` stay editable so
/// self-hosted gateways (vLLM, LiteLLM, one-api) work without a code change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    #[serde(default)]
    pub preset: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            preset: "none".into(),
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
        }
    }
}

impl ProviderSettings {
    /// Local and self-hosted gateways often have no auth; the named presets do.
    /// Keeping this list in one place stops the UI and the pipeline from
    /// disagreeing about whether a provider is ready.
    pub fn needs_key(&self) -> bool {
        !matches!(self.preset.trim(), "" | "none" | "custom" | "local")
    }

    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty()
            && !self.model.trim().is_empty()
            && (!self.needs_key() || !self.api_key.trim().is_empty())
    }

    /// Normalised base URL without a trailing slash, so `format!("{base}/path")`
    /// never produces a double slash that some gateways 404 on.
    pub fn endpoint(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.base_url.trim().trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_handles_trailing_slash() {
        let provider = ProviderSettings {
            base_url: "https://api.example.com/v1/".into(),
            model: "m".into(),
            ..Default::default()
        };
        assert_eq!(
            provider.endpoint("/audio/transcriptions"),
            "https://api.example.com/v1/audio/transcriptions"
        );
    }

    #[test]
    fn requires_endpoint_model_and_key_when_the_preset_needs_one() {
        let provider = ProviderSettings {
            base_url: "https://api.example.com/v1".into(),
            ..Default::default()
        };
        assert!(!provider.is_configured());

        let mut keyed = ProviderSettings {
            preset: "groq".into(),
            base_url: "https://api.groq.com/openai/v1".into(),
            model: "whisper-large-v3-turbo".into(),
            api_key: String::new(),
        };
        assert!(!keyed.is_configured());
        keyed.api_key = "sk-test".into();
        assert!(keyed.is_configured());

        let custom = ProviderSettings {
            preset: "custom".into(),
            base_url: "http://127.0.0.1:8000/v1".into(),
            model: "whisper".into(),
            api_key: String::new(),
        };
        assert!(custom.is_configured());
    }
}
