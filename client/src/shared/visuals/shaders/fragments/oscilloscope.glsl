uniform sampler2D uWave;

const int FBM_OCTAVES = 4;
const float FBM_LACUNARITY = 2.0;
const float FBM_GAIN = 0.5;
const float FBM_AMP_INIT = 0.5;

const float WAVE_GAIN_BASE = 2.6;
const float WAVE_GAIN_AUDIO = 1.5;
const float WAVE_SAMPLE_TAPS = 5.0;
const float SAMPLE_TAP_INNER = 0.006;
const float SAMPLE_TAP_OUTER = 0.012;
const float GHOST_TAP = 0.010;

const float LINE_AMPLITUDE = 0.48;
const float LINE_CORE_THICKNESS = 0.004;
const float LINE_GLOW_THICKNESS = 0.07;
const float LINE_GLOW_POW = 1.6;

const float CENTER_LINE_THICKNESS = 0.0015;
const float CENTER_LINE_INTENSITY = 0.08;
const float CENTER_HUE_SCALE = 0.5;

const float BG_FBM_SCALE_A = 3.0;
const float BG_FBM_SCALE_B = 1.6;
const float BG_FBM_FLOW_GAIN = 0.5;
const float BG_FBM_TIME_SPEED = 0.2;
const float BG_FBM_FLOW_SPEED_A = 1.2;
const float BG_FBM_FLOW_SPEED_B = 0.7;
const float BG_FBM_FEEDBACK = 0.4;

const float BG_HUE_OFFSET_B = 0.45;
const float BG_HUE_INTENSITY = 0.08;
const float BG_RADIUS_BASE = 0.45;
const float BG_RADIUS_GAIN = 0.55;
const float BG_RADIUS_RANGE = 0.85;
const float BG_PLASMA_BASE = 0.5;
const float BG_PLASMA_AUDIO_GAIN = 0.5;
const vec3 BG_DEEP = vec3(0.005, 0.008, 0.020);

const vec3 LINE_HUE_COOL = vec3(0.30, 0.55, 0.80);
const vec3 LINE_HUE_TINT = vec3(0.20, 0.30, 0.40);
const float LINE_HUE_OFFSET = 0.05;
const float LINE_HUE_PALETTE_GAIN = 0.7;
const float LINE_HUE_BLEND = 0.7;

const vec3 LINE_CORE_COLOR = vec3(0.92, 0.96, 1.0);
const vec3 GHOST_R = vec3(0.55, 0.30, 0.45);
const vec3 GHOST_G = vec3(0.30, 0.60, 0.55);
const vec3 GHOST_B = vec3(0.30, 0.40, 0.70);

const float GHOST_R_INTENSITY = 0.18;
const float GHOST_G_INTENSITY = 0.22;
const float GHOST_B_INTENSITY = 0.18;
const float HUE_LINE_INTENSITY = 0.18;
const float CORE_INTENSITY = 0.50;

const float ENERGY_BASE = 0.9;
const float ENERGY_GAIN = 0.4;

const float SCAN_FREQ = 600.0;
const float SCAN_INTENSITY = 0.05;

const float SIDE_VIGNETTE_RADIUS = 0.06;
const float VIGNETTE_BASE = 0.85;
const float VIGNETTE_GAIN = 0.15;
const float OUTPUT_CLAMP_MAX = 0.7;

float oscFbm(vec2 p) {
  float v = 0.0;
  float a = FBM_AMP_INIT;
  for (int i = 0; i < FBM_OCTAVES; i++) {
    v += a * noise(p);
    p *= FBM_LACUNARITY;
    a *= FBM_GAIN;
  }
  return v;
}

float sampleAmp(float x, float gain) {
  return clamp((texture2D(uWave, vec2(x, 0.5)).r * 2.0 - 1.0) * gain, -1.0, 1.0);
}

void main() {
  vec2 uv = vUv;

  float gain = WAVE_GAIN_BASE + audioGate(uVolume * WAVE_GAIN_AUDIO);

  float smoothAmp = 0.0;
  smoothAmp += sampleAmp(uv.x - SAMPLE_TAP_OUTER, gain);
  smoothAmp += sampleAmp(uv.x - SAMPLE_TAP_INNER, gain);
  smoothAmp += sampleAmp(uv.x,                    gain);
  smoothAmp += sampleAmp(uv.x + SAMPLE_TAP_INNER, gain);
  smoothAmp += sampleAmp(uv.x + SAMPLE_TAP_OUTER, gain);
  smoothAmp /= WAVE_SAMPLE_TAPS;

  float ampR = sampleAmp(uv.x - GHOST_TAP, gain);
  float ampG = smoothAmp;
  float ampB = sampleAmp(uv.x + GHOST_TAP, gain);

  float lineYR = 0.5 + ampR * LINE_AMPLITUDE;
  float lineYG = 0.5 + ampG * LINE_AMPLITUDE;
  float lineYB = 0.5 + ampB * LINE_AMPLITUDE;

  float distR = abs(uv.y - lineYR);
  float distG = abs(uv.y - lineYG);
  float distB = abs(uv.y - lineYB);

  float coreR = smoothstep(LINE_CORE_THICKNESS, 0.0, distR);
  float coreG = smoothstep(LINE_CORE_THICKNESS, 0.0, distG);
  float coreB = smoothstep(LINE_CORE_THICKNESS, 0.0, distB);

  float glowR = pow(smoothstep(LINE_GLOW_THICKNESS, 0.0, distR), LINE_GLOW_POW);
  float glowG = pow(smoothstep(LINE_GLOW_THICKNESS, 0.0, distG), LINE_GLOW_POW);
  float glowB = pow(smoothstep(LINE_GLOW_THICKNESS, 0.0, distB), LINE_GLOW_POW);

  float ts = uTimeSlow * BG_FBM_TIME_SPEED;
  vec2 flow = vec2(cos(uFlow * BG_FBM_FLOW_GAIN), sin(uFlow * BG_FBM_FLOW_GAIN));
  float n = oscFbm(uv * BG_FBM_SCALE_A + flow * ts * BG_FBM_FLOW_SPEED_A);
  float n2 = oscFbm(uv * BG_FBM_SCALE_B - flow * ts * BG_FBM_FLOW_SPEED_B + n * BG_FBM_FEEDBACK);

  vec3 bgA = huePalette(uHue) * BG_HUE_INTENSITY;
  vec3 bgB = huePalette(uHue + BG_HUE_OFFSET_B) * BG_HUE_INTENSITY;
  vec3 bgPlasma = mix(bgA, bgB, n2);
  bgPlasma *= BG_RADIUS_BASE + BG_RADIUS_GAIN * smoothstep(0.0, BG_RADIUS_RANGE, length((uv - 0.5)));
  bgPlasma *= BG_PLASMA_BASE + BG_PLASMA_AUDIO_GAIN * audioGate(1.0);

  vec3 bg = BG_DEEP + bgPlasma;

  float centerLine = smoothstep(CENTER_LINE_THICKNESS, 0.0, abs(uv.y - 0.5));
  vec3 centerCol = huePalette(uHue) * CENTER_HUE_SCALE;

  vec3 hueLine = mix(
    LINE_HUE_COOL,
    huePalette(uHue + LINE_HUE_OFFSET) * LINE_HUE_PALETTE_GAIN + LINE_HUE_TINT,
    audioGate(LINE_HUE_BLEND)
  );

  float intensity = audioMul(ENERGY_BASE + uEnergy * ENERGY_GAIN);

  vec3 color = bg;
  color += centerCol * CENTER_LINE_INTENSITY * centerLine;
  color += GHOST_R * glowR * GHOST_R_INTENSITY * intensity;
  color += GHOST_G * glowG * GHOST_G_INTENSITY * intensity;
  color += GHOST_B * glowB * GHOST_B_INTENSITY * intensity;
  color += hueLine * (glowR + glowG + glowB) * HUE_LINE_INTENSITY * intensity;
  color += LINE_CORE_COLOR * (coreR + coreG + coreB) * CORE_INTENSITY * intensity;

  float scan = sin(uv.y * SCAN_FREQ) * 0.5 + 0.5;
  color *= 1.0 - scan * SCAN_INTENSITY;

  float sideVig =
    smoothstep(0.0, SIDE_VIGNETTE_RADIUS, uv.x) *
    smoothstep(0.0, SIDE_VIGNETTE_RADIUS, 1.0 - uv.x);
  color *= VIGNETTE_BASE + sideVig * VIGNETTE_GAIN;

  color = clamp(color, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
