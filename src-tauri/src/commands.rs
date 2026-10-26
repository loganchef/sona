use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    model::{
        AppSettings, AppState, DictationRequest, DictationResult, DictionaryEntry, DictionaryInput,
        HistoryEntry, InsertOutcome, PendingDictation, PendingInfo, ProviderSettings, Snippet,
        SnippetInput, Stats, StylePack,
    },
    service::{
        self, asr, dictionary, history, hotkey, pipeline, polish, settings as settings_service,
        snippet, stats, style_pack,
    },
    util::time::now_iso,
};

#[derive(Serialize)]
pub struct SettingsResponse {
    pub success: bool,
    pub settings: AppSettings,
}

// ---------------------------------------------------------------- style ---

/// Built-in voices are generated from the current UI language, so this list
/// can change when the user switches language without touching their packs.
#[tauri::command]
pub async fn list_style_packs(state: State<'_, AppState>) -> Result<Vec<StylePack>, String> {
    Ok(style_pack::list(&settings_service::get_cached_settings(
        state.inner(),
    )))
}

#[tauri::command]
pub async fn apply_style_pack(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SettingsResponse, String> {
    let settings = settings_service::activate_style_pack(id, &app, state.inner()).await?;
    Ok(SettingsResponse {
        success: true,
        settings,
    })
}

// ---------------------------------------------------------------- system ---

/// Launch-at-login is a desktop concern; mobile shells have no such concept.
#[tauri::command]
pub async fn get_autostart(app: AppHandle) -> Result<bool, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        service::autostart::is_enabled(&app)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        service::autostart::set_enabled(&app, enabled)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, enabled);
        Ok(false)
    }
}

/// Build metadata used by the About section and platform detection.
#[tauri::command]
pub async fn get_app_info() -> Result<Value, String> {
    let platform = tauri_plugin_os::platform();
    let desktop = !(platform == "android" || platform == "ios");

    Ok(serde_json::json!({
        "name": "Sona",
        "version": env!("CARGO_PKG_VERSION"),
        "platform": platform,
        "family": tauri_plugin_os::family(),
        "isMobile": !desktop,
        "secrets": service::secrets::backend(),
        "features": {
            "globalHotkey": desktop,
            "autostart": desktop,
            "syntheticPaste": desktop,
            "localAsr": false,
            "floatingCapsule": desktop,
        }
    }))
}

/// OS locale, used to pick an initial language on first launch.
#[tauri::command]
pub async fn get_system_locale() -> Result<String, String> {
    Ok(tauri_plugin_os::locale().unwrap_or_else(|| "en-US".to_string()))
}

// -------------------------------------------------------------- settings ---

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<SettingsResponse, String> {
    Ok(SettingsResponse {
        success: true,
        settings: settings_service::get_cached_settings(state.inner()),
    })
}

#[tauri::command]
pub async fn update_setting(
    key: String,
    value: Value,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SettingsResponse, String> {
    let settings = settings_service::update_setting(key.clone(), value, app.clone(), state).await?;

    if key == "voice" {
        // Hotkeys live in the OS, so a settings change has to re-register them.
        let status = hotkey::apply(&app, &settings.voice);
        if !status.failed.is_empty() {
            eprintln!("hotkey registration issues: {:?}", status.failed);
        }
    }

    Ok(SettingsResponse {
        success: true,
        settings,
    })
}

#[tauri::command]
pub async fn reset_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SettingsResponse, String> {
    let settings = settings_service::reset_settings(app.clone(), state).await?;
    let _ = hotkey::apply(&app, &settings.voice);

    Ok(SettingsResponse {
        success: true,
        settings,
    })
}

/// Whether the OS actually accepted our global shortcuts.
#[tauri::command]
pub async fn get_hotkey_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<hotkey::HotkeyStatus, String> {
    let settings = settings_service::get_cached_settings(state.inner());
    Ok(hotkey::apply(&app, &settings.voice))
}

// ------------------------------------------------------------ dictionary ---

#[tauri::command]
pub async fn list_dictionary(state: State<'_, AppState>) -> Result<Vec<DictionaryEntry>, String> {
    Ok(dictionary::list(state.inner()))
}

#[tauri::command]
pub async fn save_dictionary_entry(
    id: Option<String>,
    input: DictionaryInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DictionaryEntry, String> {
    dictionary::upsert(id, input, &app, state.inner()).await
}

#[tauri::command]
pub async fn delete_dictionary_entry(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    dictionary::delete(id, &app, state.inner()).await
}

// --------------------------------------------------------------- snippets ---

#[tauri::command]
pub async fn list_snippets(state: State<'_, AppState>) -> Result<Vec<Snippet>, String> {
    Ok(snippet::list(state.inner()))
}

#[tauri::command]
pub async fn save_snippet(
    id: Option<String>,
    input: SnippetInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Snippet, String> {
    snippet::upsert(id, input, &app, state.inner()).await
}

#[tauri::command]
pub async fn delete_snippet(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    snippet::delete(id, &app, state.inner()).await
}

// --------------------------------------------------------------- history ---

#[tauri::command]
pub async fn list_history(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<HistoryEntry>, String> {
    Ok(history::list(state.inner(), limit))
}

#[tauri::command]
pub async fn update_history_entry(
    id: String,
    text: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<HistoryEntry, String> {
    service::history::update_text(id, text, &app, state.inner()).await
}

#[tauri::command]
pub async fn delete_history_entry(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    history::delete(id, &app, state.inner()).await
}

#[tauri::command]
pub async fn clear_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    history::clear(&app, state.inner()).await
}

#[tauri::command]
pub async fn get_stats(state: State<'_, AppState>) -> Result<Stats, String> {
    let entries = state.history.lock().unwrap().clone();
    Ok(stats::compute(&entries, chrono::Local::now()))
}

// -------------------------------------------------------------- dictation ---

#[tauri::command]
pub async fn run_dictation(
    request: DictationRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DictationResult, String> {
    let inner = state.inner();

    match pipeline::run(request.clone(), app, inner).await {
        Ok(result) => {
            // A successful take makes an older failure irrelevant.
            *state.pending.lock().unwrap() = None;
            Ok(result)
        }
        Err(error) => {
            if pipeline::is_retryable(&error) {
                *state.pending.lock().unwrap() = Some(PendingDictation {
                    request,
                    error: error.clone(),
                    created_at: now_iso(),
                });
            }
            Err(error)
        }
    }
}

/// The take that failed after recording, if any. Audio stays in memory.
#[tauri::command]
pub async fn get_pending_dictation(
    state: State<'_, AppState>,
) -> Result<Option<PendingInfo>, String> {
    Ok(state
        .pending
        .lock()
        .unwrap()
        .as_ref()
        .map(PendingDictation::info))
}

/// Run the kept take again, from the audio the user already spoke.
#[tauri::command]
pub async fn retry_pending_dictation(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DictationResult, String> {
    let pending = state
        .pending
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "pending_not_found".to_string())?;

    match pipeline::run(pending.request.clone(), app, state.inner()).await {
        Ok(result) => Ok(result),
        Err(error) => {
            if pipeline::is_retryable(&error) {
                *state.pending.lock().unwrap() = Some(PendingDictation {
                    error: error.clone(),
                    ..pending
                });
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn discard_pending_dictation(state: State<'_, AppState>) -> Result<(), String> {
    *state.pending.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn polish_text(
    text: String,
    mode: Option<String>,
    output_language: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let state = state.inner();
    pipeline::polish_text(text, mode, output_language, state).await
}

/// Provisional transcript for the live preview. No history, no paste.
#[tauri::command]
pub async fn preview_transcript(
    audio_base64: String,
    mime: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    service::pipeline::preview_transcript(audio_base64, mime, state.inner()).await
}

/// Rewrite or translate whatever is selected in the frontmost app, then put the
/// result back in place — the selection equivalent of dictation.
#[tauri::command]
pub async fn rewrite_selection(
    mode: Option<String>,
    output_language: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<service::selection::SelectionOutcome, String> {
    service::selection::rewrite(&app, state.inner(), mode, output_language).await
}

#[tauri::command]
pub async fn insert_text(
    text: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<InsertOutcome, String> {
    let strategy = service::settings::get_cached_settings(state.inner())
        .voice
        .insert;
    Ok(service::insert::deliver(&app, &text, &strategy).await)
}

// ---------------------------------------------------------------- probes ---

/// A redacted bundle to attach to a bug report: versions, platform, settings
/// without secrets, and the shape of recent history (never its text).
#[tauri::command]
pub async fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    service::diagnostics::export(&app, state.inner()).await
}

/// Which models a local OpenAI-compatible server offers. Only a GET to the URL
/// the user typed; no audio and no key leave the machine.
#[tauri::command]
pub async fn probe_local_asr(base_url: Option<String>) -> Result<Vec<String>, String> {
    asr::list_models(base_url.as_deref().unwrap_or_default()).await
}

/// Test the values on screen, not the last saved ones. A first-run wizard saves
/// only when the user moves on, so testing stored settings would fail or pass
/// for the wrong configuration.
#[tauri::command]
pub async fn test_provider_config(
    kind: String,
    provider: ProviderSettings,
) -> Result<Value, String> {
    probe_provider(&kind, &settings_service::sanitize_provider(provider)).await
}

async fn probe_provider(kind: &str, provider: &ProviderSettings) -> Result<Value, String> {
    match kind {
        "asr" => {
            let models = asr::probe(provider).await?;
            Ok(serde_json::json!({ "kind": "asr", "ok": true, "models": models }))
        }
        "polish" => {
            polish::probe(provider).await?;
            Ok(serde_json::json!({ "kind": "polish", "ok": true }))
        }
        other => Err(format!("unknown_provider_kind: {other}")),
    }
}
