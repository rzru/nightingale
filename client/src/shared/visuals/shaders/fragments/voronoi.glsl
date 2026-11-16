const float FLOW_GAIN = 0.4;
const float CELL_GRID_SCALE = 3.0;

const float CELL_DRIFT_X_BASE = 0.3;
const float CELL_DRIFT_X_RANGE = 0.4;
const float CELL_DRIFT_Y_BASE = 0.25;
const float CELL_DRIFT_Y_RANGE = 0.45;
const float CELL_DRIFT_AMP = 0.4;
const float CELL_OFFSET_BIAS = 0.5;

const float HUE_RANGE = 0.55;
const float HUE_SHIFT = -0.05;
const float CELL_COLOR_INTENSITY = 0.34;

const float WEIGHT_FALLOFF = 8.0;
const float GLOW_FALLOFF = 5.5;
const float GLOW_INTENSITY = 0.32;

const float GRAIN_NOISE_SCALE = 18.0;
const float GRAIN_TIME_SPEED = 0.05;
const float GRAIN_INTENSITY = 0.12;

const vec3 BG_COLOR = vec3(0.015, 0.020, 0.034);
const float ENERGY_BOOST_BASE = 0.95;
const float ENERGY_BOOST_GAIN = 0.25;

const float VIGNETTE_RADIUS = 1.6;
const float VIGNETTE_SOFTNESS = 0.7;
const float OUTPUT_CLAMP_MAX = 0.55;

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= WIDESCREEN_RATIO;

  uv = audioRot(audioGate(uFlow * FLOW_GAIN)) * uv;

  vec2 grid = uv * CELL_GRID_SCALE;
  vec2 cell = floor(grid);
  vec2 local = fract(grid);

  vec3 totalColor = vec3(0.0);
  float totalWeight = 0.0;
  float minDist = 10.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 neighbor = cell + offset;
      vec2 r = hash22(neighbor);
      vec2 pos = offset + CELL_OFFSET_BIAS + CELL_DRIFT_AMP * vec2(
        sin(uTimeSlow * (CELL_DRIFT_X_BASE + r.x * CELL_DRIFT_X_RANGE) + r.x * TAU_2PI),
        cos(uTimeSlow * (CELL_DRIFT_Y_BASE + r.y * CELL_DRIFT_Y_RANGE) + r.y * TAU_2PI)
      );
      float d = length(local - pos);
      minDist = min(minDist, d);

      float h = hash21(neighbor);
      vec3 cellColor = huePalette(uHue + h * HUE_RANGE + HUE_SHIFT) * CELL_COLOR_INTENSITY;

      float w = exp(-d * WEIGHT_FALLOFF);
      totalColor += cellColor * w;
      totalWeight += w;
    }
  }

  vec3 cellColor = totalColor / totalWeight;

  float glow = exp(-minDist * GLOW_FALLOFF) * GLOW_INTENSITY;
  cellColor *= 1.0 + glow;

  float grain = vnoise(uv * GRAIN_NOISE_SCALE + uTimeSlow * GRAIN_TIME_SPEED) - 0.5;
  cellColor *= 1.0 + grain * GRAIN_INTENSITY;

  vec3 color = BG_COLOR + cellColor;
  color *= audioMul(ENERGY_BOOST_BASE + uEnergy * ENERGY_BOOST_GAIN);

  float vignette = 1.0 - length((vUv - 0.5) * VIGNETTE_RADIUS);
  color *= smoothstep(0.0, VIGNETTE_SOFTNESS, vignette);

  color = clamp(color, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
