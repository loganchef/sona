use serde::{Deserialize, Serialize};

/// A phrase the user says; the text Sona types instead.
///
/// The dictionary fixes *spelling* of a word. A snippet replaces a whole spoken
/// phrase with a block of prepared text: 「我的邮箱」 → the address, 「周报模板」
/// → a filled-in outline. Expansion happens after polishing, so the model never
/// gets a chance to rewrite the block.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    /// What the speaker says. Matched case-insensitively for ASCII, loosely for CJK.
    pub trigger: String,
    /// What lands in the document. May contain line breaks.
    pub expansion: String,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub hits: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetInput {
    pub trigger: String,
    pub expansion: String,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}
