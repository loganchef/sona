//! Deterministic clean-up around the model.
//!
//! Everything here is decided by code, not by a prompt. Three recurring failure
//! modes are handled here:
//!
//! * silence hallucinations (`is_stock_phrase`);
//! * all-caps English from the SenseVoice family (`normalize_english_case`);
//! * filler-only transcripts, and polishing output that slipped back into
//!   Markdown, ` thinking` blocks, or a cheerful "以下是整理后的文本：" preamble.

/// Chinese hesitation sounds. A transcript made only of these has nothing to type.
const HESITATION: &[char] = &[
    '呃', '额', '唔', '嗯', '啊', '哦', '噢', '喔', '诶', '欸', '哎', '唉', '呀', '恩', '昂', '呃',
];

/// Latin hesitations, compared against the whole word, lowercased.
const LATIN_HESITATION: &[&str] = &[
    "um", "umm", "uh", "uhh", "er", "erm", "hm", "hmm", "mm", "mmm", "ah", "oh",
];

/// Whisper-class models invent these on silence — they are burned into the
/// training data from subtitled video.
const STOCK: &[&str] = &[
    "明镜与点点",
    "点点栏目",
    "字幕由",
    "中文字幕",
    "字幕志愿者",
    "由amara",
    "amara.org",
    "索兰娅",
    "请不吝",
    "点赞订阅",
    "谢谢观看",
    "感谢观看",
    "谢谢收看",
    "感谢收看",
    "谢谢大家观看",
];

const LEADING_BOILERPLATE: &[&str] = &[
    "整理后的文本：",
    "整理后的文本:",
    "整理结果：",
    "整理结果:",
    "以下是整理后的文本：",
    "以下是整理后的文本:",
    "以下是整理后的内容：",
    "以下是整理后的内容:",
    "以下是整理结果：",
    "以下是整理结果:",
    "输出：",
    "输出:",
    "cleaned text:",
    "here is the cleaned text:",
    "here's the cleaned text:",
    "here is the text:",
    "here's the text:",
    "sure, here is the cleaned text:",
    "sure, here's the cleaned text:",
];

const BOILERPLATE_END: &[char] = &['\n'];

/// True when the transcript carries no content: only hesitations and punctuation.
pub fn is_filler_only(text: &str) -> bool {
    let mut saw_content = false;

    for word in text.split(|c: char| c.is_whitespace() || is_punctuation(c)) {
        if word.is_empty() {
            continue;
        }

        if word.chars().count() == 1 && word.chars().all(|c| HESITATION.contains(&c)) {
            saw_content = true;
            continue;
        }

        // English hesitations arrive as their own word.
        if word.chars().all(|c| c.is_ascii_alphabetic())
            && LATIN_HESITATION.contains(&word.to_ascii_lowercase().as_str())
        {
            saw_content = true;
            continue;
        }

        return false;
    }

    saw_content
}

/// A known hallucination. The caller must still gate it: a user who really says
/// 「记得点赞关注」 should keep the text, so this only counts when almost no
/// speech was detected.
pub fn is_stock_phrase(text: &str) -> bool {
    if text.trim().is_empty() {
        return false;
    }

    let flat: String = text
        .chars()
        .filter(|c| !c.is_whitespace() && !is_punctuation(*c))
        .flat_map(|c| c.to_lowercase())
        .collect();

    STOCK.iter().any(|needle| flat.contains(needle))
}

/// SenseVoice writes every English word in capitals («HELLO EVERYONE»).
///
/// Only applied to mixed Chinese/English transcripts: in a pure English
/// dictation capitals carry meaning, and guessing wrong is worse than leaving
/// them alone.
pub fn normalize_english_case(text: &str) -> String {
    if !text.chars().any(is_han) {
        return text.to_string();
    }

    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    let mut sentence_start = true;

    while index < chars.len() {
        let current = chars[index];

        if current.is_ascii_alphabetic() {
            let start = index;
            let mut words: Vec<String> = Vec::new();
            let mut word_start = index;
            index += 1;

            while index < chars.len() {
                let c = chars[index];
                let is_letter = c.is_ascii_alphabetic();
                let is_joiner = (c == '\'' || c == '’' || c == '-')
                    && chars
                        .get(index + 1)
                        .map(|next| next.is_ascii_alphabetic())
                        .unwrap_or(false);

                if is_letter || c.is_ascii_digit() || is_joiner {
                    index += 1;
                } else if c.is_whitespace()
                    && chars
                        .get(index + 1)
                        .map(|next| next.is_ascii_alphabetic())
                        .unwrap_or(false)
                {
                    // A space inside a run of Latin words keeps them one run.
                    words.push(chars[word_start..index].iter().collect());
                    index += 1;
                    word_start = index;
                } else {
                    break;
                }
            }

            words.push(chars[word_start..index].iter().collect());

            let mut rendered = String::new();
            for (position, word) in words.iter().enumerate() {
                if position > 0 {
                    rendered.push(' ');
                }
                let at_sentence_start = sentence_start && position == 0;
                rendered.push_str(&fix_word(word, at_sentence_start));
            }

            out.push_str(&rendered);
            sentence_start = false;
            let _ = start;
            continue;
        }

        if is_sentence_end(current) {
            sentence_start = true;
        } else if !current.is_whitespace() && !matches!(current, '，' | ',' | '、' | '：' | ':')
        {
            sentence_start = false;
        }

        out.push(current);
        index += 1;
    }

    out
}

fn fix_word(word: &str, sentence_start: bool) -> String {
    if word.is_empty() {
        return String::new();
    }

    // Words that already carry lower case are left exactly as written.
    if word.chars().any(|c| c.is_ascii_lowercase()) {
        return word.to_string();
    }

    // Anything with digits is a model name or a code: leave it.
    if word.chars().any(|c| c.is_ascii_digit()) {
        return word.to_string();
    }

    let upper = word.to_ascii_uppercase();
    if ACRONYMS.contains(&upper.as_str()) {
        return upper;
    }

    let lower = word.to_ascii_lowercase();
    if let Some(proper) = PROPER.iter().find(|(key, _)| *key == lower) {
        return proper.1.to_string();
    }

    if sentence_start {
        let mut chars = lower.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => lower,
        }
    } else {
        lower
    }
}

/// Kept in capitals.
const ACRONYMS: &[&str] = &[
    "AI", "API", "ASR", "AWS", "CEO", "CI", "CLI", "CPU", "CSS", "CSV", "CTO", "DNS", "GPU", "GPT",
    "HTML", "HTTP", "HTTPS", "IDE", "ID", "IP", "JSON", "JS", "LLM", "MCP", "OCR", "OK", "PDF",
    "PR", "QA", "RAM", "RAG", "SDK", "SQL", "SSD", "TTS", "TS", "UI", "URL", "USB", "UX", "VIP",
    "VR", "XML",
];

/// Fixed spellings for names and keys.
const PROPER: &[(&str, &str)] = &[
    ("anthropic", "Anthropic"),
    ("android", "Android"),
    ("api", "API"),
    ("apple", "Apple"),
    ("chatgpt", "ChatGPT"),
    ("chrome", "Chrome"),
    ("claude", "Claude"),
    ("cursor", "Cursor"),
    ("deepseek", "DeepSeek"),
    ("docker", "Docker"),
    ("excel", "Excel"),
    ("figma", "Figma"),
    ("git", "Git"),
    ("github", "GitHub"),
    ("gitlab", "GitLab"),
    ("gmail", "Gmail"),
    ("google", "Google"),
    ("groq", "Groq"),
    ("iphone", "iPhone"),
    ("javascript", "JavaScript"),
    ("linux", "Linux"),
    ("mac", "Mac"),
    ("macos", "macOS"),
    ("microsoft", "Microsoft"),
    ("node", "Node"),
    ("notion", "Notion"),
    ("openai", "OpenAI"),
    ("python", "Python"),
    ("qwen", "Qwen"),
    ("react", "React"),
    ("safari", "Safari"),
    ("slack", "Slack"),
    ("tauri", "Tauri"),
    ("teams", "Teams"),
    ("typescript", "TypeScript"),
    ("vue", "Vue"),
    ("whisper", "Whisper"),
    ("windows", "Windows"),
    ("wifi", "WiFi"),
    ("word", "Word"),
    ("youtube", "YouTube"),
    ("zoom", "Zoom"),
];

fn is_han(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}

fn is_punctuation(c: char) -> bool {
    c.is_ascii_punctuation()
        || matches!(
            c,
            '，' | '。'
                | '！'
                | '？'
                | '；'
                | '：'
                | '、'
                | '“'
                | '”'
                | '‘'
                | '’'
                | '（'
                | '）'
                | '《'
                | '》'
                | '…'
                | '—'
                | '·'
        )
}

fn is_sentence_end(c: char) -> bool {
    matches!(c, '。' | '！' | '？' | '!' | '?' | '\n' | '；' | ';')
}

/// Strip what the polish model should never have produced.
pub fn clean_model_output(text: &str) -> String {
    let without_thinking = strip_thinking_blocks(text);
    let mut out = without_thinking.trim().to_string();

    // The whole answer fenced as one code block.
    if out.starts_with("```") && out.ends_with("```") && out.matches("```").count() == 2 {
        out = out
            .trim_start_matches("```")
            .trim_start_matches(|c: char| c.is_alphabetic())
            .trim_start_matches('\n')
            .trim_end_matches("```")
            .trim()
            .to_string();
    }

    out = strip_leading_boilerplate(&out).to_string();
    out = strip_wrapping_quotes(&out);

    // Markdown emphasis survives the prompt surprisingly often. Chinese prose
    // never needs `**`; keep the markers when the text is pure Latin so code and
    // emphasis written on purpose still work.
    if out.chars().any(is_han) {
        out = strip_markdown_emphasis(&out);
    }

    out.lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// A model that wraps the whole answer in a pair of quotes is quoting itself,
/// not the speaker. Only identical outer quotes are removed.
fn strip_wrapping_quotes(text: &str) -> String {
    let trimmed = text.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() < 3 {
        return trimmed.to_string();
    }

    let first = chars[0];
    let last = chars[chars.len() - 1];
    let pair = matches!(
        (first, last),
        ('"', '"') | ('“', '”') | ('「', '」') | ('『', '』') | ('\'', '\'')
    );

    if pair && !chars[1..chars.len() - 1].contains(&last) {
        chars[1..chars.len() - 1]
            .iter()
            .collect::<String>()
            .trim()
            .to_string()
    } else {
        trimmed.to_string()
    }
}

fn strip_thinking_blocks(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;

    while let Some(open) = lower[cursor..].find("<think") {
        let open = cursor + open;
        // `<thinking>` and `<think_more>` are other tags: only `<think` followed by
        // `>` or whitespace starts a reasoning block.
        let after_name = open + "<think".len();
        let Some((_, next)) = lower[after_name..].char_indices().next() else {
            break;
        };
        if !(next == '>' || next.is_whitespace()) {
            // Flush what we passed so the skipped tag stays in the output.
            out.push_str(&text[cursor..after_name]);
            cursor = after_name;
            continue;
        }

        let Some(tag_end) = lower[after_name..].find('>') else {
            break;
        };
        let after_open = after_name + tag_end + 1;

        let Some(close) = lower[after_open..].find("</think") else {
            break;
        };
        let close_name = after_open + close + "</think".len();
        let close_next = lower[close_name..].chars().next().unwrap_or('>');
        if !(close_next == '>' || close_next.is_whitespace()) {
            out.push_str(&text[cursor..close_name]);
            cursor = close_name;
            continue;
        }
        let Some(close_end) = lower[close_name..].find('>') else {
            break;
        };

        out.push_str(&text[cursor..open]);
        cursor = close_name + close_end + 1;
    }

    out.push_str(&text[cursor..]);
    out
}

fn strip_leading_boilerplate(text: &str) -> &str {
    let lower = text.to_ascii_lowercase();

    for prefix in LEADING_BOILERPLATE {
        if !lower.starts_with(prefix) {
            continue;
        }

        let after = &text[prefix.len()..];
        for (index, c) in after.char_indices() {
            if BOILERPLATE_END.contains(&c) {
                return after[index + c.len_utf8()..].trim_start();
            }
        }
        return after.trim_start();
    }

    text
}

fn strip_markdown_emphasis(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(start) = rest.find("**") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("**") else {
            break;
        };
        let inner = &after[..end];
        out.push_str(&rest[..start]);
        out.push_str(inner);
        rest = &after[end + 2..];
    }
    out.push_str(rest);

    out.lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with('#') && trimmed.chars().any(is_han) {
                trimmed.trim_start_matches('#').trim_start()
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filler_only_transcripts_are_detected() {
        assert!(is_filler_only("嗯……啊，呃。"));
        assert!(is_filler_only("um, uh."));
        assert!(!is_filler_only("嗯，好的"));
        assert!(!is_filler_only("嗯嗯 明天见"));
        assert!(!is_filler_only(""));
    }

    #[test]
    fn stock_phrases_are_detected() {
        assert!(is_stock_phrase(
            "请不吝点赞、订阅、转发、打赏支持明镜与点点栏目"
        ));
        assert!(is_stock_phrase("谢谢观看！"));
        assert!(is_stock_phrase("字幕由 Amara.org 社区提供"));
        assert!(!is_stock_phrase("记得点赞关注我的频道"));
    }

    #[test]
    fn all_caps_english_is_repaired_in_mixed_text() {
        let out = normalize_english_case("我用 GITHUB 和 CURSOR 写 TYPESCRIPT");
        assert_eq!(out, "我用 GitHub 和 Cursor 写 TypeScript");
    }

    #[test]
    fn acronyms_and_model_names_survive() {
        let out = normalize_english_case("调用 API 和 GPT 还有 DEEPSEEK");
        assert_eq!(out, "调用 API 和 GPT 还有 DeepSeek");
    }

    #[test]
    fn pure_english_is_left_alone() {
        assert_eq!(normalize_english_case("HELLO EVERYONE"), "HELLO EVERYONE");
    }

    fn tagged(name: &str, body: &str) -> String {
        format!("<{name}>{body}</{name}>")
    }

    #[test]
    fn thinking_blocks_are_removed() {
        let raw = format!(
            "{}\n\n明天十点提醒我开会。",
            tagged("think", "先分析意图。\n很多字。")
        );
        assert_eq!(clean_model_output(&raw), "明天十点提醒我开会。");
    }

    #[test]
    fn unknown_tags_are_kept_as_text() {
        let other = tagged("thinking", "保留");
        assert_eq!(clean_model_output(&other), other);
    }

    #[test]
    fn fenced_answers_are_unwrapped() {
        let out = clean_model_output("```text\n把这句话写进文档。\n```");
        assert_eq!(out, "把这句话写进文档。");
    }

    #[test]
    fn boilerplate_prefixes_are_dropped() {
        assert_eq!(
            clean_model_output("整理后的文本：明天十点开会。"),
            "明天十点开会。"
        );
        assert_eq!(
            clean_model_output("Sure, here is the cleaned text: Remind me at ten."),
            "Remind me at ten."
        );
    }

    #[test]
    fn markdown_emphasis_is_stripped_only_for_chinese() {
        assert_eq!(clean_model_output("**明天**开会"), "明天开会");
        assert_eq!(clean_model_output("**bold** stays"), "**bold** stays");
    }

    #[test]
    fn headings_are_stripped_when_the_line_is_chinese() {
        assert_eq!(
            clean_model_output("## 结论\n明天十点开会"),
            "结论\n明天十点开会"
        );
    }
}
