//! API keys belong in the OS credential store, not next to the history file.
//!
//! The settings file still carries `apiKey` so the rest of the app (readiness
//! checks, connectivity tests, the provider form) keeps working unchanged. This
//! module only decides what reaches disk: on save the key is copied into the
//! system keychain and stripped from the JSON; on load it is read back into
//! memory. If the keychain is unavailable (headless Linux, locked store) the
//! key falls back to the 0600 settings file instead of being lost, and the
//! providers page tells the user that happened.

use std::sync::OnceLock;

use keyring::Entry;

use crate::model::AppSettings;

/// The keychain service name. It is the app identifier, so users can find the
/// items in Keychain Access / Credential Manager under a recognisable name.
const SERVICE: &str = "app.sona.desktop";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SecretKind {
    Asr,
    Polish,
}

impl SecretKind {
    fn account(self) -> &'static str {
        match self {
            SecretKind::Asr => "asr-api-key",
            SecretKind::Polish => "polish-api-key",
        }
    }
}

/// A key resolved for this session, plus whether a legacy plaintext key was
/// moved into the keychain (which means the settings file must be rewritten).
pub struct ResolvedSecret {
    pub value: String,
    pub migrated: bool,
}

fn entry(kind: SecretKind) -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE, kind.account())
}

/// Read the key for `kind`, migrating a legacy plaintext value when possible.
///
/// A non-empty plaintext key always wins over the keychain: it is the user's
/// current value from an older version, and may be newer than whatever is in
/// the store. Only after it is successfully copied do we stop writing it to
/// disk.
pub fn resolve(kind: SecretKind, plaintext: &str) -> ResolvedSecret {
    if !plaintext.trim().is_empty() {
        return match entry(kind).and_then(|item| item.set_password(plaintext)) {
            Ok(()) => ResolvedSecret {
                value: plaintext.to_owned(),
                migrated: true,
            },
            Err(error) => {
                eprintln!(
                    "keychain unavailable, keeping {} in settings.json: {error}",
                    kind.account()
                );
                ResolvedSecret {
                    value: plaintext.to_owned(),
                    migrated: false,
                }
            }
        };
    }

    match entry(kind).and_then(|item| item.get_password()) {
        Ok(value) => ResolvedSecret {
            value,
            migrated: false,
        },
        Err(keyring::Error::NoEntry) => ResolvedSecret {
            value: String::new(),
            migrated: false,
        },
        Err(error) => {
            eprintln!(
                "could not read {} from the keychain: {error}",
                kind.account()
            );
            ResolvedSecret {
                value: String::new(),
                migrated: false,
            }
        }
    }
}

/// Copy `value` into the keychain and say whether the file copy may be removed.
///
/// An empty value deletes the entry: clearing the key in the UI must not leave
/// an old credential behind. If the store rejects a real key we return `false`
/// and the caller keeps it in the settings file.
pub fn sync(kind: SecretKind, value: &str) -> bool {
    if value.trim().is_empty() {
        if let Ok(item) = entry(kind) {
            match item.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(error) => eprintln!("could not clear {}: {error}", kind.account()),
            }
        }
        return true;
    }

    match entry(kind).and_then(|item| item.set_password(value)) {
        Ok(()) => true,
        Err(error) => {
            eprintln!(
                "could not store {} in the keychain: {error}",
                kind.account()
            );
            false
        }
    }
}

/// A copy of the settings that is safe to write to disk.
///
/// `stash` is injectable so the stripping rule can be tested without touching
/// the real keychain.
pub fn settings_for_disk_with<F>(settings: &AppSettings, mut stash: F) -> AppSettings
where
    F: FnMut(SecretKind, &str) -> bool,
{
    let mut disk = settings.clone();
    for (kind, provider) in [
        (SecretKind::Asr, &mut disk.voice.asr),
        (SecretKind::Polish, &mut disk.voice.polish),
    ] {
        if stash(kind, &provider.api_key) {
            provider.api_key.clear();
        }
    }
    disk
}

pub fn settings_for_disk(settings: &AppSettings) -> AppSettings {
    settings_for_disk_with(settings, sync)
}

/// Which store this process can actually use. Cached because initialising the
/// Secret Service store can be slow, and the answer does not change at runtime.
pub fn backend() -> &'static str {
    static BACKEND: OnceLock<&'static str> = OnceLock::new();
    BACKEND.get_or_init(|| {
        if Entry::store_status().is_ok() {
            "keychain"
        } else {
            "file"
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ProviderSettings;

    fn settings_with_keys(asr: &str, polish: &str) -> AppSettings {
        let mut settings = AppSettings::default();
        settings.voice.asr = ProviderSettings {
            preset: "groq".into(),
            api_key: asr.into(),
            ..Default::default()
        };
        settings.voice.polish = ProviderSettings {
            preset: "deepseek".into(),
            api_key: polish.into(),
            ..Default::default()
        };
        settings
    }

    #[test]
    fn keys_are_stripped_when_the_store_accepts_them() {
        let settings = settings_with_keys("asr-secret", "polish-secret");
        let disk = settings_for_disk_with(&settings, |_, _| true);

        assert!(disk.voice.asr.api_key.is_empty());
        assert!(disk.voice.polish.api_key.is_empty());
        // The in-memory copy is untouched: the UI and pipeline still need it.
        assert_eq!(settings.voice.asr.api_key, "asr-secret");
    }

    #[test]
    fn failed_store_keeps_the_key_in_the_file() {
        let settings = settings_with_keys("asr-secret", "polish-secret");
        // ASR fails, polish succeeds: only the failed one stays on disk.
        let disk = settings_for_disk_with(&settings, |kind, _| kind == SecretKind::Polish);

        assert_eq!(disk.voice.asr.api_key, "asr-secret");
        assert!(disk.voice.polish.api_key.is_empty());
    }
}
