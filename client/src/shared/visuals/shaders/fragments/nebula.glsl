const int FBM_OCTAVES = 6;
const float FBM_LACUNARITY = 2.2;
const float FBM_GAIN = 0.45;
const float FBM_AMP_INIT = 0.5;

const float TIME_SCALE = 0.06;
const float FLOW_GAIN = 0.7;
const float NOISE_SCALE_BASE = 2.5;
const float ENERGY_SCALE_GAIN = 1.2;

const float NOISE1_TIME_Y = 0.4;
const float NOISE2_SCALE = 3.0;
const float NOISE2_TIME_X = -0.3;
const float NOISE2_TIME_Y = 0.7;
const float NOISE2_FEEDBACK = 0.5;
const float NOISE3_SCALE = 1.8;
const float NOISE3_TIME_X = 0.2;
const float NOISE3_TIME_Y = -0.5;

const float WARM_NEUTRAL = 0.5;
const vec3 PURPLE_COLOR = vec3(0.12, 0.03, 0.18);
const float PURPLE_GAIN = 1.8;
const float PURPLE_WARM_BASE = 0.7;
const float PURPLE_WARM_GAIN = 0.6;
const vec3 TEAL_COLOR = vec3(0.02, 0.08, 0.12);
const float TEAL_GAIN = 1.5;
const float TEAL_WARM_BASE = 1.3;
const float TEAL_WARM_GAIN = 0.6;
const vec3 DUST_COLOR = vec3(0.08, 0.04, 0.02);
const float DUST_GAIN = 0.8;

const float GLOW_THRESHOLD_LO = 0.45;
const float GLOW_THRESHOLD_HI = 0.75;
const float GLOW_INTENSITY = 0.3;
const vec3 GLOW_COLOR = vec3(0.08, 0.04, 0.15);

const float HUE_TINT_INTENSITY = 0.12;
const float ENERGY_BOOST_GAIN = 0.35;

const float VIGNETTE_RADIUS = 1.6;
const float VIGNETTE_SOFTNESS = 0.6;
const float OUTPUT_CLAMP_MAX = 0.55;

float fbm(vec2 p) {
  float value = 0.0;
  float amp = FBM_AMP_INIT;
  for (int i = 0; i < FBM_OCTAVES; i++) {
    value += amp * noise(p);
    p *= FBM_LACUNARITY;
    amp *= FBM_GAIN;
  }
  return value;
}

void main() {
  float t = uTimeFast * TIME_SCALE;
  vec2 uv = vUv;
  uv.x *= WIDESCREEN_RATIO;

  mat2 rot = audioRot(audioGate(uFlow * FLOW_GAIN));
  float scale = NOISE_SCALE_BASE + audioGate(uEnergy * ENERGY_SCALE_GAIN);

  float n1 = fbm(uv * scale + rot * vec2(t, t * NOISE1_TIME_Y));
  float n2 = fbm(uv * NOISE2_SCALE + rot * vec2(t * NOISE2_TIME_X, t * NOISE2_TIME_Y) + n1 * NOISE2_FEEDBACK);
  float n3 = fbm(uv * NOISE3_SCALE - rot * vec2(t * NOISE3_TIME_X, t * NOISE3_TIME_Y));

  float warm = mix(WARM_NEUTRAL, uCentroid, uAudioReactive);
  vec3 purple = PURPLE_COLOR * n1 * PURPLE_GAIN * (PURPLE_WARM_BASE + warm * PURPLE_WARM_GAIN);
  vec3 teal = TEAL_COLOR * n2 * TEAL_GAIN * (TEAL_WARM_BASE - warm * TEAL_WARM_GAIN);
  vec3 dust = DUST_COLOR * n3 * DUST_GAIN;

  vec3 color = purple + teal + dust;

  float glow = smoothstep(GLOW_THRESHOLD_LO, GLOW_THRESHOLD_HI, n1 * n2) * GLOW_INTENSITY;
  color += GLOW_COLOR * glow;

  vec3 huedTint = huePalette(uHue) * HUE_TINT_INTENSITY;
  color += huedTint * audioGate(1.0);
  color *= audioMul(1.0 + uEnergy * ENERGY_BOOST_GAIN);

  float vignette = 1.0 - length((vUv - 0.5) * VIGNETTE_RADIUS);
  color *= smoothstep(0.0, VIGNETTE_SOFTNESS, vignette);

  color = clamp(color, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
