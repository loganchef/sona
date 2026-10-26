use std::time::Instant;

use base64::Engine;
use tauri::AppHandle;

use crate::{
    dao,
    model::{AppState, DictationRequest, DictationResult, HistoryEntry},
    service::{
        app_state, asr, dictionary, history, insert, polish, polish::PolishInput, sanitize,
        settings, snippet,
    },
    util::time::{new_id, now_iso},
};

/// Whole dictation path: decode → transcribe → glossary → polish → insert → history.
pub async fn run(
    request: DictationRequest,
    app: AppHandle,
    state: &AppState,
) -> Result<DictationResult, String> {
    app_state::ensure_loaded(&app, state).await?;

    let voice = settings::get_cached_settings(state).voice;

    // 20 MB of base64 is roughly 15 MB of audio — past every provider's cap.
    if request.audio_base64.len() > 20 * 1024 * 1024 {
        return Err("audio_too_large".into());
    }

    let audio = base64::engine::general_purpose::STANDARD
        .decode(request.audio_base64.as_bytes())
        .map_err(|error| format!("audio_decode: {error}"))?;

    if audio.is_empty() {
        return Err("audio_empty".into());
    }

    if !voice.asr.is_configured() {
        return Err("asr_not_configured".into());
    }

    let asr_started = Instant::now();
    let provider = asr_provider(&voice)?;
    let raw = asr::transcribe(&provider, audio, &request.mime, "auto").await?;
    let asr_ms = asr_started.elapsed().as_millis() as u64;

    // SenseVoice-style models shout every English word; fix that before anything
    // else looks at the text.
    let raw = sanitize::normalize_english_case(raw.trim());

    if raw.trim().is_empty() {
        return Err("no_speech".into());
    }

    // Nothing was said: 「嗯……啊」 is not a dictation.
    if sanitize::is_filler_only(&raw) {
        return Err("no_speech".into());
    }

    // Subtitle boilerplate is invented on silence. A user who really says it
    // has spoken for a while, so the filter only fires on a short recording.
    if request.voiced_ms > 0 && request.voiced_ms < 800 && sanitize::is_stock_phrase(&raw) {
        return Err("no_speech".into());
    }

    let entries = state.dictionary.lock().unwrap().clone();
    let (rewritten, hits) = if voice.dictionary_enabled {
        dictionary::rewrite(&raw, &entries)
    } else {
        (raw.clone(), Vec::new())
    };

    let snippets = state.snippets.lock().unwrap().clone();
    let phrases = if snippets.is_empty() {
        Vec::new()
    } else {
        snippet::phrases(&snippets)
    };

    let target = request
        .output_language
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| voice.output_language.clone());

    let (text, polish_ms, polish_model) =
        if (voice.mode == "raw" && target == "auto") || !voice.polish.is_configured() {
            (rewritten.clone(), 0, "none".to_string())
        } else {
            let glossary = if voice.dictionary_enabled {
                dictionary::glossary(&entries)
            } else {
                Vec::new()
            };
            // Prefer what the caller measured; otherwise read the field we are about
            // to paste into, so tone and terminology match the paragraph around it.
            let context = if request.context.trim().is_empty() {
                super::context::read(&app, voice.context_chars).await
            } else {
                trim_context(&request.context, voice.context_chars)
            };

            let messages = polish::build_messages(&PolishInput {
                mode: &voice.mode,
                output_language: &target,
                context: &context,
                glossary: &glossary,
                phrases: &phrases,
                custom: &voice.custom_instruction,
                raw: &rewritten,
            });

            let polish_started = Instant::now();
            match polish::run(&voice.polish, messages).await {
                Ok(text) => (
                    text,
                    polish_started.elapsed().as_millis() as u64,
                    voice.polish.model.clone(),
                ),
                Err(error) => {
                    // A failed polish must never cost the user their dictation.
                    eprintln!("polish failed, using raw transcript: {error}");
                    (rewritten.clone(), 0, "fallback".to_string())
                }
            }
        };

    // Snippets expand last: the model gets to polish the sentence, then the
    // prepared block replaces the spoken shortcut untouched.
    let (text, snippet_hits) = snippet::expand(&text, &snippets);
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("no_speech".into());
    }

    let outcome = insert::deliver(&app, &text, &voice.insert).await;

    let entry = HistoryEntry {
        id: new_id(),
        created_at: now_iso(),
        raw: raw.clone(),
        text: text.clone(),
        mode: voice.mode.clone(),
        asr_model: voice.asr.model.clone(),
        polish_model,
        duration_ms: request.duration_ms,
        asr_ms,
        polish_ms,
        chars: text.chars().count() as u32,
        app: request.app.clone(),
        inserted: outcome.inserted,
        copied: outcome.copied,
        edited: false,
    };

    history::push(entry.clone(), &app, state).await?;

    if !hits.is_empty() {
        dictionary::bump_hits(state, &hits);
        let updated = state.dictionary.lock().unwrap().clone();
        dao::dictionary::save(&app, &updated).await?;
    }

    if !snippet_hits.is_empty() {
        snippet::bump_hits(state, &snippet_hits);
        let updated = state.snippets.lock().unwrap().clone();
        dao::snippet::save(&app, &updated).await?;
    }

    Ok(DictationResult {
        entry,
        text,
        raw,
        insert: outcome,
    })
}

/// A failure worth retrying with the same audio. Configuration mistakes and
/// "you said nothing" are not: they will fail identically the second time.
pub fn is_retryable(error: &str) -> bool {
    error.starts_with("asr_") && error != "asr_not_configured" && error != "asr_empty"
}

/// Which service transcribes: a local server when the user turned it on,
/// otherwise whatever cloud provider is configured.
pub fn asr_provider(
    voice: &crate::model::VoiceSettings,
) -> Result<crate::model::ProviderSettings, String> {
    if voice.local_asr.enabled {
        if voice.local_asr.model.trim().is_empty() {
            return Err("local_asr_model_missing".into());
        }
        return Ok(crate::model::ProviderSettings {
            preset: "local".into(),
            base_url: voice.local_asr.base_url.clone(),
            api_key: String::new(),
            model: voice.local_asr.model.clone(),
        });
    }

    Ok(voice.asr.clone())
}

/// Transcribe without polishing, pasting or recording history — the live preview.
pub async fn preview_transcript(
    audio_base64: String,
    mime: String,
    state: &AppState,
) -> Result<String, String> {
    if audio_base64.len() > 20 * 1024 * 1024 {
        return Err("audio_too_large".into());
    }

    let audio = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|error| format!("audio_decode: {error}"))?;

    if audio.is_empty() {
        return Err("audio_empty".into());
    }

    let voice = settings::get_cached_settings(state).voice;
    let provider = asr_provider(&voice)?;

    let raw = asr::transcribe(&provider, audio, &mime, "auto").await?;
    Ok(sanitize::normalize_english_case(raw.trim()))
}

/// Polish an arbitrary piece of text (selection rewrite / translate).
pub async fn polish_text(
    text: String,
    mode: Option<String>,
    output_language: Option<String>,
    state: &AppState,
) -> Result<String, String> {
    let voice = settings::get_cached_settings(state).voice;
    if !voice.polish.is_configured() {
        return Err("polish_not_configured".into());
    }

    let mode = mode.unwrap_or_else(|| voice.mode.clone());
    let target = output_language.unwrap_or_else(|| "auto".to_string());
    let entries = state.dictionary.lock().unwrap().clone();
    let glossary = dictionary::glossary(&entries);

    let messages = polish::build_messages(&PolishInput {
        mode: &mode,
        output_language: &target,
        context: "",
        glossary: &glossary,
        phrases: &[],
        custom: &voice.custom_instruction,
        raw: &text,
    });

    polish::run(&voice.polish, messages).await
}

/// Context is "the text before the caret", so the useful part is its tail.
pub fn trim_context(context: &str, limit: u32) -> String {
    if limit == 0 || context.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = context.chars().collect();
    let start = chars.len().saturating_sub(limit as usize);
    chars[start..].iter().collect()
}

#[cfg(test)]
mod tests {
    use super::{asr_provider, is_retryable, trim_context};
    use crate::model::{ProviderSettings, VoiceSettings};

    #[test]
    fn only_transient_asr_failures_keep_the_take() {
        assert!(is_retryable("asr_http_502: upstream unavailable"));
        assert!(is_retryable("asr_timeout"));
        // Retrying these with the same bytes would fail the same way.
        assert!(!is_retryable("asr_not_configured"));
        assert!(!is_retryable("asr_empty"));
        assert!(!is_retryable("no_speech"));
        assert!(!is_retryable("audio_empty"));
        assert!(!is_retryable("polish_http_500: boom"));
    }

    #[test]
    fn local_server_wins_when_enabled() {
        let mut voice = VoiceSettings {
            asr: ProviderSettings {
                preset: "groq".into(),
                base_url: "https://api.groq.com/openai/v1".into(),
                api_key: "sk-x".into(),
                model: "whisper-large-v3".into(),
            },
            ..Default::default()
        };

        assert_eq!(asr_provider(&voice).unwrap().model, "whisper-large-v3");

        voice.local_asr.enabled = true;
        voice.local_asr.model = "Systran/faster-whisper-small".into();
        let local = asr_provider(&voice).unwrap();
        assert_eq!(local.base_url, "http://127.0.0.1:8080/v1");
        assert!(local.api_key.is_empty());
        assert_eq!(local.model, "Systran/faster-whisper-small");

        voice.local_asr.model = "  ".into();
        assert_eq!(asr_provider(&voice).unwrap_err(), "local_asr_model_missing");
    }

    #[test]
    fn keeps_the_tail_of_the_context() {
        assert_eq!(trim_context("abcdef", 3), "def");
        assert_eq!(trim_context("abc", 10), "abc");
        assert_eq!(trim_context("abc", 0), "");
        assert_eq!(trim_context("", 10), "");
    }

    #[test]
    fn counts_characters_not_bytes() {
        assert_eq!(trim_context("你好世界", 2), "世界");
    }
}
