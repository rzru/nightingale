const int FBM_OCTAVES = 4;
const float FBM_LACUNARITY = 2.0;
const float FBM_GAIN = 0.5;
const float FBM_AMP_INIT = 0.5;

const float BAR_COUNT = 36.0;
const float BAR_ZONE_TOP = 0.92;
const float BAR_BASE_Y = 0.0;
const float BAR_GAP = 0.22;
const float BAR_EDGE_AA = 0.012;
const float BAR_BASELINE_AA = 0.005;
const float BAR_TOP_AA = 0.005;
const float BAR_TOP_LIVE_FLOOR = 0.015;

const float BAND_SPLIT = 0.5;
const float BASELINE_HEIGHT = 0.05;
const float ENERGY_HEIGHT_GAIN = 1.1;
const float VOLUME_KICK_GAIN = 0.20;
const float SHIMMER_TIME_SPEED = 0.8;
const float SHIMMER_GAIN = 0.10;
const float MAX_HEIGHT = 0.95;

const float TIP_GLOW_RADIUS = 0.025;

const float BG_FBM_SCALE_A = 2.5;
const float BG_FBM_SCALE_B = 1.4;
const float BG_FBM_FLOW_GAIN = 0.4;
const float BG_FBM_TIME_SPEED = 0.2;
const float BG_FBM_FLOW_SPEED_A = 1.0;
const float BG_FBM_FLOW_SPEED_B = 0.6;
const float BG_FBM_FEEDBACK = 0.4;

const float BG_HUE_OFFSET_A = 0.05;
const float BG_HUE_OFFSET_B = 0.50;
const float BG_HUE_INTENSITY = 0.10;
const float BG_PLASMA_BASE = 0.4;
const float BG_PLASMA_AUDIO_GAIN = 0.4;
const vec3 BG_DEEP = vec3(0.005, 0.008, 0.020);

const float HUE_BAR_SLIDE = 0.30;
const float HUE_TIP_SHIFT = 0.12;
const float BASE_HUE_INTENSITY = 0.40;
const float TIP_HUE_INTENSITY = 0.55;
const vec3 BAR_MUTED_LO = vec3(0.10, 0.06, 0.18);
const vec3 BAR_MUTED_HI = vec3(0.30, 0.18, 0.10);
const float BAR_HUE_BLEND_BASE = 0.5;
const float BAR_HUE_BLEND_AUDIO = 0.3;

const vec3 TIP_GLOW_BASE = vec3(0.40, 0.36, 0.55);
const float TIP_HUE_SLIDE = 0.18;
const float TIP_HUE_PALETTE_GAIN = 0.7;
const float TIP_HUE_BLEND = 0.6;

const float PITCH_PROXIMITY_FALLOFF = 0.6;
const vec3 PITCH_HUE_COLOR = vec3(0.32, 0.22, 0.50);
const float PITCH_HUE_INTENSITY = 0.45;

const float BAR_ENERGY_BASE = 0.9;
const float BAR_ENERGY_GAIN = 0.45;

const float SIDE_VIGNETTE_RADIUS = 0.08;
const float VIGNETTE_BASE = 0.85;
const float VIGNETTE_GAIN = 0.15;
const float OUTPUT_CLAMP_MAX = 0.7;

const float SHIMMER_HASH_MUL = 12.9898;
const float SHIMMER_HASH_SIN_MUL = 43758.5453;

float spectrumHash(float x) {
  return fract(sin(x * SHIMMER_HASH_MUL) * SHIMMER_HASH_SIN_MUL);
}

float spFbm(vec2 p) {
  float v = 0.0;
  float a = FBM_AMP_INIT;
  for (int i = 0; i < FBM_OCTAVES; i++) {
    v += a * noise(p);
    p *= FBM_LACUNARITY;
    a *= FBM_GAIN;
  }
  return v;
}

void main() {
  vec2 uv = vUv;

  float ts = uTimeSlow * BG_FBM_TIME_SPEED;
  vec2 flow = vec2(cos(uFlow * BG_FBM_FLOW_GAIN), sin(uFlow * BG_FBM_FLOW_GAIN));
  float n = spFbm(uv * BG_FBM_SCALE_A + flow * ts * BG_FBM_FLOW_SPEED_A);
  float n2 = spFbm(uv * BG_FBM_SCALE_B - flow * ts * BG_FBM_FLOW_SPEED_B + n * BG_FBM_FEEDBACK);

  vec3 bgA = huePalette(uHue + BG_HUE_OFFSET_A) * BG_HUE_INTENSITY;
  vec3 bgB = huePalette(uHue + BG_HUE_OFFSET_B) * BG_HUE_INTENSITY;
  vec3 bgPlasma = mix(bgA, bgB, n2);
  bgPlasma *= BG_PLASMA_BASE + BG_PLASMA_AUDIO_GAIN * audioGate(1.0);
  vec3 bg = BG_DEEP + bgPlasma;

  float barIdx = floor(uv.x * BAR_COUNT);
  float t = (barIdx + 0.5) / BAR_COUNT;
  float localX = fract(uv.x * BAR_COUNT);
  float halfGap = BAR_GAP * 0.5;
  float insideBar =
    smoothstep(halfGap - BAR_EDGE_AA, halfGap + BAR_EDGE_AA, localX) *
    (1.0 - smoothstep(1.0 - halfGap - BAR_EDGE_AA, 1.0 - halfGap + BAR_EDGE_AA, localX));

  float e;
  if (t < BAND_SPLIT) {
    e = mix(uLow, uMid, smoothstep(0.0, 1.0, t * 2.0));
  } else {
    e = mix(uMid, uHigh, smoothstep(0.0, 1.0, (t - BAND_SPLIT) * 2.0));
  }

  float h = spectrumHash(barIdx);
  float shimmer =
    audioGate(uVolume) *
    (sin(uTimeSlow * SHIMMER_TIME_SPEED + h * TAU_2PI) * 0.5 + 0.5) * SHIMMER_GAIN;
  float volumeKick = audioGate(uVolume) * VOLUME_KICK_GAIN;

  float height = BASELINE_HEIGHT + e * ENERGY_HEIGHT_GAIN + volumeKick + shimmer;
  height = clamp(height, 0.0, MAX_HEIGHT);

  float zoneSpan = BAR_ZONE_TOP - BAR_BASE_Y;
  float barTop = BAR_BASE_Y + height * zoneSpan;

  float yInBar =
    smoothstep(BAR_BASE_Y - BAR_BASELINE_AA, BAR_BASE_Y + BAR_BASELINE_AA, uv.y) *
    (1.0 - smoothstep(barTop - BAR_TOP_AA, barTop + BAR_TOP_AA, uv.y));
  float fill = yInBar * insideBar;

  float yNorm = clamp((uv.y - BAR_BASE_Y) / max(barTop - BAR_BASE_Y, 0.001), 0.0, 1.0);

  vec3 baseHue = huePalette(uHue + t * HUE_BAR_SLIDE) * BASE_HUE_INTENSITY;
  vec3 tipHue = huePalette(uHue + t * HUE_BAR_SLIDE + HUE_TIP_SHIFT) * TIP_HUE_INTENSITY;
  vec3 hueBar = mix(baseHue, tipHue, yNorm);
  vec3 mutedCol = mix(BAR_MUTED_LO, BAR_MUTED_HI, yNorm);
  vec3 barColor = mix(mutedCol, hueBar, BAR_HUE_BLEND_BASE + audioGate(BAR_HUE_BLEND_AUDIO));

  float tipDist = abs(uv.y - barTop);
  float tipGlow =
    smoothstep(TIP_GLOW_RADIUS, 0.0, tipDist) * insideBar *
    smoothstep(BAR_BASE_Y, BAR_BASE_Y + BAR_TOP_LIVE_FLOOR, uv.y);
  vec3 tipGlowCol = mix(
    TIP_GLOW_BASE,
    huePalette(uHue + t * HUE_BAR_SLIDE + TIP_HUE_SLIDE) * TIP_HUE_PALETTE_GAIN,
    audioGate(TIP_HUE_BLEND)
  );

  float pitchBar = floor(uPitch * BAR_COUNT);
  float pitchProx = exp(-pow(barIdx - pitchBar, 2.0) * PITCH_PROXIMITY_FALLOFF);
  float pitchHighlight = pitchProx * audioGate(uVolume);

  vec3 color = bg;
  color += barColor * fill * audioMul(BAR_ENERGY_BASE + uEnergy * BAR_ENERGY_GAIN);
  color += tipGlowCol * tipGlow * audioMul(BAR_ENERGY_BASE + uEnergy * BAR_ENERGY_GAIN);
  color += PITCH_HUE_COLOR * fill * pitchHighlight * PITCH_HUE_INTENSITY;

  float sideVig =
    smoothstep(0.0, SIDE_VIGNETTE_RADIUS, uv.x) *
    smoothstep(0.0, SIDE_VIGNETTE_RADIUS, 1.0 - uv.x);
  color *= VIGNETTE_BASE + sideVig * VIGNETTE_GAIN;

  color = clamp(color, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
