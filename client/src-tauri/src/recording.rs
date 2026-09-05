use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

const MAX_RECORDING_BASE64_BYTES: usize = 86 * 1024 * 1024;

#[tauri::command]
pub(crate) async fn save_recording(
    title: String,
    album: String,
    profile: String,
    saved_at: String,
    media_type: String,
    audio_base64: String,
    microphone_audio_base64: Option<String>,
) -> Result<String, String> {
    let microphone_base64_len = microphone_audio_base64.as_deref().map_or(0, str::len);
    if audio_base64.len() + microphone_base64_len > MAX_RECORDING_BASE64_BYTES {
        return Err("The recording is too large to save".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let audio = B64
            .decode(audio_base64)
            .map_err(|_| "The recording data is invalid".to_string())?;
        let microphone_audio = microphone_audio_base64
            .map(|encoded| {
                B64.decode(encoded)
                    .map_err(|_| "The microphone recording data is invalid".to_string())
            })
            .transpose()?;
        app_core::save_recording(
            &title,
            &album,
            &profile,
            &saved_at,
            &media_type,
            &audio,
            microphone_audio.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("Could not save the recording: {error}"))?
}
