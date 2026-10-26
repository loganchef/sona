use tauri::AppHandle;

use crate::{
    dao,
    model::{AppState, DictionaryEntry, DictionaryInput},
    util::time::{new_id, now_iso},
};

/// Cap on glossary entries injected into a prompt; more than this crowds out the
/// transcript and starts hurting accuracy.
const GLOSSARY_LIMIT: usize = 24;

pub fn list(state: &AppState) -> Vec<DictionaryEntry> {
    let mut entries = state.dictionary.lock().unwrap().clone();
    entries.sort_by_key(|entry| {
        (
            std::cmp::Reverse(entry.hits),
            std::cmp::Reverse(entry.updated_at.clone()),
        )
    });
    entries
}

pub async fn upsert(
    id: Option<String>,
    input: DictionaryInput,
    app: &AppHandle,
    state: &AppState,
) -> Result<DictionaryEntry, String> {
    super::app_state::ensure_loaded(app, state).await?;

    let term = input.term.trim().to_string();
    if term.is_empty() {
        return Err("dictionary_term_required".into());
    }

    let aliases: Vec<String> = input
        .aliases
        .iter()
        .map(|alias| alias.trim().to_string())
        .filter(|alias| !alias.is_empty() && alias != &term)
        .collect();

    let now = now_iso();
    let mut entries = state.dictionary.lock().unwrap().clone();

    let entry = match id {
        Some(id) => {
            let index = entries
                .iter()
                .position(|entry| entry.id == id)
                .ok_or_else(|| "dictionary_not_found".to_string())?;

            let mut updated = entries[index].clone();
            updated.term = term;
            updated.aliases = aliases;
            updated.note = input.note.trim().to_string();
            updated.enabled = input.enabled;
            updated.updated_at = now;
            updated
        }
        None => DictionaryEntry {
            id: new_id(),
            term,
            aliases,
            note: input.note.trim().to_string(),
            enabled: input.enabled,
            hits: 0,
            created_at: now.clone(),
            updated_at: now,
        },
    };

    match entries.iter().position(|existing| existing.id == entry.id) {
        Some(index) => entries[index] = entry.clone(),
        None => entries.push(entry.clone()),
    }

    dao::dictionary::save(app, &entries).await?;
    *state.dictionary.lock().unwrap() = entries;
    Ok(entry)
}

pub async fn delete(id: String, app: &AppHandle, state: &AppState) -> Result<(), String> {
    super::app_state::ensure_loaded(app, state).await?;

    let mut entries = state.dictionary.lock().unwrap().clone();
    entries.retain(|entry| entry.id != id);
    dao::dictionary::save(app, &entries).await?;
    *state.dictionary.lock().unwrap() = entries;
    Ok(())
}

/// Nudge the hit counter for entries that actually changed something.
/// Persisted lazily on the next dictionary write to avoid a disk hit per dictation.
pub fn bump_hits(state: &AppState, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    let mut entries = state.dictionary.lock().unwrap();
    for entry in entries.iter_mut() {
        if ids.iter().any(|id| id == &entry.id) {
            entry.hits = entry.hits.saturating_add(1);
        }
    }
}

pub fn glossary(entries: &[DictionaryEntry]) -> Vec<(String, Vec<String>)> {
    let mut enabled: Vec<&DictionaryEntry> = entries.iter().filter(|entry| entry.enabled).collect();
    enabled.sort_by_key(|entry| std::cmp::Reverse(entry.hits));
    enabled
        .into_iter()
        .take(GLOSSARY_LIMIT)
        .map(|entry| (entry.term.clone(), entry.aliases.clone()))
        .collect()
}

/// Rewrite every known mis-recognition to its canonical spelling.
///
/// Three rules, all learned the hard way elsewhere:
/// * longest alias first, so a two-word alias beats its own prefix;
/// * ASCII aliases match whole words only — `get` must not touch `together`;
/// * a canonical spelling that is already in the text is protected, so opening
///   `Claude Code` never rewrites the `Code` inside it.
pub fn rewrite(text: &str, entries: &[DictionaryEntry]) -> (String, Vec<String>) {
    if text.is_empty() || entries.is_empty() {
        return (text.to_string(), Vec::new());
    }

    struct Rule {
        alias: Vec<char>,
        term: String,
        id: String,
    }

    let usable: Vec<&DictionaryEntry> = entries.iter().filter(|entry| entry.enabled).collect();
    let mut rules: Vec<Rule> = Vec::new();

    for entry in &usable {
        for alias in &entry.aliases {
            if alias.is_empty() || alias == &entry.term {
                continue;
            }
            rules.push(Rule {
                alias: alias.chars().collect(),
                term: entry.term.clone(),
                id: entry.id.clone(),
            });
        }
    }

    if rules.is_empty() {
        return (text.to_string(), Vec::new());
    }

    rules.sort_by_key(|rule| std::cmp::Reverse(rule.alias.len()));

    let chars: Vec<char> = text.chars().collect();

    // Spans that already hold the correct spelling.
    let mut terms: Vec<Vec<char>> = usable
        .iter()
        .map(|entry| entry.term.chars().collect::<Vec<char>>())
        .filter(|term| !term.is_empty())
        .collect();
    terms.sort_by_key(|term| std::cmp::Reverse(term.len()));

    let mut protected = vec![false; chars.len()];
    for term in &terms {
        if term.len() > chars.len() {
            continue;
        }
        for start in 0..=chars.len() - term.len() {
            let same = chars[start..start + term.len()]
                .iter()
                .zip(term.iter())
                .all(|(left, right)| left.eq_ignore_ascii_case(right));
            if same && boundary_ok(&chars, start, term.len()) {
                for slot in protected.iter_mut().skip(start).take(term.len()) {
                    *slot = true;
                }
            }
        }
    }

    let mut out = String::with_capacity(text.len());
    let mut hits: Vec<String> = Vec::new();
    let mut index = 0;

    while index < chars.len() {
        if protected[index] {
            out.push(chars[index]);
            index += 1;
            continue;
        }

        let mut matched = None;
        for rule in &rules {
            let end = index + rule.alias.len();
            if end > chars.len() {
                continue;
            }
            let same = chars[index..end]
                .iter()
                .zip(rule.alias.iter())
                .all(|(left, right)| left.eq_ignore_ascii_case(right));
            if same && boundary_ok(&chars, index, rule.alias.len()) {
                matched = Some(rule);
                break;
            }
        }

        match matched {
            Some(rule) => {
                let end = index + rule.alias.len();
                out.push_str(&rule.term);
                if !hits.contains(&rule.id) {
                    hits.push(rule.id.clone());
                }
                // The replacement is canonical: nothing inside it may match again.
                for slot in protected.iter_mut().skip(index).take(end - index) {
                    *slot = true;
                }
                index = end;
            }
            None => {
                out.push(chars[index]);
                index += 1;
            }
        }
    }

    (out, hits)
}

/// ASCII aliases are whole words; CJK aliases match anywhere.
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

    fn entry(term: &str, aliases: &[&str]) -> DictionaryEntry {
        DictionaryEntry {
            id: format!("id-{term}"),
            term: term.into(),
            aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
            note: String::new(),
            enabled: true,
            hits: 0,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn does_not_touch_latin_inside_a_longer_word() {
        let entries = vec![entry("Git", &["get"])];
        let (text, hits) = rewrite("get together with get", &entries);
        assert_eq!(text, "Git together with Git");
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn protects_a_spelling_that_is_already_correct() {
        let entries = vec![entry("Claude Code", &["cloud code"])];
        let (text, hits) = rewrite("Claude Code 和 cloud code", &entries);
        assert_eq!(text, "Claude Code 和 Claude Code");
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn rewrites_misheard_words() {
        let entries = vec![entry("Claude", &["cloud"]), entry("Git", &["get"])];
        let (text, hits) = rewrite("用 cloud 跑一下 get 记录", &entries);
        assert_eq!(text, "用 Claude 跑一下 Git 记录");
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn is_case_insensitive_for_ascii() {
        let entries = vec![entry("GitHub", &["get hub"])];
        let (text, _) = rewrite("push to Get Hub", &entries);
        assert_eq!(text, "push to GitHub");
    }

    #[test]
    fn longest_alias_wins() {
        let entries = vec![entry("API", &["a p i"]), entry("API Key", &["a p i key"])];
        let (text, _) = rewrite("set a p i key now", &entries);
        assert_eq!(text, "set API Key now");
    }

    #[test]
    fn disabled_entries_are_ignored() {
        let mut disabled = entry("Claude", &["cloud"]);
        disabled.enabled = false;
        let (text, hits) = rewrite("cloud", &[disabled]);
        assert_eq!(text, "cloud");
        assert!(hits.is_empty());
    }

    #[test]
    fn empty_text_is_safe() {
        let (text, hits) = rewrite("", &[entry("Git", &["get"])]);
        assert_eq!(text, "");
        assert!(hits.is_empty());
    }
}
