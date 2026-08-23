import type { MicCaptureOptions } from "@/types/MicCaptureOptions";
import type { MicrophoneInfo } from "@/types/MicrophoneInfo";
import type { MicSampleFrame } from "@/types/MicSampleFrame";
import { dispatchMicFrame, type MicrophoneAdapter, subscribeMicSamples } from "./microphone";

/**
 * Matches `SAMPLE_CHUNK` in `client/src-tauri/src/microphones.rs` (=512) so JS
 * consumers (`SampleRing`, `useMicPitch`) see the same chunk cadence in either
 * transport. Smaller chunks lower latency but increase main-thread wakeups.
 */
const SAMPLE_CHUNK = 512;
const DEFAULT_MONITOR_GAIN = 0.65;
const MAX_MONITOR_GAIN = 2.0;

const WORKLET_SRC = `
class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSize = (options && options.processorOptions && options.processorOptions.chunkSize) || 512;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channels = input.length;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let sample = 0;
      for (let c = 0; c < channels; c++) sample += input[c][i];
      sample /= channels;
      this.buffer[this.offset++] = sample;
      if (this.offset >= this.chunkSize) {
        this.port.postMessage(this.buffer.slice(0));
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("nightingale-mic-processor", MicProcessor);
`;

interface ActiveCapture {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  stream: MediaStream;
  monitorGain: GainNode | null;
  emitAudio: boolean;
}

let active: ActiveCapture | null = null;
let workletUrl: string | null = null;
let liveMonitorGain = DEFAULT_MONITOR_GAIN;

const ensureWorkletUrl = (): string => {
  if (workletUrl !== null) return workletUrl;
  const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
  workletUrl = URL.createObjectURL(blob);
  return workletUrl;
};

const initialMonitorGain = (): number => {
  if (typeof window === "undefined") return DEFAULT_MONITOR_GAIN;
  const cfg = window.__NIGHTINGALE_APP_CONFIG__;
  const raw = cfg?.mic_monitor_gain;
  if (raw == null) return DEFAULT_MONITOR_GAIN;
  return Math.min(Math.max(raw, 0), MAX_MONITOR_GAIN);
};

/**
 * Updates the live monitor gain on an in-flight capture. Web mode applies the
 * config value locally because there is no server-side `cpal` monitor stream
 * to receive it through `save_config`.
 */
export const setWebMicMonitorGain = (value: number): void => {
  const clamped = Math.min(Math.max(value, 0), MAX_MONITOR_GAIN);
  liveMonitorGain = clamped;
  if (active?.monitorGain) {
    active.monitorGain.gain.value = clamped;
  }
};

const teardown = (): void => {
  if (!active) return;
  const { context, stream, source, node, monitorGain } = active;
  try {
    source.disconnect();
  } catch {
    // already detached
  }
  try {
    if (monitorGain) monitorGain.disconnect();
  } catch {
    // already detached
  }
  try {
    node.port.onmessage = null;
    node.disconnect();
  } catch {
    // already detached
  }
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // tracks may already be ended
    }
  }
  void context.close().catch(() => {});
  active = null;
};

const listDevices = async (): Promise<MicrophoneInfo[]> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  /**
   * Without prior `getUserMedia` permission, browsers return devices with
   * empty `label` strings; the deviceId is still stable enough for the
   * preferred-mic selection logic, so we synthesise a label fallback.
   */
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d, idx) => {
      const name = d.label?.trim() || d.deviceId || `Microphone ${idx + 1}`;
      return {
        id: d.deviceId || name,
        name,
        host: "Browser",
      };
    });
};

const findDeviceId = async (preferred: string | null): Promise<string | undefined> => {
  if (!preferred || typeof navigator === "undefined") return undefined;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const match = devices.find(
      (d) => d.kind === "audioinput" && (d.label === preferred || d.deviceId === preferred),
    );
    return match?.deviceId;
  } catch {
    return undefined;
  }
};

const startCapture = async (
  preferred: string | null,
  options: MicCaptureOptions,
): Promise<string> => {
  teardown();

  const deviceId = await findDeviceId(preferred);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const context = new AudioContext();
  await context.audioWorklet.addModule(ensureWorkletUrl());

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "nightingale-mic-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { chunkSize: SAMPLE_CHUNK },
  });

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const samples = event.data;
    const frame: MicSampleFrame = {
      sample_rate: context.sampleRate,
      // `MicSampleFrame.samples` is generated as `Array<number>` (ts-rs);
      // copy into a real Array so consumers reading `.length` / `[i]` don't
      // depend on Float32Array's surface.
      samples: Array.from(samples) as unknown as number[],
    };
    dispatchMicFrame(frame);
  };

  source.connect(node);

  liveMonitorGain = initialMonitorGain();
  let monitorGain: GainNode | null = null;
  if (options.emit_audio) {
    monitorGain = context.createGain();
    monitorGain.gain.value = liveMonitorGain;
    source.connect(monitorGain).connect(context.destination);
  }

  active = {
    context,
    source,
    node,
    stream,
    monitorGain,
    emitAudio: options.emit_audio,
  };

  const track = stream.getAudioTracks()[0];
  return track?.label || preferred || "default";
};

const stopCapture = async (): Promise<void> => {
  teardown();
};

export const webMicrophoneAdapter: MicrophoneAdapter = {
  listDevices,
  startCapture,
  stopCapture,
  onSamples: async (cb) => subscribeMicSamples(cb),
};
