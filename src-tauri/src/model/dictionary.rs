use serde::{Deserialize, Serialize};

/// A term the recogniser keeps getting wrong, plus the spellings it produces.
///
/// `aliases` is the reverse mapping ("git" ← "get"): every alias occurrence in the
/// transcript is rewritten to `term` before polish, and the whole entry is also
/// injected into the polish prompt as a glossary hint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub id: String,
    pub term: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub hits: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryInput {
    pub term: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}
