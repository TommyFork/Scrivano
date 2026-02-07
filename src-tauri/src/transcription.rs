use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::path::Path;
use std::time::Duration;

#[derive(Deserialize)]
struct WhisperResponse {
    text: String,
}

pub async fn transcribe_audio(audio_path: &Path, api_key: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let file_bytes =
        std::fs::read(audio_path).map_err(|e| format!("Failed to read audio file: {}", e))?;

    let file_part = Part::bytes(file_bytes)
        .file_name(
            audio_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("audio.wav")
                .to_string(),
        )
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to set MIME type: {}", e))?;

    let form = Form::new()
        .part("file", file_part)
        .text("model", "whisper-1")
        .text("language", "en");

    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if status == 429 || body.contains("insufficient_quota") {
            return Err(
                "OpenAI quota exceeded - check your billing at platform.openai.com".to_string(),
            );
        }
        if status == 401 {
            return Err("Invalid OpenAI API key".to_string());
        }
        return Err(format!("API error ({}): {}", status, body));
    }

    let whisper_response: WhisperResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let text = whisper_response.text.trim().to_string();

    // Whisper hallucinates these strings on silence/short audio.
    // Only include phrases that are almost never intentional single-utterance transcriptions.
    let hallucinations = [
        "you",
        "thank you",
        "thank you.",
        "thanks for watching.",
        "thanks for watching",
        "subscribe.",
    ];
    if hallucinations.iter().any(|h| text.eq_ignore_ascii_case(h)) {
        eprintln!(
            "[Scrivano] Filtered likely Whisper hallucination: {:?}",
            text
        );
        return Err("No speech detected — hold the key longer and speak clearly".to_string());
    }

    Ok(text)
}
