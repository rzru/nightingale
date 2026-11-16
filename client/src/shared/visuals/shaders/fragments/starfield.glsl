const float DRIFT_X_SPEED = 0.008;
const float DRIFT_Y_SPEED = 0.003;

const float LAYER0_SCALE = 12.0;
const float LAYER0_BRIGHTNESS = 0.6;
const float LAYER0_TWINKLE_SPEED = 0.8;
const float LAYER0_PARALLAX = 1.0;

const float LAYER1_SCALE = 24.0;
const float LAYER1_BRIGHTNESS = 0.35;
const float LAYER1_TWINKLE_SPEED = 1.2;
const float LAYER1_PARALLAX = 0.5;

const float LAYER2_SCALE = 48.0;
const float LAYER2_BRIGHTNESS = 0.15;
const float LAYER2_TWINKLE_SPEED = 1.6;
const float LAYER2_PARALLAX = 0.2;

const float STAR_OFFSET_RANGE = 0.7;
const float STAR_POS_SEED_X = 100.0;
const float STAR_POS_SEED_Y = 200.0;
const float TWINKLE_SPEED_GAIN = 3.0;
const float TWINKLE_SPEED_BASE = 1.0;
const float STAR_SIZE_BASE = 0.008;
const float STAR_SIZE_RANDOM = 0.03;
const float TWINKLE_BASE = 0.5;
const float TWINKLE_GAIN = 0.5;

const vec3 BG_BOTTOM = vec3(0.01, 0.01, 0.04);
const vec3 BG_TOP = vec3(0.04, 0.02, 0.06);
const float BG_HUE_INTENSITY = 0.025;
const float BG_HUE_BLEND = 0.55;
const float BG_HUE_DARKEN = 0.88;

const vec3 STAR_BASE_TINT = vec3(0.7, 0.8, 1.0);
const float STAR_HUE_BLEND = 0.85;
const float STAR_ENERGY_GAIN = 0.4;
const float OUTPUT_CLAMP_MAX = 0.7;

float starLayer(vec2 uv, float scale, float brightness, float speed) {
  vec2 grid = uv * scale;
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;

  float stars = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 neighbor = cell + offset;
      float rnd = hash21(neighbor);
      vec2 pos = vec2(hash21(neighbor + STAR_POS_SEED_X) - 0.5, hash21(neighbor + STAR_POS_SEED_Y) - 0.5);
      float d = length(local - offset - pos * STAR_OFFSET_RANGE);
      float twinkle = sin(uTime * speed * (rnd * TWINKLE_SPEED_GAIN + TWINKLE_SPEED_BASE) + rnd * TAU_2PI) * 0.5 + 0.5;
      float size = rnd * STAR_SIZE_RANDOM + STAR_SIZE_BASE;
      stars += smoothstep(size, 0.0, d) * brightness * (TWINKLE_BASE + TWINKLE_GAIN * twinkle);
    }
  }
  return stars;
}

void main() {
  vec2 uv = vUv;
  uv.x *= WIDESCREEN_RATIO;

  vec2 baseDrift = vec2(uTimeFast * DRIFT_X_SPEED, uTimeFast * DRIFT_Y_SPEED);
  vec2 drift = audioRot(audioGate(uFlow)) * baseDrift;

  float stars = 0.0;
  stars += starLayer(uv + drift * LAYER0_PARALLAX, LAYER0_SCALE, LAYER0_BRIGHTNESS, LAYER0_TWINKLE_SPEED);
  stars += starLayer(uv + drift * LAYER1_PARALLAX, LAYER1_SCALE, LAYER1_BRIGHTNESS, LAYER1_TWINKLE_SPEED);
  stars += starLayer(uv + drift * LAYER2_PARALLAX, LAYER2_SCALE, LAYER2_BRIGHTNESS, LAYER2_TWINKLE_SPEED);

  vec3 bgGrad = mix(BG_BOTTOM, BG_TOP, uv.y);
  vec3 bgHue = huePalette(uHue) * BG_HUE_INTENSITY;
  bgGrad = mix(bgGrad, bgGrad * BG_HUE_DARKEN + bgHue, audioGate(BG_HUE_BLEND));

  vec3 starTint = mix(STAR_BASE_TINT, huePalette(uHue), audioGate(STAR_HUE_BLEND));

  vec3 color = bgGrad + starTint * stars * audioMul(1.0 + uEnergy * STAR_ENERGY_GAIN);
  color = clamp(color, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
