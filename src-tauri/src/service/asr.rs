use std::time::Duration;

use reqwest::multipart::{Form, Part};

use crate::model::ProviderSettings;

/// Ask a local server which models it has. Same `/models` shape as OpenAI, and
/// some bundled servers (faster-whisper-server) expose exactly this.
pub async fn list_models(base_url: &str) -> Result<Vec<String>, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("local_asr_url_required".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|error| format!("local_asr_client: {error}"))?;

    let response = client
        .get(format!("{base}/models"))
        .send()
        .await
        .map_err(|error| format!("local_asr_unreachable: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("local_asr_body: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "local_asr_http_{}: {}",
            status.as_u16(),
            truncate(&body, 300)
        ));
    }

    let models = parse_models(&body)?;
    if models.is_empty() {
        return Err(format!("local_asr_no_models: {}", truncate(&body, 300)));
    }
    Ok(models)
}

/// Accept both `{ "data": [{ "id": … }] }` and a bare array of names, because
/// self-hosted servers are not always careful about the envelope.
fn parse_models(body: &str) -> Result<Vec<String>, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|error| format!("local_asr_json: {error}"))?;

    let mut models: Vec<String> = Vec::new();
    let mut push = |value: Option<&serde_json::Value>| {
        if let Some(text) = value.and_then(|value| value.as_str()) {
            let text = text.trim();
            if !text.is_empty() {
                models.push(text.to_string());
            }
        }
    };

    if let Some(items) = parsed.get("data").and_then(|value| value.as_array()) {
        for item in items {
            push(item.get("id"));
            push(item.get("name"));
        }
    } else if let Some(items) = parsed.as_array() {
        for item in items {
            push(Some(item));
            push(item.get("id"));
            push(item.get("name"));
        }
    }

    models.sort();
    models.dedup();
    Ok(models)
}

/// Transcribe one audio blob through an OpenAI-compatible `/audio/transcriptions`.
///
/// Every supported vendor (OpenAI, Groq, SiliconFlow, DashScope compatible mode,
/// self-hosted faster-whisper) speaks this shape, so one implementation covers
/// the cloud path on all three desktops and both mobile targets.
pub async fn transcribe(
    provider: &ProviderSettings,
    audio: Vec<u8>,
    mime: &str,
    language: &str,
) -> Result<String, String> {
    if !provider.is_configured() {
        return Err("asr_not_configured".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("asr_client: {error}"))?;

    let file_name = match mime {
        "audio/wav" | "audio/wave" | "audio/x-wav" => "audio.wav",
        "audio/mp4" | "audio/m4a" => "audio.m4a",
        "audio/ogg" => "audio.ogg",
        "audio/mpeg" => "audio.mp3",
        _ => "audio.webm",
    };

    let part = Part::bytes(audio)
        .file_name(file_name.to_string())
        .mime_str(mime)
        .map_err(|error| format!("asr_mime: {error}"))?;

    let mut form = Form::new()
        .part("file", part)
        .text("model", provider.model.clone())
        .text("response_format", "json");

    if !language.trim().is_empty() && language != "auto" {
        form = form.text("language", language.to_string());
    }

    let mut request = client
        .post(provider.endpoint("audio/transcriptions"))
        .multipart(form);

    if !provider.api_key.trim().is_empty() {
        request = request.bearer_auth(provider.api_key.trim());
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("asr_request: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("asr_body: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "asr_http_{}: {}",
            status.as_u16(),
            truncate(&body, 400)
        ));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|error| format!("asr_json: {error}"))?;

    parsed
        .get("text")
        .and_then(|value| value.as_str())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("asr_empty: {}", truncate(&body, 400)))
}

pub fn truncate(value: &str, max: usize) -> String {
    let mut out = String::with_capacity(max.min(value.len()));
    for (index, ch) in value.chars().enumerate() {
        if index >= max {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

/// Reachability check for the ASR endpoint: `GET {base}/models`.
///
/// We deliberately do not upload a fake clip — a probe should not spend the
/// user's quota, and a 200 on the model list already proves URL + key are good.
pub async fn probe(provider: &ProviderSettings) -> Result<Option<usize>, String> {
    if !provider.is_configured() {
        return Err("asr_not_configured".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("asr_client: {error}"))?;

    let mut request = client.get(provider.endpoint("models"));
    if !provider.api_key.trim().is_empty() {
        request = request.bearer_auth(provider.api_key.trim());
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("asr_probe: {error}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "asr_probe_http_{}: {}",
            status.as_u16(),
            truncate(&body, 200)
        ));
    }

    let count = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("data")
                .and_then(|data| data.as_array().map(Vec::len))
        });

    // The frontend translates the count. Keeping prose out of the backend
    // means "reachable" reads naturally in both languages.
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::{parse_models, truncate};

    #[test]
    fn truncate_keeps_chars_whole() {
        assert_eq!(truncate("你好世界", 2), "你好…");
        assert_eq!(truncate("ok", 10), "ok");
    }

    #[test]
    fn reads_the_openai_model_list() {
        let body = r#"{"object":"list","data":[{"id":"Systran/faster-whisper-small"},{"id":"whisper-1"}]}"#;
        assert_eq!(
            parse_models(body).unwrap(),
            vec!["Systran/faster-whisper-small", "whisper-1"]
        );
    }

    #[test]
    fn reads_a_bare_array_of_names() {
        let body = r#"["ggml-small.en", "ggml-base"]"#;
        assert_eq!(
            parse_models(body).unwrap(),
            vec!["ggml-base", "ggml-small.en"]
        );
    }

    #[test]
    fn tolerates_junk_instead_of_panicking() {
        assert!(parse_models("not json").is_err());
        assert!(parse_models(r#"{"data":[{}]}"#).unwrap().is_empty());
    }
}
