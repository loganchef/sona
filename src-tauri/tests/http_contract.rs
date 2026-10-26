//! Network contract with an OpenAI-compatible endpoint.
//!
//! These tests run a throwaway HTTP server on localhost, so the whole request
//! shape is exercised for real: URL joining, bearer auth, multipart upload,
//! JSON parsing, output cleaning and the error path. No API key, no network.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use sona_lib::model::ProviderSettings;
use sona_lib::service::{asr, polish};

#[derive(Default, Clone)]
struct Captured {
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

/// Serve exactly `count` requests, answering each with the same canned body.
fn mock_server(
    count: usize,
    status: &'static str,
    body: &'static str,
) -> (String, Arc<Mutex<Vec<Captured>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();

    thread::spawn(move || {
        for stream in listener.incoming().take(count) {
            let Ok(mut stream) = stream else { continue };
            let request = read_request(&mut stream);
            sink.lock().unwrap().push(request);
            write_response(&mut stream, status, body);
        }
    });

    (format!("http://127.0.0.1:{port}/v1"), seen)
}

fn read_request(stream: &mut TcpStream) -> Captured {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    let mut line = String::new();
    reader.read_line(&mut line).expect("request line");
    let path = line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_string();

    let mut headers = Vec::new();
    loop {
        let mut header = String::new();
        reader.read_line(&mut header).expect("header");
        if header == "\r\n" || header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }

    let length = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);

    let mut body = vec![0u8; length];
    if length > 0 {
        reader.read_exact(&mut body).expect("body");
    }

    Captured {
        path,
        headers,
        body,
    }
}

fn write_response(stream: &mut TcpStream, status: &'static str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn provider(base_url: &str) -> ProviderSettings {
    ProviderSettings {
        preset: "custom".into(),
        base_url: base_url.into(),
        api_key: "sk-local-test".into(),
        model: "test-model".into(),
    }
}

#[test]
fn transcription_posts_multipart_with_auth() {
    let (base, seen) = mock_server(1, "200 OK", r#"{"text":"你好，这是测试。"}"#);

    let text = tauri::async_runtime::block_on(asr::transcribe(
        &provider(&base),
        vec![0x1a, 0x45, 0xdf, 0xa3],
        "audio/webm",
        "auto",
    ))
    .expect("transcribe");

    assert_eq!(text, "你好，这是测试。");

    let captured = seen.lock().unwrap();
    let request = captured.first().expect("one request");
    assert_eq!(request.path, "/v1/audio/transcriptions");
    assert!(request
        .headers
        .iter()
        .any(|(name, value)| name == "authorization" && value == "Bearer sk-local-test"));
    assert!(request
        .headers
        .iter()
        .any(|(name, value)| name == "content-type" && value.starts_with("multipart/form-data")));
}

#[test]
fn polish_sends_json_and_cleans_the_answer() {
    let (base, seen) = mock_server(
        1,
        "200 OK",
        r#"{"choices":[{"message":{"content":"整理后的文本：明天十点开会。"}}]}"#,
    );

    let messages = polish::build_messages(&polish::PolishInput {
        mode: "light",
        output_language: "auto",
        context: "",
        glossary: &[],
        phrases: &[],
        custom: "",
        raw: "嗯 明天十点开会",
    });

    let text =
        tauri::async_runtime::block_on(polish::run(&provider(&base), messages)).expect("polish");
    assert_eq!(text, "明天十点开会。");

    let captured = seen.lock().unwrap();
    let request = captured.first().expect("one request");
    assert_eq!(request.path, "/v1/chat/completions");
    let body = String::from_utf8_lossy(&request.body);
    assert!(body.contains("\"model\":\"test-model\""));
    assert!(body.contains("\"stream\":false"));
}

#[test]
fn a_rejected_key_is_reported_with_its_status() {
    let (base, _seen) = mock_server(1, "401 Unauthorized", r#"{"error":{"message":"bad key"}}"#);

    let error = tauri::async_runtime::block_on(asr::transcribe(
        &provider(&base),
        vec![1, 2, 3],
        "audio/webm",
        "auto",
    ))
    .expect_err("401 must fail");

    assert!(error.contains("asr_http_401"), "unexpected error: {error}");
}

#[test]
fn asr_probe_lists_models_with_auth() {
    let (base, seen) = mock_server(
        1,
        "200 OK",
        r#"{"data":[{"id":"whisper-small"},{"id":"whisper-large"}]}"#,
    );

    let count = tauri::async_runtime::block_on(asr::probe(&provider(&base))).expect("probe");
    assert_eq!(count, Some(2));

    let captured = seen.lock().unwrap();
    let request = captured.first().expect("one request");
    assert_eq!(request.path, "/v1/models");
    assert!(request
        .headers
        .iter()
        .any(|(name, value)| name == "authorization" && value == "Bearer sk-local-test"));
}

#[test]
fn polish_probe_sends_one_minimal_request() {
    let (base, seen) = mock_server(
        1,
        "200 OK",
        r#"{"choices":[{"message":{"content":"pong"}}]}"#,
    );

    tauri::async_runtime::block_on(polish::probe(&provider(&base))).expect("probe");

    let captured = seen.lock().unwrap();
    let request = captured.first().expect("one request");
    assert_eq!(request.path, "/v1/chat/completions");
    let body = String::from_utf8_lossy(&request.body);
    assert!(body.contains("\"model\":\"test-model\""));
    assert!(body.contains("\"max_tokens\":1"));
    assert!(body.contains("\"content\":\"ping\""));
}

#[test]
fn a_rejected_probe_keeps_the_status_code() {
    let (base, _seen) = mock_server(1, "401 Unauthorized", r#"{"error":{"message":"bad key"}}"#);

    let error =
        tauri::async_runtime::block_on(asr::probe(&provider(&base))).expect_err("401 must fail");
    assert!(
        error.contains("asr_probe_http_401"),
        "unexpected error: {error}"
    );
}
