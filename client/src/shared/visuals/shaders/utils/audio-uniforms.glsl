uniform float uTime;
uniform float uTimeFast;
uniform float uTimeSlow;
uniform float uAudioReactive;
uniform float uVolume;
uniform float uLow;
uniform float uMid;
uniform float uHigh;
uniform float uCentroid;
uniform float uPitch;
uniform float uEnergy;
uniform float uHue;
uniform float uFlow;
varying vec2 vUv;

const float WIDESCREEN_RATIO = 16.0 / 9.0;
const float TAU_2PI = 6.28318;
const float HUE_PALETTE_OFFSET_G = 2.094;
const float HUE_PALETTE_OFFSET_B = 4.188;

float audioGate(float v) { return v * uAudioReactive; }
float audioMul(float v) { return mix(1.0, v, uAudioReactive); }

mat2 audioRot(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

vec3 huePalette(float h) {
  return vec3(
    0.5 + 0.5 * cos(TAU_2PI * h),
    0.5 + 0.5 * cos(TAU_2PI * h + HUE_PALETTE_OFFSET_G),
    0.5 + 0.5 * cos(TAU_2PI * h + HUE_PALETTE_OFFSET_B)
  );
}
