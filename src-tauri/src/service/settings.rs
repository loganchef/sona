use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    dao,
    model::{
        settings::{
            GeneralSettings, INSERT_STRATEGIES, LANGUAGES, MODES, OUTPUT_LANGUAGES, SURFACES,
            THEMES,
        },
        AppSettings, AppState, ProviderSettings, StylePack, UiSettings, VoiceSettings,
    },
    service::{
        secrets::{self, SecretKind},
        style_pack,
    },
};

/// Load persisted settings, falling back to defaults when absent or corrupt.
pub async fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    match dao::settings::load_settings(app).await {
        Ok(Some(mut settings)) => {
            // Pull keys out of the keychain before judging whether a provider
            // is configured; a key that only lives in the keychain still counts.
            let asr = secrets::resolve(SecretKind::Asr, &settings.voice.asr.api_key);
            let polish = secrets::resolve(SecretKind::Polish, &settings.voice.polish.api_key);
            settings.voice.asr.api_key = asr.value;
            settings.voice.polish.api_key = polish.value;

            let mut dirty = asr.migrated || polish.migrated;

            // Settings written before the first-run guide existed have no
            // `onboarded` field. An install that already has a working ASR
            // provider should not be dragged through setup again; a fresh one
            // (or one without a key) still gets the guide.
            if normalize_style_packs(&mut settings) {
                dirty = true;
            }

            if !settings.general.onboarded
                && (settings.voice.asr.is_configured() || settings.voice.local_asr.enabled)
            {
                settings.general.onboarded = true;
                dirty = true;
            }

            if dirty {
                if let Err(error) = save_settings(app, &settings).await {
                    eprintln!("could not persist settings migration: {error}");
                }
            }

            Ok(settings)
        }
        Ok(None) => Ok(AppSettings::default()),
        Err(error) => {
            eprintln!("{error}; falling back to default settings");
            Ok(AppSettings::default())
        }
    }
}

pub async fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    // The in-memory copy keeps the key; only the JSON written to disk is
    // stripped. If the keychain refuses a key we still write it, so the user
    // never silently loses their configuration.
    let disk = secrets::settings_for_disk(settings);
    dao::settings::save_settings(app, &disk).await
}

pub fn get_cached_settings(state: &AppState) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

/// Update a single top-level settings group ("general", "ui" or "voice").
pub async fn update_setting(
    key: String,
    value: Value,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let mut current = state.settings.lock().unwrap().clone();
    apply_setting(&mut current, &key, value)?;

    save_settings(&app, &current).await?;
    *state.settings.lock().unwrap() = current.clone();

    Ok(current)
}

pub async fn reset_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let defaults = AppSettings::default();
    save_settings(&app, &defaults).await?;
    *state.settings.lock().unwrap() = defaults.clone();
    Ok(defaults)
}

/// Copy a pack into live settings and persist it. The frontend uses this for
/// its Apply button; the global style hotkey uses `cycle_style_pack`.
pub async fn activate_style_pack(
    id: String,
    app: &AppHandle,
    state: &AppState,
) -> Result<AppSettings, String> {
    let mut current = get_cached_settings(state);
    style_pack::apply(&mut current, &id)?;
    save_settings(app, &current).await?;
    *state.settings.lock().unwrap() = current.clone();
    Ok(current)
}

/// Move to the next pack, wrapping around. Returns the pack so the hotkey can
/// name it in the capsule without a second read.
pub async fn cycle_style_pack(app: &AppHandle, state: &AppState) -> Result<StylePack, String> {
    let mut current = get_cached_settings(state);
    let next = style_pack::cycle(&mut current)?;
    save_settings(app, &current).await?;
    *state.settings.lock().unwrap() = current;
    Ok(next)
}

fn apply_setting(settings: &mut AppSettings, key: &str, value: Value) -> Result<(), String> {
    match key {
        "general" => {
            let mut update: GeneralSettings = serde_json::from_value(value)
                .map_err(|error| format!("invalid_general_settings: {error}"))?;

            if !LANGUAGES.contains(&update.language.as_str()) {
                update.language = GeneralSettings::default().language;
            }

            // Built-ins are generated in the UI language. If the active pack
            // was applied untouched, switch its prompt with the language; a
            // manual edit is the user's, so keep it and let the UI say
            // "adjusted" instead of overwriting it.
            let previous_language = settings.general.language.clone();
            let untouched_builtin = style_pack::builtins(&previous_language)
                .into_iter()
                .find(|pack| pack.id == settings.voice.active_style_pack)
                .filter(|pack| {
                    pack.mode == settings.voice.mode
                        && pack.instruction == settings.voice.custom_instruction
                });

            settings.general = update;

            if settings.general.language != previous_language {
                if let Some(pack) = untouched_builtin {
                    let _ = style_pack::apply(settings, &pack.id);
                }
            }
        }
        "ui" => {
            let mut update: UiSettings = serde_json::from_value(value)
                .map_err(|error| format!("invalid_ui_settings: {error}"))?;

            let defaults = UiSettings::default();
            if !THEMES.contains(&update.theme.as_str()) {
                update.theme = defaults.theme;
            }
            if !SURFACES.contains(&update.surface.as_str()) {
                update.surface = defaults.surface;
            }
            update.page_size = update.page_size.clamp(1, 200);

            settings.ui = update;
        }
        "voice" => {
            let mut update: VoiceSettings = serde_json::from_value(value)
                .map_err(|error| format!("invalid_voice_settings: {error}"))?;

            let defaults = VoiceSettings::default();
            if !MODES.contains(&update.mode.as_str()) {
                update.mode = defaults.mode;
            }
            if !OUTPUT_LANGUAGES.contains(&update.output_language.as_str()) {
                update.output_language = defaults.output_language;
            }
            if !INSERT_STRATEGIES.contains(&update.insert.as_str()) {
                update.insert = defaults.insert;
            }
            update.context_chars = update.context_chars.min(2_000);

            update.asr = sanitize_provider(update.asr);
            update.polish = sanitize_provider(update.polish);

            update.hotkeys.dictate = non_empty(update.hotkeys.dictate, defaults.hotkeys.dictate);
            update.hotkeys.cancel = non_empty(update.hotkeys.cancel, defaults.hotkeys.cancel);
            update.hotkeys.ask = non_empty(update.hotkeys.ask, defaults.hotkeys.ask);
            update.hotkeys.style = non_empty(update.hotkeys.style, defaults.hotkeys.style);

            update.local_asr.model_dir = update.local_asr.model_dir.trim().to_string();
            update.local_asr.base_url = update
                .local_asr
                .base_url
                .trim()
                .trim_end_matches('/')
                .to_string();
            update.local_asr.model = update.local_asr.model.trim().to_string();

            // A custom instruction is a short style hint, not a second system prompt.
            update.custom_instruction = update
                .custom_instruction
                .trim()
                .chars()
                .take(600)
                .collect::<String>();
            update.style_packs =
                style_pack::sanitize(update.style_packs, &settings.general.language);
            update.active_style_pack = update
                .active_style_pack
                .trim()
                .chars()
                .take(64)
                .collect::<String>();
            update.silence_ms = update.silence_ms.clamp(300, 5_000);

            settings.voice = update;
            normalize_style_packs(settings);
        }
        other => return Err(format!("unsupported_setting: {other}")),
    }

    Ok(())
}

pub(crate) fn sanitize_provider(provider: ProviderSettings) -> ProviderSettings {
    ProviderSettings {
        preset: provider.preset.trim().to_string(),
        base_url: provider.base_url.trim().trim_end_matches('/').to_string(),
        api_key: provider.api_key.trim().to_string(),
        model: provider.model.trim().to_string(),
    }
}

/// Re-run the same bounds used by the save path on data read from disk, and
/// drop an active id that no longer resolves. Returns whether anything changed
/// so the loader can rewrite a legacy file once.
fn normalize_style_packs(settings: &mut AppSettings) -> bool {
    let sanitized = style_pack::sanitize(
        settings.voice.style_packs.clone(),
        &settings.general.language,
    );
    let mut dirty = sanitized != settings.voice.style_packs;
    settings.voice.style_packs = sanitized;

    // A stale active id would make the style page claim a pack that no longer
    // exists; clearing it keeps the UI honest without changing the mode or
    // instruction the user is currently dictating with.
    if !settings.voice.active_style_pack.is_empty()
        && style_pack::find(settings, &settings.voice.active_style_pack).is_none()
    {
        settings.voice.active_style_pack.clear();
        dirty = true;
    }

    // Deleted or renamed packs must not leave dead exclusions behind. Keeping
    // the list to known ids also makes the cycle predicate cheap and stable.
    let known: Vec<String> = style_pack::list(settings)
        .into_iter()
        .map(|pack| pack.id)
        .collect();
    let mut excluded: Vec<String> = Vec::new();
    for raw in &settings.voice.excluded_style_packs {
        let id: String = raw.trim().chars().take(64).collect();
        if !id.is_empty() && known.contains(&id) && !excluded.contains(&id) {
            excluded.push(id);
        }
    }
    if excluded != settings.voice.excluded_style_packs {
        settings.voice.excluded_style_packs = excluded;
        dirty = true;
    }

    dirty
}

fn non_empty(value: String, fallback: String) -> String {
    if value.trim().is_empty() {
        fallback
    } else {
        value.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switching_language_reapplies_an_untouched_builtin() {
        let mut settings = AppSettings::default();
        settings.general.language = "zh-CN".into();
        style_pack::apply(&mut settings, "builtin-meeting").unwrap();

        apply_setting(
            &mut settings,
            "general",
            serde_json::json!({ "language": "en" }),
        )
        .unwrap();

        assert_eq!(settings.general.language, "en");
        assert_eq!(settings.voice.mode, "structured");
        assert!(settings.voice.custom_instruction.contains("headed bullet"));
        assert_eq!(settings.voice.active_style_pack, "builtin-meeting");
    }

    #[test]
    fn switching_language_keeps_a_manually_adjusted_builtin() {
        let mut settings = AppSettings::default();
        settings.general.language = "zh-CN".into();
        style_pack::apply(&mut settings, "builtin-meeting").unwrap();
        settings.voice.custom_instruction = "Keep it mine.".into();

        apply_setting(
            &mut settings,
            "general",
            serde_json::json!({ "language": "en" }),
        )
        .unwrap();

        assert_eq!(settings.voice.custom_instruction, "Keep it mine.");
        assert_eq!(settings.voice.active_style_pack, "builtin-meeting");
    }

    #[test]
    fn unknown_values_fall_back_to_defaults() {
        let mut settings = AppSettings::default();
        apply_setting(
            &mut settings,
            "ui",
            serde_json::json!({ "theme": "neon", "surface": "marble", "pageSize": 9000 }),
        )
        .unwrap();

        assert_eq!(settings.ui.theme, "system");
        assert_eq!(settings.ui.surface, "solid");
        assert_eq!(settings.ui.page_size, 200);
    }

    #[test]
    fn default_surface_is_solid() {
        // Glass is an opt-in treatment; the first-run app must read as a tool.
        assert_eq!(AppSettings::default().ui.surface, "solid");
    }

    #[test]
    fn rejects_unknown_keys() {
        let mut settings = AppSettings::default();
        assert!(apply_setting(&mut settings, "nope", serde_json::json!({})).is_err());
    }

    #[test]
    fn voice_enums_and_clamps() {
        let mut settings = AppSettings::default();
        apply_setting(
            &mut settings,
            "voice",
            serde_json::json!({
                "mode": "poetic",
                "outputLanguage": "klingon",
                "insert": "teleport",
                "contextChars": 99999,
                "asr": { "preset": "groq", "baseUrl": " https://api.groq.com/openai/v1/ ", "model": "whisper-large-v3-turbo" },
                "polish": { "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat" }
            }),
        )
        .unwrap();

        assert_eq!(settings.voice.mode, "light");
        assert_eq!(settings.voice.output_language, "auto");
        assert_eq!(settings.voice.insert, "paste");
        assert_eq!(settings.voice.context_chars, 2_000);
        assert_eq!(
            settings.voice.asr.base_url,
            "https://api.groq.com/openai/v1"
        );
        assert!(settings.voice.asr.api_key.is_empty());
    }

    #[test]
    fn loading_repairs_style_packs_and_drops_a_stale_active_id() {
        let mut settings = AppSettings::default();
        settings.general.language = "en".into();
        settings.voice.style_packs = vec![StylePack {
            id: "builtin-daily".into(),
            name: "Mine".into(),
            mode: "poetic".into(),
            instruction: "Keep it short.".into(),
            builtin: true,
        }];
        settings.voice.active_style_pack = "gone".into();

        assert!(normalize_style_packs(&mut settings));
        assert_ne!(settings.voice.style_packs[0].id, "builtin-daily");
        assert_eq!(settings.voice.style_packs[0].mode, "light");
        assert!(!settings.voice.style_packs[0].builtin);
        assert!(settings.voice.active_style_pack.is_empty());

        // A second pass is stable, so loading does not rewrite forever.
        assert!(!normalize_style_packs(&mut settings));
    }

    #[test]
    fn loading_cleans_cycle_exclusions() {
        let mut settings = AppSettings::default();
        settings.general.language = "en".into();
        settings.voice.style_packs = vec![StylePack {
            id: "custom-mine".into(),
            name: "Mine".into(),
            mode: "light".into(),
            instruction: String::new(),
            builtin: false,
        }];
        settings.voice.excluded_style_packs = vec![
            "builtin-meeting".into(),
            "gone".into(),
            "builtin-meeting".into(),
            " custom-mine ".into(),
        ];

        assert!(normalize_style_packs(&mut settings));
        assert_eq!(
            settings.voice.excluded_style_packs,
            vec!["builtin-meeting", "custom-mine"]
        );
        assert!(!normalize_style_packs(&mut settings));
    }

    #[test]
    fn style_packs_are_bounded_and_stale_active_ids_are_cleared() {
        let mut settings = AppSettings::default();
        apply_setting(
            &mut settings,
            "voice",
            serde_json::json!({
                "mode": "light",
                "activeStylePack": "missing",
                "stylePacks": [
                    {
                        "id": "builtin-daily",
                        "name": "Mine",
                        "mode": "poetic",
                        "instruction": "x".repeat(900),
                        "builtin": true
                    }
                ]
            }),
        )
        .unwrap();

        assert_eq!(settings.voice.style_packs.len(), 1);
        assert_ne!(settings.voice.style_packs[0].id, "builtin-daily");
        assert_eq!(settings.voice.style_packs[0].mode, "light");
        assert!(!settings.voice.style_packs[0].builtin);
        assert_eq!(
            settings.voice.style_packs[0].instruction.chars().count(),
            600
        );
        assert!(settings.voice.active_style_pack.is_empty());
    }

    #[test]
    fn fresh_installs_hold_to_talk_but_old_files_keep_tapping() {
        assert!(VoiceSettings::default().hold_to_talk);

        let old: VoiceSettings = serde_json::from_value(serde_json::json!({
            "mode": "light",
            "hotkeys": { "dictate": "Alt+Space" }
        }))
        .unwrap();
        assert!(!old.hold_to_talk);
    }

    #[test]
    fn empty_hotkey_keeps_default() {
        let mut settings = AppSettings::default();
        apply_setting(
            &mut settings,
            "voice",
            serde_json::json!({ "hotkeys": { "dictate": "  ", "cancel": "Escape", "ask": "Alt+Space" } }),
        )
        .unwrap();

        assert_eq!(settings.voice.hotkeys.dictate, Hotkeys::default_dictate());
    }

    struct Hotkeys;
    impl Hotkeys {
        fn default_dictate() -> String {
            crate::model::settings::HotkeySettings::default().dictate
        }
    }
}
