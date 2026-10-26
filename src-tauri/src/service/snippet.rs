use tauri::AppHandle;

use crate::{
    dao,
    model::{AppState, Snippet, SnippetInput},
    util::time::{new_id, now_iso},
};

/// A trigger is a phrase, not a paragraph. Long enough for a sentence opener,
/// short enough that nobody pastes a whole document into the field.
const TRIGGER_MAX: usize = 80;
const EXPANSION_MAX: usize = 4_000;

pub fn list(state: &AppState) -> Vec<Snippet> {
    let mut snippets = state.snippets.lock().unwrap().clone();
    snippets.sort_by(|a, b| {
        b.hits
            .cmp(&a.hits)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    snippets
}

pub async fn upsert(
    id: Option<String>,
    input: SnippetInput,
    app: &AppHandle,
    state: &AppState,
) -> Result<Snippet, String> {
    super::app_state::ensure_loaded(app, state).await?;

    let trigger = input.trigger.trim().to_string();
    let expansion = input.expansion.trim_end().to_string();

    if trigger.is_empty() {
        return Err("snippet_trigger_required".into());
    }
    if expansion.trim().is_empty() {
        return Err("snippet_expansion_required".into());
    }
    if trigger == expansion {
        return Err("snippet_trigger_equals_expansion".into());
    }
    if trigger.chars().count() > TRIGGER_MAX {
        return Err("snippet_trigger_too_long".into());
    }
    if expansion.chars().count() > EXPANSION_MAX {
        return Err("snippet_expansion_too_long".into());
    }

    let now = now_iso();
    let mut snippets = state.snippets.lock().unwrap().clone();

    let snippet = match id {
        Some(id) => {
            let index = snippets
                .iter()
                .position(|snippet| snippet.id == id)
                .ok_or_else(|| "snippet_not_found".to_string())?;

            let mut updated = snippets[index].clone();
            updated.trigger = trigger;
            updated.expansion = expansion;
            updated.note = input.note.trim().chars().take(200).collect();
            updated.enabled = input.enabled;
            updated.updated_at = now;
            updated
        }
        None => Snippet {
            id: new_id(),
            trigger,
            expansion,
            note: input.note.trim().chars().take(200).collect(),
            enabled: input.enabled,
            hits: 0,
            created_at: now.clone(),
            updated_at: now,
        },
    };

    // Two snippets with the same trigger would make the winner depend on load
    // order; the newest edit wins, which is what the user just did.
    snippets.retain(|existing| {
        existing.id == snippet.id || !existing.trigger.eq_ignore_ascii_case(&snippet.trigger)
    });

    match snippets
        .iter()
        .position(|existing| existing.id == snippet.id)
    {
        Some(index) => snippets[index] = snippet.clone(),
        None => snippets.push(snippet.clone()),
    }

    dao::snippet::save(app, &snippets).await?;
    *state.snippets.lock().unwrap() = snippets;
    Ok(snippet)
}

pub async fn delete(id: String, app: &AppHandle, state: &AppState) -> Result<(), String> {
    super::app_state::ensure_loaded(app, state).await?;

    let mut snippets = state.snippets.lock().unwrap().clone();
    snippets.retain(|snippet| snippet.id != id);
    dao::snippet::save(app, &snippets).await?;
    *state.snippets.lock().unwrap() = snippets;
    Ok(())
}

pub fn bump_hits(state: &AppState, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    let mut snippets = state.snippets.lock().unwrap();
    for snippet in snippets.iter_mut() {
        if ids.iter().any(|id| id == &snippet.id) {
            snippet.hits = snippet.hits.saturating_add(1);
        }
    }
}

/// Triggers the polish prompt must leave alone. The model cannot expand them
/// (that happens afterwards), but it can easily reword them into something the
/// matcher no longer recognises.
pub fn phrases(snippets: &[Snippet]) -> Vec<String> {
    let mut enabled: Vec<&Snippet> = snippets.iter().filter(|snippet| snippet.enabled).collect();
    enabled.sort_by_key(|snippet| std::cmp::Reverse(snippet.hits));
    enabled
        .into_iter()
        .take(12)
        .map(|snippet| snippet.trigger.clone())
        .collect()
}

/// Replace every spoken trigger with its prepared text.
///
/// The same rules as the dictionary, plus one: a replacement is final. The scan
/// jumps over the expansion instead of rescanning it, so 「A → B」 never turns
/// into an accidental chain when B happens to contain another trigger.
pub fn expand(text: &str, snippets: &[Snippet]) -> (String, Vec<String>) {
    if text.is_empty() || snippets.is_empty() {
        return (text.to_string(), Vec::new());
    }

    struct Rule {
        trigger: Vec<char>,
        expansion: String,
        id: String,
    }

    let mut rules: Vec<Rule> = snippets
        .iter()
        .filter(|snippet| {
            snippet.enabled
                && !snippet.trigger.is_empty()
                && !snippet.expansion.trim().is_empty()
                && snippet.trigger != snippet.expansion
        })
        .map(|snippet| Rule {
            trigger: snippet.trigger.chars().collect(),
            expansion: snippet.expansion.clone(),
            id: snippet.id.clone(),
        })
        .collect();

    if rules.is_empty() {
        return (text.to_string(), Vec::new());
    }

    // Longest trigger first: 「我的工作邮箱」 must win over 「我的邮箱」.
    rules.sort_by_key(|rule| std::cmp::Reverse(rule.trigger.len()));

    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut hits: Vec<String> = Vec::new();
    let mut index = 0;

    'scan: while index < chars.len() {
        for rule in &rules {
            let end = index + rule.trigger.len();
            if end > chars.len() {
                continue;
            }
            let same = chars[index..end]
                .iter()
                .zip(rule.trigger.iter())
                .all(|(left, right)| left.eq_ignore_ascii_case(right));
            if !same || !boundary_ok(&chars, index, rule.trigger.len()) {
                continue;
            }

            out.push_str(&rule.expansion);
            if !hits.contains(&rule.id) {
                hits.push(rule.id.clone());
            }
            index = end;
            continue 'scan;
        }

        out.push(chars[index]);
        index += 1;
    }

    (out, hits)
}

/// ASCII triggers are whole words; CJK triggers match anywhere, because Chinese
/// does not put spaces around a phrase.
fn boundary_ok(chars: &[char], start: usize, len: usize) -> bool {
    let first = chars[start];
    let last = chars[start + len - 1];

    if first.is_ascii_alphanumeric() {
        if let Some(before) = start.checked_sub(1).map(|index| chars[index]) {
            if before.is_ascii_alphanumeric() {
                return false;
            }
        }
    }

    if last.is_ascii_alphanumeric() {
        if let Some(after) = chars.get(start + len) {
            if after.is_ascii_alphanumeric() {
                return false;
            }
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippet(trigger: &str, expansion: &str) -> Snippet {
        Snippet {
            id: format!("id-{trigger}"),
            trigger: trigger.into(),
            expansion: expansion.into(),
            note: String::new(),
            enabled: true,
            hits: 0,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn expands_a_spoken_phrase() {
        let snippets = vec![snippet("我的邮箱", "hi@example.com")];
        let (text, hits) = expand("发到我的邮箱，谢谢。", &snippets);
        assert_eq!(text, "发到hi@example.com，谢谢。");
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn longest_trigger_wins() {
        let snippets = vec![
            snippet("我的邮箱", "hi@example.com"),
            snippet("我的工作邮箱", "work@example.com"),
        ];
        let (text, _) = expand("用我的工作邮箱发", &snippets);
        assert_eq!(text, "用work@example.com发");
    }

    #[test]
    fn ascii_triggers_match_whole_words_only() {
        let snippets = vec![snippet("my email", "hi@example.com")];
        assert_eq!(
            expand("my email is ready", &snippets).0,
            "hi@example.com is ready"
        );
        assert_eq!(
            expand("my emails are ready", &snippets).0,
            "my emails are ready"
        );
        assert_eq!(
            expand("My Email please", &snippets).0,
            "hi@example.com please"
        );
    }

    #[test]
    fn expansion_is_never_rescanned() {
        let snippets = vec![snippet("甲", "乙"), snippet("乙", "丙")];
        let (text, hits) = expand("甲", &snippets);
        assert_eq!(text, "乙");
        assert_eq!(hits, vec!["id-甲".to_string()]);
    }

    #[test]
    fn disabled_and_degenerate_snippets_are_ignored() {
        let mut disabled = snippet("我的邮箱", "hi@example.com");
        disabled.enabled = false;
        let same = snippet("签名", "签名");
        let empty = snippet("空", "   ");
        let snippets = vec![disabled, same, empty];

        let (text, hits) = expand("我的邮箱 签名 空", &snippets);
        assert_eq!(text, "我的邮箱 签名 空");
        assert!(hits.is_empty());
    }

    #[test]
    fn a_hit_is_counted_once_per_dictation() {
        let snippets = vec![snippet("邮箱", "mail")];
        let (text, hits) = expand("邮箱，邮箱", &snippets);
        assert_eq!(text, "mail，mail");
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn triggers_stay_out_of_the_prompt_when_disabled() {
        let mut disabled = snippet("我的邮箱", "hi@example.com");
        disabled.enabled = false;
        let phrases = phrases(&[disabled, snippet("周报模板", "...")]);
        assert_eq!(phrases, vec!["周报模板".to_string()]);
    }
}
