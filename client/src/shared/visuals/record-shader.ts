import * as THREE from 'three';

import { t } from '@/i18n';

import { vertexShader } from './shaders';

export async function recordShader(
  fragmentShader: string,
  width: number,
  height: number,
  onProgress: (percent: number) => void,
): Promise<Blob> {
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (mimeType === undefined) {
    throw new Error(t('videoExport.recordingUnavailable'));
  }
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(Math.round(width / 2), Math.round(height / 2));
  renderer.setPixelRatio(1);
  const wave = new THREE.DataTexture(new Uint8Array(256).fill(127), 256, 1, THREE.RedFormat);
  wave.needsUpdate = true;
  const uniforms = {
    uTime: { value: 0 },
    uTimeFast: { value: 0 },
    uTimeSlow: { value: 0 },
    uAudioReactive: { value: 0 },
    uWave: { value: wave },
    uVolume: { value: 0 },
    uLow: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uCentroid: { value: 0.5 },
    uPitch: { value: 0.5 },
    uEnergy: { value: 0 },
    uHue: { value: 0 },
    uFlow: { value: 0 },
  };
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.Camera();
  const stream = renderer.domElement.captureStream(30);
  let frame = 0;
  let timer = 0;
  let recorder: MediaRecorder | undefined;
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
      recorder.addEventListener('dataavailable', (event) => {
        bytes += event.data.size;
        if (bytes > 32 * 1024 * 1024) {
          reject(new Error(t('videoExport.backgroundTooLarge')));
          return;
        }
        chunks.push(event.data);
      });
      recorder.addEventListener(
        'error',
        () => reject(new Error(t('videoExport.recordingUnavailable'))),
        { once: true },
      );
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), {
        once: true,
      });
      const started = performance.now();
      const render = () => {
        const seconds = (performance.now() - started) / 1000;
        uniforms.uTime.value = seconds;
        uniforms.uTimeFast.value = seconds * 1.4;
        uniforms.uTimeSlow.value = seconds * 0.35;
        try {
          renderer.render(scene, camera);
        } catch (error) {
          reject(error);
          return;
        }
        onProgress(Math.min(100, Math.floor((seconds / 8) * 100)));
        frame = requestAnimationFrame(render);
      };
      renderer.render(scene, camera);
      recorder.start(500);
      render();
      timer = window.setTimeout(() => {
        if (recorder?.state === 'recording') {
          recorder.stop();
        }
      }, 8000);
    });
  } finally {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    if (recorder?.state === 'recording') {
      recorder.stop();
    }
    stream.getTracks().forEach((track) => track.stop());
    geometry.dispose();
    material.dispose();
    wave.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
