import { microphoneAdapter, type MicrophoneAdapter, type StopListening } from '@/bridge/microphone';
import {
  MAX_MIC_LATENCY_COMPENSATION_SEC,
  MIN_MIC_LATENCY_COMPENSATION_SEC,
} from '@/features/playback/lib/pitch/constants';
import { t } from '@/i18n';

const BASELINE_MS = 300;
const TEST_TIMEOUT_MS = 2200;
const BEEP_DELAY_MS = 120;
const BEEP_FREQ_HZ = 1000;
const BEEP_DURATION_SEC = 0.16;
const BEEP_GAIN = 0.9;
const NOOP: StopListening = () => {};
const CAPTURE_ID = 'latency-test';

function toneAmplitude(samples: number[], sampleRate: number, frequency: number): number {
  if (samples.length === 0 || sampleRate <= 0) {
    return 0;
  }

  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let previous = 0;
  let beforePrevious = 0;
  for (const sample of samples) {
    const current = sample + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }

  const power =
    previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
  return (2 * Math.sqrt(Math.max(0, power))) / samples.length;
}

function clampLatency(sec: number): number {
  return Math.min(
    MAX_MIC_LATENCY_COMPENSATION_SEC,
    Math.max(MIN_MIC_LATENCY_COMPENSATION_SEC, sec),
  );
}

async function createUnlockedAudioContext(): Promise<AudioContext> {
  const AudioContextCtor = window.AudioContext;
  const context = new AudioContextCtor();
  await context.resume();

  // Unlock output during the button click gesture; the audible beep plays after baseline capture.
  // Use a real one-sample buffer: some WebAudio hosts ignore a BufferSource with no buffer.
  const unlock = context.createBufferSource();
  unlock.buffer = context.createBuffer(1, 1, context.sampleRate);
  unlock.connect(context.destination);
  unlock.start();

  return context;
}

async function playBeep(context: AudioContext): Promise<number> {
  if (context.state !== 'running') {
    await context.resume();
  }

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = BEEP_FREQ_HZ;
  gain.gain.setValueAtTime(0.0001, context.currentTime);

  const startAt = context.currentTime + BEEP_DELAY_MS / 1000;
  gain.gain.exponentialRampToValueAtTime(BEEP_GAIN, startAt + 0.01);
  gain.gain.setValueAtTime(BEEP_GAIN, startAt + BEEP_DURATION_SEC - 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + BEEP_DURATION_SEC);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + BEEP_DURATION_SEC);

  return performance.now() + (startAt - context.currentTime) * 1000;
}

export async function measureMicLatencySec(
  deviceId: string | null,
  adapter: MicrophoneAdapter = microphoneAdapter,
): Promise<number> {
  let stopListening = NOOP;
  let beepWallStart = 0;
  let baselineSum = 0;
  let baselinePeak = 0;
  let baselineCount = 0;
  const startedAt = performance.now();
  const context = await createUnlockedAudioContext();

  try {
    await adapter.startCapture(CAPTURE_ID, deviceId, { emit_audio: false });

    return await new Promise<number>((resolve, reject) => {
      let done = false;
      let threshold = 0.0005;

      const finish = (fn: () => void) => {
        if (done) {
          return;
        }
        done = true;
        stopListening();
        void adapter.stopCapture(CAPTURE_ID).catch(() => {});
        void context.close().catch(() => {});
        fn();
      };

      const timer = window.setTimeout(() => {
        finish(() => reject(new Error(t('settings.microphone.latencyToneNotDetected'))));
      }, TEST_TIMEOUT_MS);

      adapter
        .subscribe(CAPTURE_ID, (frame) => {
          const now = performance.now();
          const level = toneAmplitude(frame.samples, frame.sample_rate, BEEP_FREQ_HZ);

          if (!beepWallStart) {
            baselineSum += level;
            baselinePeak = Math.max(baselinePeak, level);
            baselineCount += 1;
            return;
          }

          if (now < beepWallStart) {
            return;
          }

          if (level >= threshold) {
            window.clearTimeout(timer);
            finish(() => resolve(clampLatency((now - beepWallStart) / 1000)));
          }
        })
        .then((stop) => {
          stopListening = stop;
          return undefined;
        })
        .catch((error: unknown) => {
          window.clearTimeout(timer);
          finish(() => reject(error));
        });

      window.setTimeout(
        () => {
          const baseline = baselineCount > 0 ? baselineSum / baselineCount : 0;
          threshold = Math.max(0.0005, baseline * 3, baselinePeak * 1.5);
          playBeep(context)
            .then((start) => {
              beepWallStart = start;
              return undefined;
            })
            .catch((error: unknown) => {
              window.clearTimeout(timer);
              finish(() => reject(error));
            });
        },
        Math.max(0, BASELINE_MS - (performance.now() - startedAt)),
      );
    });
  } catch (error) {
    stopListening();
    await adapter.stopCapture(CAPTURE_ID).catch(() => {});
    await context.close().catch(() => {});
    throw error;
  }
}
