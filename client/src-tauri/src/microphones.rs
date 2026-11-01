use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::ipc::Channel;
use tracing::{info, warn};
use ts_rs::TS;

/// Worker drains the cpal queue in fixed-size chunks before forwarding to the
/// JS side; smaller chunks lower IPC latency at the cost of more sends/sec.
const SAMPLE_CHUNK: usize = 512;
const AUDIO_QUEUE_CAP: usize = 24_000;
const PCM_QUEUE_CAP: usize = 24_000;
const MONITOR_START_BUFFER: usize = 512;
const DEFAULT_MONITOR_GAIN: f32 = 0.65;
const MAX_MONITOR_GAIN: f32 = 2.0;

static MONITOR_GAIN_BITS: AtomicU32 = AtomicU32::new(DEFAULT_MONITOR_GAIN.to_bits());

type SampleSink = Arc<dyn Fn(&[f32]) + Send + Sync>;
type SampleSource = Arc<Mutex<Box<dyn FnMut() -> f32 + Send>>>;

fn monitor_gain() -> f32 {
    f32::from_bits(MONITOR_GAIN_BITS.load(Ordering::Relaxed))
}

pub(crate) fn set_monitor_gain(gain: f32) {
    let clamped = gain.clamp(0.0, MAX_MONITOR_GAIN);
    MONITOR_GAIN_BITS.store(clamped.to_bits(), Ordering::Relaxed);
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub(crate) struct MicrophoneInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub channel_count: u16,
}

/// Mono PCM frame streamed from Rust to JS. JS owns all DSP (pitch, reactive
/// analysis) and runs it on a sliding window built from these frames.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct MicSampleFrame {
    pub sample_rate: u32,
    pub samples: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(default)]
#[derive(Default)]
pub(crate) struct MicCaptureOptions {
    pub emit_audio: bool,
}

fn device_display_name(device: &cpal::Device) -> String {
    let Ok(desc) = device.description() else {
        return "(unknown)".into();
    };
    if let Some(friendly) = desc.extended().next() {
        return friendly.to_owned();
    }
    desc.to_string()
}

/// Returns all available audio host APIs on this platform with human-readable labels.
/// On Windows: includes both WASAPI and ASIO (when available)
/// On other platforms: uses the platform's default audio API
fn audio_hosts() -> Vec<(cpal::HostId, &'static str)> {
    cpal::available_hosts()
        .into_iter()
        .map(|id| {
            let label = match id {
                #[cfg(windows)]
                cpal::HostId::Wasapi => "WASAPI",
                #[cfg(windows)]
                cpal::HostId::Asio => "ASIO",
                #[cfg(not(windows))]
                _ => id.name(),
            };
            (id, label)
        })
        .collect()
}

/// Discovers all available input microphones across all audio host APIs.
/// Devices retain their host-qualified IDs so identically named WASAPI, ASIO,
/// and virtual inputs remain independently selectable.
#[tauri::command]
pub(crate) fn list_microphones(
    combine_channels: Option<bool>,
) -> Result<Vec<MicrophoneInfo>, String> {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut out = Vec::new();
    let mut errors = Vec::new();

    for (host_id, host_name) in audio_hosts() {
        let Ok(host) = cpal::host_from_id(host_id) else {
            continue;
        };
        let devices = match host.input_devices() {
            Ok(devices) => devices,
            Err(error) => {
                errors.push(format!("{host_name}: {error}"));
                continue;
            }
        };

        for device in devices {
            let Ok(config) = device.default_input_config() else {
                continue;
            };

            let name = device_display_name(&device);
            let raw_id = device
                .id()
                .map(|id| id.to_string())
                .unwrap_or_else(|_| name.clone());
            let host = host_name.to_string();
            if seen.insert((host.clone(), name.clone())) {
                let id = format!("{host_name}:{raw_id}");
                let channel_count = config.channels();
                if combine_channels.unwrap_or(true) || config.channels() <= 1 {
                    out.push(MicrophoneInfo {
                        id,
                        name,
                        host,
                        channel_count,
                    });
                } else {
                    for channel in 1..=config.channels() {
                        out.push(MicrophoneInfo {
                            id: format!("{id}#channel={channel}"),
                            name: format!("{name} (Channel {channel})"),
                            host: host.clone(),
                            channel_count,
                        });
                    }
                }
            }
        }
    }

    if out.is_empty() && !errors.is_empty() {
        Err(format!("input devices: {}", errors.join("; ")))
    } else {
        Ok(out)
    }
}

fn i16_to_f32(sample: i16) -> f32 {
    sample as f32 / i16::MAX as f32
}

fn i32_to_f32(sample: i32) -> f32 {
    sample as f32 / i32::MAX as f32
}

fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

fn f32_to_u16(sample: f32) -> u16 {
    ((sample.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16
}

fn f32_to_i32(sample: f32) -> i32 {
    (sample.clamp(-1.0, 1.0) * i32::MAX as f32) as i32
}

fn f32_to_u32(sample: f32) -> u32 {
    ((sample.clamp(-1.0, 1.0) * 0.5 + 0.5) * u32::MAX as f32) as u32
}

fn push_mapped_input<T, F>(data: &[T], push: &SampleSink, mut map: F)
where
    T: Copy,
    F: FnMut(T) -> f32,
{
    let floats: Vec<f32> = data.iter().copied().map(&mut map).collect();
    push(&floats);
}

fn strongest_input_channel(data: &[f32], channels: usize) -> usize {
    let mut energy = vec![0.0; channels];
    for frame in data.chunks(channels) {
        for (channel, sample) in frame.iter().enumerate() {
            energy[channel] += sample * sample;
        }
    }

    energy
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.total_cmp(right))
        .map_or(0, |(channel, _)| channel)
}

fn write_output_frames<T, F>(
    data: &mut [T],
    channels: usize,
    next_sample: &SampleSource,
    mut map: F,
) where
    T: Copy,
    F: FnMut(f32) -> T,
{
    let Ok(mut next_sample) = next_sample.try_lock() else {
        for sample in data {
            *sample = map(0.0);
        }
        return;
    };

    for frame in data.chunks_mut(channels) {
        let out_sample = map(next_sample());
        for out in frame {
            *out = out_sample;
        }
    }
}

struct MicCaptureTarget {
    selected_channel: Option<usize>,
    emit_audio: bool,
    channel: Channel<MicSampleFrame>,
    pcm: VecDeque<f32>,
}

type MicCaptureTargets = Arc<Mutex<HashMap<String, MicCaptureTarget>>>;

struct MicCapture {
    shutdown: Arc<AtomicBool>,
    monitor_enabled: Arc<AtomicBool>,
    targets: MicCaptureTargets,
    audio: Arc<Mutex<VecDeque<f32>>>,
    thread: JoinHandle<()>,
}

static MIC_CAPTURES: once_cell::sync::Lazy<Mutex<HashMap<String, MicCapture>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));
/// Serializes start/stop so concurrent IPC dispatches can't interleave a
/// teardown with a fresh spawn.
static MIC_OP_LOCK: once_cell::sync::Lazy<Mutex<()>> =
    once_cell::sync::Lazy::new(|| Mutex::new(()));

fn stop_internal(capture_id: &str) {
    let capture = {
        let mut captures = MIC_CAPTURES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let device_id = captures.iter().find_map(|(device_id, capture)| {
            capture
                .targets
                .lock()
                .ok()
                .is_some_and(|targets| targets.contains_key(capture_id))
                .then(|| device_id.clone())
        });
        let Some(device_id) = device_id else {
            return;
        };

        let remove_device = if let Some(capture) = captures.get(&device_id) {
            let mut targets = capture
                .targets
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            targets.remove(capture_id);
            let monitor_enabled = targets.values().any(|target| target.emit_audio);
            capture
                .monitor_enabled
                .store(monitor_enabled, Ordering::SeqCst);
            if !monitor_enabled {
                capture
                    .audio
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .clear();
            }
            targets.is_empty()
        } else {
            false
        };

        remove_device.then(|| captures.remove(&device_id)).flatten()
    };
    let Some(capture) = capture else {
        return;
    };

    capture.shutdown.store(true, Ordering::SeqCst);
    capture.monitor_enabled.store(false, Ordering::SeqCst);
    let _ = capture.thread.join();
}

fn selected_input_channel(preference: &str) -> (&str, Option<usize>) {
    let Some((device_id, channel)) = preference.rsplit_once("#channel=") else {
        return (preference, None);
    };
    let Some(channel) = channel
        .parse::<usize>()
        .ok()
        .and_then(|channel| channel.checked_sub(1))
    else {
        return (preference, None);
    };
    (device_id, Some(channel))
}

struct ResolvedInputDevice {
    device: cpal::Device,
    id: String,
    name: String,
    selected_channel: Option<usize>,
}

fn find_device(preferred: Option<&str>) -> Result<ResolvedInputDevice, String> {
    if let Some(preference) = preferred {
        let (device_preference, selected_channel) = selected_input_channel(preference);
        let hosts = audio_hosts();
        let qualified_preference =
            device_preference
                .split_once(':')
                .filter(|(preferred_host, _)| {
                    hosts
                        .iter()
                        .any(|(_, host_name)| host_name == preferred_host)
                });

        for (host_id, host_name) in hosts {
            if qualified_preference.is_some_and(|(preferred_host, _)| preferred_host != host_name) {
                continue;
            }

            let Ok(host) = cpal::host_from_id(host_id) else {
                continue;
            };
            let Ok(devices) = host.input_devices() else {
                continue;
            };
            for dev in devices {
                let display_name = device_display_name(&dev);
                let raw_id = dev
                    .id()
                    .map(|id| id.to_string())
                    .unwrap_or_else(|_| display_name.clone());
                let id_matches = qualified_preference.map_or_else(
                    || raw_id == device_preference,
                    |(_, preferred_id)| raw_id == preferred_id,
                );
                // Name matching preserves preferences saved by older versions.
                if id_matches
                    || (qualified_preference.is_none() && display_name == device_preference)
                {
                    return Ok(ResolvedInputDevice {
                        device: dev,
                        id: format!("{host_name}:{raw_id}"),
                        name: display_name,
                        selected_channel,
                    });
                }
            }
        }
        return Err(format!("Microphone '{preference}' not found"));
    }

    // No preference: use the system default input device
    let host = cpal::default_host();
    let host_name = host.id().name();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No default microphone found".to_string())?;
    let name = device_display_name(&device);
    let raw_id = device
        .id()
        .map(|id| id.to_string())
        .unwrap_or_else(|_| name.clone());
    Ok(ResolvedInputDevice {
        device,
        id: format!("{host_name}:{raw_id}"),
        name,
        selected_channel: None,
    })
}

#[tauri::command]
pub(crate) fn start_mic_capture(
    capture_id: String,
    preferred: Option<String>,
    options: Option<MicCaptureOptions>,
    on_samples: Channel<MicSampleFrame>,
) -> Result<String, String> {
    let _guard = MIC_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    if capture_id.is_empty() {
        return Err("capture ID cannot be empty".to_string());
    }
    stop_internal(&capture_id);

    let next_options = options.unwrap_or_default();
    let resolved = find_device(preferred.as_deref())?;
    let input_config = resolved
        .device
        .default_input_config()
        .map_err(|error| format!("'{}' config error: {error}", resolved.name))?;
    let channels = input_config.channels() as usize;
    if resolved
        .selected_channel
        .is_some_and(|channel| channel >= channels)
    {
        return Err(format!(
            "requested input channel is unavailable for '{}'",
            resolved.name
        ));
    }

    let target = MicCaptureTarget {
        selected_channel: resolved.selected_channel,
        emit_audio: next_options.emit_audio,
        channel: on_samples,
        pcm: VecDeque::with_capacity(PCM_QUEUE_CAP),
    };
    let mut captures = MIC_CAPTURES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(capture) = captures.get(&resolved.id) {
        capture
            .targets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(capture_id, target);
        if next_options.emit_audio {
            capture.monitor_enabled.store(true, Ordering::SeqCst);
        }
        return Ok(resolved.name);
    }

    let shutdown = Arc::new(AtomicBool::new(false));
    let monitor_enabled = Arc::new(AtomicBool::new(next_options.emit_audio));
    let targets = Arc::new(Mutex::new(HashMap::from([(capture_id, target)])));
    let audio = Arc::new(Mutex::new(VecDeque::with_capacity(AUDIO_QUEUE_CAP)));

    let device_name = resolved.name.clone();
    let worker_shutdown = Arc::clone(&shutdown);
    let worker_monitor_enabled = Arc::clone(&monitor_enabled);
    let worker_targets = Arc::clone(&targets);
    let worker_audio = Arc::clone(&audio);
    let (startup_tx, startup_rx) = std::sync::mpsc::channel();
    let handle = std::thread::spawn(move || {
        run_mic_loop(
            resolved.device,
            &resolved.name,
            worker_shutdown,
            worker_monitor_enabled,
            worker_targets,
            worker_audio,
            startup_tx,
        );
    });
    match startup_rx.recv() {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            let _ = handle.join();
            return Err(error);
        }
        Err(error) => {
            let _ = handle.join();
            return Err(format!("microphone worker failed during startup: {error}"));
        }
    }

    captures.insert(
        resolved.id,
        MicCapture {
            shutdown,
            monitor_enabled,
            targets,
            audio,
            thread: handle,
        },
    );

    Ok(device_name)
}

fn try_build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    targets: MicCaptureTargets,
    audio_shared: Arc<Mutex<VecDeque<f32>>>,
    monitor_enabled: Arc<AtomicBool>,
) -> Option<cpal::Stream> {
    let ch = config.channels as usize;
    let push_samples: SampleSink = {
        let targets_cb = Arc::clone(&targets);
        let audio_cb = Arc::clone(&audio_shared);
        Arc::new(move |data: &[f32]| {
            let active_channel = strongest_input_channel(data, ch);
            let mut monitored_channels = Vec::new();
            let Ok(mut targets) = targets_cb.try_lock() else {
                return;
            };
            for target in targets.values_mut() {
                let selected_channel = target.selected_channel.unwrap_or(active_channel);
                for frame in data.chunks(ch) {
                    target
                        .pcm
                        .push_back(frame.get(selected_channel).copied().unwrap_or(0.0));
                }
                while target.pcm.len() > PCM_QUEUE_CAP {
                    target.pcm.pop_front();
                }
                if target.emit_audio {
                    monitored_channels.push(selected_channel);
                }
            }
            drop(targets);

            if monitor_enabled.load(Ordering::Relaxed) && !monitored_channels.is_empty() {
                monitored_channels.sort_unstable();
                monitored_channels.dedup();
                if let Ok(mut q) = audio_cb.try_lock() {
                    for frame in data.chunks(ch) {
                        let sum = monitored_channels
                            .iter()
                            .map(|channel| frame.get(*channel).copied().unwrap_or(0.0))
                            .sum::<f32>();
                        q.push_back(sum / monitored_channels.len() as f32);
                    }
                    while q.len() > AUDIO_QUEUE_CAP {
                        q.pop_front();
                    }
                }
            }
        })
    };

    use cpal::SampleFormat;
    let stream = match sample_format {
        SampleFormat::F32 => {
            let push = push_samples.clone();
            device.build_input_stream(
                *config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| push(data),
                |err| warn!("[mic] stream error: {err}"),
                None,
            )
        }
        SampleFormat::I16 => {
            let push = push_samples.clone();
            device.build_input_stream(
                *config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    push_mapped_input(data, &push, i16_to_f32);
                },
                |err| warn!("[mic] stream error: {err}"),
                None,
            )
        }
        SampleFormat::I32 => {
            let push = push_samples.clone();
            device.build_input_stream(
                *config,
                move |data: &[i32], _: &cpal::InputCallbackInfo| {
                    push_mapped_input(data, &push, i32_to_f32);
                },
                |err| warn!("[mic] stream error: {err}"),
                None,
            )
        }
        _ => return None,
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            warn!("[mic] build stream failed: {e}");
            return None;
        }
    };

    if let Err(e) = stream.play() {
        warn!("[mic] play failed: {e}");
        return None;
    }

    Some(stream)
}

fn try_build_output_stream(
    device: &cpal::Device,
    input_sample_rate: cpal::SampleRate,
    audio_shared: Arc<Mutex<VecDeque<f32>>>,
    monitor_enabled: Arc<AtomicBool>,
) -> Option<cpal::Stream> {
    let default_cfg = match device.default_output_config() {
        Ok(c) => c,
        Err(e) => {
            warn!("[mic] output config error: {e}");
            return None;
        }
    };
    let sample_format = default_cfg.sample_format();
    let config = cpal::StreamConfig {
        channels: default_cfg.channels(),
        sample_rate: default_cfg.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };
    let ch = config.channels as usize;
    let sample_rate_ratio = f64::from(input_sample_rate) / f64::from(config.sample_rate);

    let next_sample: SampleSource = {
        let audio_shared = Arc::clone(&audio_shared);
        let mut current = 0.0;
        let mut next = 0.0;
        let mut position = 0.0;
        let mut initialized = false;
        let mut buffered = VecDeque::new();
        Arc::new(Mutex::new(Box::new(move || -> f32 {
            if !monitor_enabled.load(Ordering::Relaxed) {
                return 0.0;
            }

            if !initialized {
                let Ok(mut queue) = audio_shared.try_lock() else {
                    return 0.0;
                };
                if queue.len() < MONITOR_START_BUFFER {
                    return 0.0;
                }
                buffered.extend(queue.drain(..));
                current = buffered.pop_front().unwrap_or(0.0);
                next = buffered.pop_front().unwrap_or(0.0);
                initialized = true;
            }

            let sample = current + (next - current) * position as f32;
            position += sample_rate_ratio;
            while position >= 1.0 {
                current = next;
                if buffered.is_empty() {
                    if let Ok(mut queue) = audio_shared.try_lock() {
                        buffered.extend(queue.drain(..));
                    }
                }
                next = buffered.pop_front().unwrap_or(0.0);
                position -= 1.0;
            }

            sample * monitor_gain()
        })))
    };

    use cpal::SampleFormat;
    let stream = match sample_format {
        SampleFormat::F32 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, |sample| sample);
                },
                |err| warn!("[mic] output stream error: {err}"),
                None,
            )
        }
        SampleFormat::I16 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, f32_to_i16);
                },
                |err| warn!("[mic] output stream error: {err}"),
                None,
            )
        }
        SampleFormat::U16 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                config,
                move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, f32_to_u16);
                },
                |err| warn!("[mic] output stream error: {err}"),
                None,
            )
        }
        SampleFormat::I32 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                config,
                move |data: &mut [i32], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, f32_to_i32);
                },
                |err| warn!("[mic] output stream error: {err}"),
                None,
            )
        }
        SampleFormat::U32 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                config,
                move |data: &mut [u32], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, f32_to_u32);
                },
                |err| warn!("[mic] output stream error: {err}"),
                None,
            )
        }
        _ => {
            warn!("[mic] unsupported output sample format: {sample_format:?}");
            return None;
        }
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            warn!("[mic] build output stream failed: {e}");
            return None;
        }
    };
    if let Err(e) = stream.play() {
        warn!("[mic] output play failed: {e}");
        return None;
    }
    Some(stream)
}

fn drain_target_chunks(targets: &MicCaptureTargets) -> Vec<(Channel<MicSampleFrame>, Vec<f32>)> {
    let Ok(mut targets) = targets.try_lock() else {
        return Vec::new();
    };
    let mut chunks = Vec::new();
    for target in targets.values_mut() {
        while target.pcm.len() >= SAMPLE_CHUNK {
            chunks.push((
                target.channel.clone(),
                target.pcm.drain(..SAMPLE_CHUNK).collect(),
            ));
        }
    }
    chunks
}

fn run_mic_loop(
    device: cpal::Device,
    name: &str,
    shutdown: Arc<AtomicBool>,
    monitor_enabled: Arc<AtomicBool>,
    targets: MicCaptureTargets,
    audio_shared: Arc<Mutex<VecDeque<f32>>>,
    startup: std::sync::mpsc::Sender<Result<(), String>>,
) {
    let default_cfg = match device.default_input_config() {
        Ok(c) => c,
        Err(error) => {
            let message = format!("'{name}' config error: {error}");
            warn!("[mic] {message}");
            let _ = startup.send(Err(message));
            return;
        }
    };

    let sample_format = default_cfg.sample_format();
    let config = cpal::StreamConfig {
        channels: default_cfg.channels(),
        sample_rate: default_cfg.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };
    let sr = config.sample_rate;

    info!(
        "[mic] opening '{name}': {sr} Hz, {}ch, {sample_format:?}",
        config.channels
    );

    let Some(_stream) = try_build_stream(
        &device,
        &config,
        sample_format,
        Arc::clone(&targets),
        Arc::clone(&audio_shared),
        Arc::clone(&monitor_enabled),
    ) else {
        let message = format!("failed to open microphone '{name}'");
        warn!("[mic] {message}");
        let _ = startup.send(Err(message));
        return;
    };

    info!("[mic] active: {name}");
    if startup.send(Ok(())).is_err() {
        return;
    }

    let sleep_dur = std::time::Duration::from_millis(4);
    let mut monitor_stream = None;
    let mut monitor_attempted = false;

    loop {
        std::thread::sleep(sleep_dur);

        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        let monitoring = monitor_enabled.load(Ordering::Relaxed);
        if monitoring && !monitor_attempted {
            monitor_attempted = true;
            monitor_stream =
                cpal::default_host()
                    .default_output_device()
                    .and_then(|output_device| {
                        try_build_output_stream(
                            &output_device,
                            sr,
                            Arc::clone(&audio_shared),
                            Arc::clone(&monitor_enabled),
                        )
                    });
            if monitor_stream.is_none() {
                warn!("[mic] no output monitoring stream available");
            }
        } else if !monitoring && monitor_attempted {
            monitor_attempted = false;
            monitor_stream.take();
            audio_shared
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clear();
        }

        for (channel, samples) in drain_target_chunks(&targets) {
            let frame = MicSampleFrame {
                sample_rate: sr,
                samples,
            };
            if let Err(e) = channel.send(frame) {
                warn!("[mic] channel send failed: {e}");
            }
        }
    }
}

#[tauri::command]
pub(crate) fn set_mic_monitoring(capture_id: String, enabled: bool) {
    let _guard = MIC_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let captures = MIC_CAPTURES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    for capture in captures.values() {
        let mut targets = capture
            .targets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(target) = targets.get_mut(&capture_id) else {
            continue;
        };
        target.emit_audio = enabled;
        let monitor_enabled = targets.values().any(|target| target.emit_audio);
        capture
            .monitor_enabled
            .store(monitor_enabled, Ordering::SeqCst);
        drop(targets);

        if !monitor_enabled {
            capture
                .audio
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clear();
        }
        return;
    }
}

#[tauri::command]
pub(crate) fn stop_mic_capture(capture_id: String) {
    let _guard = MIC_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    stop_internal(&capture_id);
}
