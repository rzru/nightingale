const int WAVE_COUNT = 6;
const float TIME_SCALE = 0.4;

const float WAVE_BASE_FREQ = 2.0;
const float WAVE_FREQ_STEP = 0.5;
const float WAVE_PHASE_SPEED_BASE = 0.8;
const float WAVE_PHASE_SPEED_STEP = 0.15;
const float WAVE_SPATIAL_PHASE_STEP = 1.2;
const float WAVE_AMPLITUDE = 0.15;
const float WAVE_BAND_STEP = 0.2;
const float WAVE_BAND_CENTER = 2.5;
const float WAVE_INTENSITY_BASE = 0.012;
const float WAVE_COLOR_GAIN = 0.4;

const float ENERGY_INTENSITY_GAIN = 0.6;
const float HUE_SHIFT_GAIN = 2.6;
const float VOLUME_HUE_GAIN = 0.6;
const float WAVE_HUE_TIME_RATE = 0.05;
const float WAVE_HUE_PER_BAND_GAIN = 0.18;

const float HUE_OFFSET_R = 0.0;
const float HUE_OFFSET_G = 0.333;
const float HUE_OFFSET_B = 0.667;

const vec3 BG_COLOR = vec3(0.02, 0.02, 0.06);

void main() {
  float t = uTimeFast * TIME_SCALE;
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= WIDESCREEN_RATIO;

  vec3 color = vec3(0.0);

  float intensityScale = audioMul(1.0 + uEnergy * ENERGY_INTENSITY_GAIN);
  float hueShift = audioGate(uHue * HUE_SHIFT_GAIN);
  float perWaveColor = audioGate(uVolume * VOLUME_HUE_GAIN);

  for (int i = 0; i < WAVE_COUNT; i++) {
    float fi = float(i);
    float waveY = sin(uv.x * (WAVE_BASE_FREQ + fi * WAVE_FREQ_STEP) + t * (WAVE_PHASE_SPEED_BASE + fi * WAVE_PHASE_SPEED_STEP) + fi * WAVE_SPATIAL_PHASE_STEP) * WAVE_AMPLITUDE;
    float dist = abs(uv.y - waveY - (fi - WAVE_BAND_CENTER) * WAVE_BAND_STEP);
    float intensity = WAVE_INTENSITY_BASE / dist * intensityScale;

    float hue = fi / float(WAVE_COUNT) + t * WAVE_HUE_TIME_RATE + hueShift + fi * perWaveColor * WAVE_HUE_PER_BAND_GAIN;
    float r = 0.5 + 0.5 * cos(TAU_2PI * (hue + HUE_OFFSET_R));
    float g = 0.5 + 0.5 * cos(TAU_2PI * (hue + HUE_OFFSET_G));
    float b = 0.5 + 0.5 * cos(TAU_2PI * (hue + HUE_OFFSET_B));

    color += vec3(r, g, b) * intensity * WAVE_COLOR_GAIN;
  }

  color += BG_COLOR;

  color = clamp(color, vec3(0.0), vec3(1.0));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
