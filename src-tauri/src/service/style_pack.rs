use crate::{
    model::{settings::MODES, AppSettings, StylePack},
    util::time::new_id,
};

/// User-authored packs are deliberately bounded: this is a list of voices, not
/// a document library, and every take may have to scan it.
pub const PACK_LIMIT: usize = 24;
pub const NAME_MAX: usize = 40;
pub const INSTRUCTION_MAX: usize = 600;

/// The four voices every install starts with. They are generated, not stored,
/// so their names and prompts follow the current UI language.
pub fn builtins(language: &str) -> Vec<StylePack> {
    if language == "zh-CN" {
        vec![
            pack("builtin-daily", "日常口述", "light", ""),
            pack(
                "builtin-meeting",
                "会议纪要",
                "structured",
                "整理成带小标题的要点，保留负责人、时间和待办；只依据原话，不要补充没说的内容。",
            ),
            pack(
                "builtin-email",
                "邮件",
                "formal",
                "整理成可以直接发送的邮件正文，语气克制、结构清楚；不要添加主题、称呼或签名。",
            ),
            pack("builtin-verbatim", "逐字转写", "raw", ""),
        ]
    } else {
        vec![
            pack("builtin-daily", "Daily", "light", ""),
            pack(
                "builtin-meeting",
                "Meeting notes",
                "structured",
                "Turn this into headed bullet points, keeping owners, dates and action items. Do not add anything that was not said.",
            ),
            pack(
                "builtin-email",
                "Email",
                "formal",
                "Turn this into a send-ready email body with a restrained tone and clear structure. Do not add a subject, greeting or signature.",
            ),
            pack("builtin-verbatim", "Verbatim", "raw", ""),
        ]
    }
}

fn pack(id: &str, name: &str, mode: &str, instruction: &str) -> StylePack {
    StylePack {
        id: id.into(),
        name: name.into(),
        mode: mode.into(),
        instruction: instruction.into(),
        builtin: true,
    }
}

/// Built-ins first, then the user's own packs in the order they saved them.
pub fn list(settings: &AppSettings) -> Vec<StylePack> {
    let mut packs = builtins(&settings.general.language);
    packs.extend(settings.voice.style_packs.iter().cloned().map(|mut pack| {
        pack.builtin = false;
        pack
    }));
    packs
}

pub fn find(settings: &AppSettings, id: &str) -> Option<StylePack> {
    list(settings).into_iter().find(|pack| pack.id == id)
}

/// Copy a pack's mode and instruction into the live settings.
pub fn apply(settings: &mut AppSettings, id: &str) -> Result<StylePack, String> {
    let pack = find(settings, id).ok_or_else(|| "style_pack_not_found".to_string())?;
    settings.voice.mode = pack.mode.clone();
    settings.voice.custom_instruction = pack.instruction.clone();
    settings.voice.active_style_pack = pack.id.clone();
    Ok(pack)
}

/// The packs the global style hotkey walks through, in list order.
fn cycle_packs(settings: &AppSettings) -> Vec<StylePack> {
    list(settings)
        .into_iter()
        .filter(|pack| !settings.voice.excluded_style_packs.contains(&pack.id))
        .collect()
}

/// Advance to the next pack, wrapping at the end. If the active id is stale,
/// excluded or empty, start from the first included pack instead of jumping to
/// the second.
pub fn cycle(settings: &mut AppSettings) -> Result<StylePack, String> {
    let packs = cycle_packs(settings);
    if packs.is_empty() {
        return Err("style_pack_empty".into());
    }

    let index = match packs
        .iter()
        .position(|pack| pack.id == settings.voice.active_style_pack)
    {
        Some(current) => (current + 1) % packs.len(),
        None => 0,
    };

    let next = packs[index].clone();
    settings.voice.mode = next.mode.clone();
    settings.voice.custom_instruction = next.instruction.clone();
    settings.voice.active_style_pack = next.id.clone();
    Ok(next)
}

/// Trim, de-duplicate and bound packs arriving from the UI or an import.
///
/// Ids that collide with a built-in are regenerated: otherwise `apply` would
/// always find the built-in first and the imported pack would be unreachable.
pub fn sanitize(packs: Vec<StylePack>, language: &str) -> Vec<StylePack> {
    let builtin_ids: Vec<String> = builtins(language).into_iter().map(|pack| pack.id).collect();
    let mut result = Vec::new();

    for pack in packs.into_iter().take(PACK_LIMIT) {
        let name: String = pack.name.trim().chars().take(NAME_MAX).collect();
        if name.is_empty() {
            continue;
        }

        let mut id: String = pack.id.trim().chars().take(64).collect();
        if id.is_empty()
            || builtin_ids.contains(&id)
            || result.iter().any(|item: &StylePack| item.id == id)
        {
            id = new_id();
        }

        let mode = if MODES.contains(&pack.mode.as_str()) {
            pack.mode
        } else {
            "light".into()
        };
        let instruction: String = pack
            .instruction
            .trim()
            .chars()
            .take(INSTRUCTION_MAX)
            .collect();

        result.push(StylePack {
            id,
            name,
            mode,
            instruction,
            builtin: false,
        });
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(language: &str) -> AppSettings {
        let mut settings = AppSettings::default();
        settings.general.language = language.into();
        settings
    }

    #[test]
    fn builtins_follow_the_ui_language() {
        assert_eq!(builtins("zh-CN")[1].name, "会议纪要");
        assert_eq!(builtins("en")[1].name, "Meeting notes");
    }

    #[test]
    fn applying_a_pack_changes_mode_instruction_and_active_id() {
        let mut settings = settings("en");
        let pack = apply(&mut settings, "builtin-meeting").unwrap();

        assert_eq!(pack.mode, "structured");
        assert_eq!(settings.voice.mode, "structured");
        assert_eq!(settings.voice.custom_instruction, pack.instruction);
        assert_eq!(settings.voice.active_style_pack, "builtin-meeting");
    }

    #[test]
    fn custom_packs_come_after_builtins_and_can_be_applied() {
        let mut settings = settings("en");
        settings.voice.style_packs = sanitize(
            vec![StylePack {
                id: "custom-weekly".into(),
                name: "Weekly sync".into(),
                mode: "structured".into(),
                instruction: "Keep owners.".into(),
                builtin: false,
            }],
            "en",
        );

        let packs = list(&settings);
        assert_eq!(packs.len(), 5);
        assert_eq!(packs[4].id, "custom-weekly");
        assert!(!packs[4].builtin);

        let applied = apply(&mut settings, "custom-weekly").unwrap();
        assert_eq!(applied.name, "Weekly sync");
        assert_eq!(settings.voice.custom_instruction, "Keep owners.");
    }

    #[test]
    fn cycle_wraps_and_starts_from_the_first_pack() {
        let mut settings = settings("en");
        let first = cycle(&mut settings).unwrap();
        assert_eq!(first.id, "builtin-daily");

        apply(&mut settings, "builtin-verbatim").unwrap();
        let wrapped = cycle(&mut settings).unwrap();
        assert_eq!(wrapped.id, "builtin-daily");
    }

    #[test]
    fn cycle_skips_packs_the_user_removed_from_the_rotation() {
        let mut settings = settings("en");
        settings.voice.excluded_style_packs = vec!["builtin-meeting".into()];

        let next = cycle(&mut settings).unwrap();
        assert_eq!(next.id, "builtin-daily");

        let next = cycle(&mut settings).unwrap();
        assert_eq!(next.id, "builtin-email");
    }

    #[test]
    fn cycle_reports_an_empty_rotation() {
        let mut settings = settings("en");
        settings.voice.excluded_style_packs = list(&settings).into_iter().map(|p| p.id).collect();

        assert_eq!(cycle(&mut settings).unwrap_err(), "style_pack_empty");
    }

    #[test]
    fn sanitize_bounds_fields_and_rejects_duplicate_or_builtin_ids() {
        let packs = sanitize(
            vec![
                StylePack {
                    id: "builtin-daily".into(),
                    name: "  Mine  ".into(),
                    mode: "poetic".into(),
                    instruction: "x".repeat(INSTRUCTION_MAX + 50),
                    builtin: true,
                },
                StylePack {
                    id: "same".into(),
                    name: "First".into(),
                    mode: "light".into(),
                    instruction: String::new(),
                    builtin: false,
                },
                StylePack {
                    id: "same".into(),
                    name: "Second".into(),
                    mode: "light".into(),
                    instruction: String::new(),
                    builtin: false,
                },
                StylePack {
                    id: "empty".into(),
                    name: "   ".into(),
                    mode: "light".into(),
                    instruction: String::new(),
                    builtin: false,
                },
            ],
            "en",
        );

        assert_eq!(packs.len(), 3);
        assert_eq!(packs[0].name, "Mine");
        assert_eq!(packs[0].mode, "light");
        assert!(!packs[0].builtin);
        assert_ne!(packs[0].id, "builtin-daily");
        assert_eq!(packs[0].instruction.chars().count(), INSTRUCTION_MAX);
        assert_eq!(packs[1].name, "First");
        assert_eq!(packs[2].name, "Second");
        assert_ne!(packs[1].id, packs[2].id);
    }
}
