//! Automatic analysis settings sized to the machine's GPU.
//!
//! On first launch Nightingale reads the GPU and its memory (`nvidia-smi`,
//! Apple Silicon unified memory, or CPU) and picks a transcription model and
//! batch size that fit, instead of the one-size `large-v3` / 8 defaults that
//! overflow 6 GB cards. The first analyses then act as a calibration: when
//! the GPU still runs out of memory, [`step_down_after_oom`] lowers the
//! settings one notch, saves them, and the analyzer retries.
//!
//! Settings the user picked by hand are never touched: tuning only applies
//! while the configured model and batch size are the ones it chose itself
//! (or were never set).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::config::AppConfig;
use crate::vendor::silent_command;

/// Lighter models, in the order the calibration falls back to them.
const MODEL_LADDER: &[&str] = &["large-v3", "large-v3-turbo", "medium", "small"];

/// What the automatic tuning detected and chose. Stored in `config.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AnalysisAutoTune {
    /// `cuda`, `mps` or `cpu`.
    pub device: String,
    pub gpu_name: Option<String>,
    /// GPU memory for CUDA, unified memory for Apple Silicon.
    #[ts(type = "number | null")]
    pub memory_mib: Option<u64>,
    /// Settings tuning applied; `None` when the user had already chosen
    /// their own, which tuning leaves alone.
    pub model: Option<String>,
    pub batch_size: Option<u32>,
    /// The calibration lowered the settings after running out of GPU memory.
    #[serde(default)]
    pub reduced_after_oom: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct Hardware {
    device: &'static str,
    gpu_name: Option<String>,
    memory_mib: Option<u64>,
}

/// Startup hook: tune once, on the first launch that has this feature.
pub(crate) fn auto_configure_once() {
    let config = AppConfig::load();
    if config.analysis_auto_tune.is_some() {
        return;
    }
    let respect_user_choice = config.whisper_model.is_some() || config.batch_size.is_some();
    apply(config, !respect_user_choice);
}

/// "Régler automatiquement" from Settings: detect again and overwrite the
/// model and batch size, even if they were set by hand.
pub fn auto_tune_analysis() -> AnalysisAutoTune {
    apply(AppConfig::load(), true)
}

fn apply(mut config: AppConfig, overwrite: bool) -> AnalysisAutoTune {
    let hardware = detect_hardware();
    let (model, batch_size) = recommend(&hardware);
    let state = AnalysisAutoTune {
        device: hardware.device.to_owned(),
        gpu_name: hardware.gpu_name,
        memory_mib: hardware.memory_mib,
        model: overwrite.then(|| model.to_owned()),
        batch_size: overwrite.then_some(batch_size),
        reduced_after_oom: false,
    };
    if overwrite {
        config.whisper_model = Some(model.to_owned());
        config.batch_size = Some(batch_size);
    }
    tracing::info!(
        "[tuning] {} {:?} ({:?} MiB): model={model} batch_size={batch_size} applied={overwrite}",
        state.device,
        state.gpu_name,
        state.memory_mib
    );
    config.analysis_auto_tune = Some(state.clone());
    config.save();
    state
}

/// Settings that fit the detected hardware.
fn recommend(hardware: &Hardware) -> (&'static str, u32) {
    match (hardware.device, hardware.memory_mib) {
        ("cuda", Some(mib)) if mib >= 11_000 => ("large-v3", 8),
        ("cuda", Some(mib)) if mib >= 7_500 => ("large-v3", 4),
        ("cuda", Some(mib)) if mib >= 5_500 => ("large-v3-turbo", 4),
        ("cuda", Some(mib)) if mib >= 3_500 => ("large-v3-turbo", 2),
        ("cuda", Some(_)) => ("small", 2),
        // Memory unknown: a middle ground the calibration can still lower.
        ("cuda", None) => ("large-v3-turbo", 4),
        ("mps", Some(mib)) if mib >= 16_000 => ("large-v3-turbo", 8),
        ("mps", _) => ("large-v3-turbo", 4),
        // CPU: turbo decodes much faster than large-v3 at similar quality.
        _ => ("large-v3-turbo", 4),
    }
}

/// The next lighter setting: halve the batch down to 2, then move to a
/// lighter model (batch 2), then batch 1. `None` once nothing is left.
fn next_lower(model: &str, batch_size: u32) -> Option<(String, u32)> {
    if batch_size > 2 {
        return Some((model.to_owned(), (batch_size / 2).max(2)));
    }
    let position = MODEL_LADDER
        .iter()
        .position(|candidate| *candidate == model);
    if let Some(lighter) = position.and_then(|index| MODEL_LADDER.get(index + 1)) {
        return Some(((*lighter).to_owned(), 2));
    }
    (batch_size > 1).then(|| (model.to_owned(), 1))
}

/// The settings to retry with after a CUDA out-of-memory error, already
/// saved to the config. `None` when tuning does not own the settings (the
/// user chose them) or they cannot go lower.
pub(crate) fn step_down_after_oom() -> Option<(String, u32)> {
    let mut config = AppConfig::load();
    let state = config.analysis_auto_tune.clone()?;
    // Untouched defaults are not a user choice either.
    let defaults = config.whisper_model.is_none() && config.batch_size.is_none();
    let owned = defaults
        || (state.model.as_deref() == Some(config.whisper_model())
            && state.batch_size == Some(config.batch_size()));
    if !owned {
        return None;
    }
    let (model, batch_size) = next_lower(config.whisper_model(), config.batch_size())?;
    tracing::warn!("[tuning] out of GPU memory: lowering to model={model} batch_size={batch_size}");
    config.whisper_model = Some(model.clone());
    config.batch_size = Some(batch_size);
    config.analysis_auto_tune = Some(AnalysisAutoTune {
        model: Some(model.clone()),
        batch_size: Some(batch_size),
        reduced_after_oom: true,
        ..state
    });
    config.save();
    Some((model, batch_size))
}

// ─── Hardware detection ────────────────────────────────────────────────────

fn detect_hardware() -> Hardware {
    if cfg!(target_os = "macos") {
        let device = if cfg!(target_arch = "aarch64") {
            "mps"
        } else {
            "cpu"
        };
        return Hardware {
            device,
            gpu_name: None,
            memory_mib: (device == "mps").then(mac_memory_mib).flatten(),
        };
    }
    match nvidia_gpu() {
        Some((name, memory_mib)) => Hardware {
            device: "cuda",
            gpu_name: Some(name),
            memory_mib,
        },
        None => Hardware {
            device: "cpu",
            gpu_name: None,
            memory_mib: None,
        },
    }
}

/// Largest NVIDIA GPU as `(name, memory MiB)`.
fn nvidia_gpu() -> Option<(String, Option<u64>)> {
    let output = silent_command("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    parse_nvidia_smi(&String::from_utf8_lossy(&output.stdout))
}

fn parse_nvidia_smi(text: &str) -> Option<(String, Option<u64>)> {
    text.lines()
        .filter_map(|line| {
            let (name, memory) = line.rsplit_once(',')?;
            let name = name.trim();
            (!name.is_empty()).then(|| (name.to_owned(), memory.trim().parse::<u64>().ok()))
        })
        .max_by_key(|(_, memory)| memory.unwrap_or(0))
}

fn mac_memory_mib() -> Option<u64> {
    let output = silent_command("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u64>()
        .ok()
        .map(|bytes| bytes / (1024 * 1024))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cuda(memory_mib: u64) -> Hardware {
        Hardware {
            device: "cuda",
            gpu_name: Some("GPU".into()),
            memory_mib: Some(memory_mib),
        }
    }

    #[test]
    fn recommendations_follow_gpu_memory() {
        assert_eq!(recommend(&cuda(24_576)), ("large-v3", 8));
        assert_eq!(recommend(&cuda(8_192)), ("large-v3", 4));
        assert_eq!(recommend(&cuda(6_144)), ("large-v3-turbo", 4));
        assert_eq!(recommend(&cuda(4_096)), ("large-v3-turbo", 2));
        assert_eq!(recommend(&cuda(2_048)), ("small", 2));
        let cpu = Hardware {
            device: "cpu",
            gpu_name: None,
            memory_mib: None,
        };
        assert_eq!(recommend(&cpu), ("large-v3-turbo", 4));
    }

    #[test]
    fn step_down_ladder_ends() {
        assert_eq!(next_lower("large-v3", 8), Some(("large-v3".into(), 4)));
        assert_eq!(next_lower("large-v3", 4), Some(("large-v3".into(), 2)));
        assert_eq!(
            next_lower("large-v3", 2),
            Some(("large-v3-turbo".into(), 2))
        );
        assert_eq!(next_lower("large-v3-turbo", 2), Some(("medium".into(), 2)));
        assert_eq!(next_lower("small", 2), Some(("small".into(), 1)));
        assert_eq!(next_lower("small", 1), None);
        // Models outside the ladder only lose batch size.
        assert_eq!(next_lower("tiny", 2), Some(("tiny".into(), 1)));

        let mut steps = 0;
        let mut current = Some(("large-v3".to_string(), 8));
        while let Some((model, batch)) = current {
            current = next_lower(&model, batch);
            steps += 1;
        }
        assert!(steps < 10);
    }

    #[test]
    fn nvidia_smi_output_is_parsed() {
        assert_eq!(
            parse_nvidia_smi("NVIDIA GeForce RTX 2060, 6144\n"),
            Some(("NVIDIA GeForce RTX 2060".into(), Some(6144)))
        );
        assert_eq!(
            parse_nvidia_smi("GPU A, 4096\nGPU B, 12288\n").map(|(name, _)| name),
            Some("GPU B".into())
        );
        assert_eq!(parse_nvidia_smi(""), None);
    }
}
