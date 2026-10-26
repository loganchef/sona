//! A bug report bundle that is safe to paste into a public issue.
//!
//! Rules: no API keys, no query strings (they carry keys more often than people
//! think), no dictation text, no dictionary terms — only counts and timings.

use chrono::Local;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::model::AppState;
use crate::service::{settings as settings_service, stats as stats_service};

/// Keep the origin and the path, drop everything that could hold a credential.
pub fn redact_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let without_query = trimmed
        .split(['?', '#'])
        .next()
        .unwrap_or(trimmed)
        .to_string();

    if without_query.contains('@') {
        // https://user:pass@host/v1 → https://host/v1
        let scheme_split = without_query.split_once("://");
        return match scheme_split {
            Some((scheme, rest)) => match rest.split_once('@') {
                Some((_, host)) => format!("{scheme}://{host}"),
                None => without_query,
            },
            None => without_query,
        };
    }

    without_query
}

fn provider_report(provider: &crate::model::ProviderSettings) -> Value {
    json!({
        "preset": provider.preset,
        "baseUrl": redact_url(&provider.base_url),
        "model": provider.model,
        "configured": !provider.api_key.trim().is_empty() && !provider.base_url.trim().is_empty(),
    })
}

pub async fn export(app: &AppHandle, state: &AppState) -> Result<String, String> {
    let settings = settings_service::get_cached_settings(state);
    let dictionary = state.dictionary.lock().unwrap().clone();
    let history = state.history.lock().unwrap().clone();
    let stats = stats_service::compute(&history, Local::now());

    let recent: Vec<Value> = history
        .iter()
        .take(20)
        .map(|entry| {
            json!({
                "createdAt": entry.created_at,
                "mode": entry.mode,
                "chars": entry.chars,
                "durationMs": entry.duration_ms,
                "asrMs": entry.asr_ms,
                "polishMs": entry.polish_ms,
                "app": entry.app,
                "inserted": entry.inserted,
                "copied": entry.copied,
                "edited": entry.edited,
            })
        })
        .collect();

    let bundle = json!({
        "generatedAt": Local::now().to_rfc3339(),
        "app": {
            "name": env!("CARGO_PKG_NAME"),
            "version": env!("CARGO_PKG_VERSION"),
            "tauri": tauri::VERSION,
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        },
        "settings": {
            "general": { "language": settings.general.language, "onboarded": settings.general.onboarded },
            "ui": settings.ui,
            "voice": {
                "mode": settings.voice.mode,
                "outputLanguage": settings.voice.output_language,
                "insert": settings.voice.insert,
                "contextChars": settings.voice.context_chars,
                "dictionaryEnabled": settings.voice.dictionary_enabled,
                "autoStop": settings.voice.auto_stop,
                "silenceMs": settings.voice.silence_ms,
                "customInstructionChars": settings.voice.custom_instruction.chars().count(),
                "hotkeys": settings.voice.hotkeys,
                "localAsr": { "enabled": settings.voice.local_asr.enabled, "model": settings.voice.local_asr.model },
                "asr": provider_report(&settings.voice.asr),
                "polish": provider_report(&settings.voice.polish),
            },
        },
        "hotkeys": super::hotkey::status(app, &settings.voice),
        "dictionary": { "entries": dictionary.len(), "enabled": dictionary.iter().filter(|e| e.enabled).count() },
        "stats": stats,
        "recentHistory": recent,
    });

    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let directory = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|error| format!("no_export_dir: {error}"))?;
    let path = directory.join(format!("sona-diagnostics-{stamp}.json"));

    let serialized = serde_json::to_string_pretty(&bundle).map_err(|error| error.to_string())?;
    std::fs::write(&path, serialized).map_err(|error| format!("export_write_failed: {error}"))?;

    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::redact_url;

    #[test]
    fn keeps_the_endpoint_and_drops_secrets() {
        assert_eq!(
            redact_url("https://api.example.com/v1?api_key=sk-123"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            redact_url("https://user:pass@api.example.com/v1"),
            "https://api.example.com/v1"
        );
        assert_eq!(redact_url("  "), "");
        assert_eq!(
            redact_url("http://127.0.0.1:8080/v1"),
            "http://127.0.0.1:8080/v1"
        );
    }
}
