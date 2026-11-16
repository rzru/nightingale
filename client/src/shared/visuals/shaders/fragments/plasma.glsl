const int PALETTE_ITERATIONS = 3;
const float TIME_SCALE = 0.1;
const float FLOW_GAIN = 0.6;
const float HUE_SHIFT_GAIN = 1.4;

const float UV_FRACT_SCALE = 1.2;
const float UV_FRACT_OFFSET = 0.5;
const float ITER_PHASE_STEP = 0.4;

const vec3 PAL_BASE = vec3(0.03, 0.02, 0.06);
const vec3 PAL_AMP = vec3(0.1, 0.1, 0.18);
const vec3 PAL_FREQ = vec3(1.0, 1.0, 1.0);
const vec3 PAL_PHASE = vec3(0.263, 0.416, 0.557);

const float SHARPEN_FREQ = 5.0;
const float SHARPEN_DIVISOR = 5.0;
const float SHARPEN_NUMER = 0.006;
const float SHARPEN_POW = 1.05;

const float ENERGY_BOOST_BASE = 0.95;
const float ENERGY_BOOST_GAIN = 0.3;
const float OUTPUT_SCALE = 0.45;
const float OUTPUT_CLAMP_MAX = 0.55;

vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU_2PI * (c * t + d));
}

void main() {
  float t = uTimeFast * TIME_SCALE;
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= WIDESCREEN_RATIO;

  uv = audioRot(audioGate(uFlow * FLOW_GAIN)) * uv;

  vec3 color = vec3(0.0);
  vec2 uv0 = uv;

  float paletteShift = audioGate(uHue * HUE_SHIFT_GAIN);

  for (int i = 0; i < PALETTE_ITERATIONS; i++) {
    uv = fract(uv * UV_FRACT_SCALE) - UV_FRACT_OFFSET;

    float d = length(uv) * exp(-length(uv0));
    vec3 col = palette(
      length(uv0) + float(i) * ITER_PHASE_STEP + t + paletteShift,
      PAL_BASE,
      PAL_AMP,
      PAL_FREQ,
      PAL_PHASE
    );

    d = sin(d * SHARPEN_FREQ + t) / SHARPEN_DIVISOR;
    d = abs(d);
    d = pow(SHARPEN_NUMER / d, SHARPEN_POW);

    color += col * d;
  }

  color *= audioMul(ENERGY_BOOST_BASE + uEnergy * ENERGY_BOOST_GAIN);
  color = clamp(color * OUTPUT_SCALE, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
