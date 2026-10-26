//! The text around the caret, used to keep tone and terminology consistent.
//!
//! Reading it is a courtesy, never a requirement: every failure path returns an
//! empty string and the pipeline carries on without context.

use tauri::AppHandle;

/// Tail of the focused text field, at most `limit` characters.
pub async fn read(app: &AppHandle, limit: u32) -> String {
    if limit == 0 {
        return String::new();
    }

    let raw = match read_focused_text(app).await {
        Ok(text) => text,
        Err(_) => return String::new(),
    };

    tail(&raw, limit)
}

/// The last `limit` characters — the caret is at the end, so that is the part
/// the writing continues from.
pub fn tail(text: &str, limit: u32) -> String {
    if limit == 0 || text.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = text.chars().collect();
    let start = chars.len().saturating_sub(limit as usize);
    chars[start..]
        .iter()
        .collect::<String>()
        .trim_end()
        .to_string()
}

#[cfg(target_os = "macos")]
async fn read_focused_text(_app: &AppHandle) -> Result<String, String> {
    // `AXValue` is what an editable field reports; `missing value` means the
    // focused element has no text (a button, a list, the desktop).
    const SCRIPT: &str = r#"
tell application "System Events"
  tell (first application process whose frontmost is true)
    try
      set v to value of attribute "AXValue" of focused UI element
      if v is missing value then return ""
      return v as string
    on error
      return ""
    end try
  end tell
end tell
"#;

    let output = tauri::async_runtime::spawn_blocking(|| {
        std::process::Command::new("osascript")
            .args(["-e", SCRIPT])
            .output()
    })
    .await
    .map_err(|error| format!("context_join: {error}"))?
    .map_err(|error| format!("context_spawn: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "context_denied: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}

#[cfg(not(target_os = "macos"))]
async fn read_focused_text(_app: &AppHandle) -> Result<String, String> {
    // Windows would need UI Automation and Linux an AT-SPI bridge; until either
    // is written, dictation works without context instead of guessing.
    Err("context_unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::tail;

    #[test]
    fn keeps_the_end_of_the_field() {
        assert_eq!(tail("前文在这里，继续写", 4), "，继续写");
        assert_eq!(tail("abc", 10), "abc");
        assert_eq!(tail("abc", 0), "");
        assert_eq!(tail("", 5), "");
    }

    #[test]
    fn counts_characters_not_bytes() {
        assert_eq!(
            tail("中文三个字", 3),
            "三个字".chars().take(3).collect::<String>()
        );
    }
}
