const int BLOB_COUNT = 6;
const float TIME_SCALE = 0.5;
const float FLOW_GAIN = 0.4;

const float BLOB_X_SPAN = 1.1;
const float BLOB_Y_SPAN = 0.7;
const float MIN_DIST_SQ = 0.0001;

const float BASE_RADIUS = 0.32;
const float LOW_RADIUS_GAIN = 0.20;
const float MID_RADIUS_GAIN = 0.20;
const float HIGH_RADIUS_GAIN = 0.18;
const float SECONDARY_RADIUS_FALLOFF = 0.85;

const float SURFACE_LO = 0.97;
const float SURFACE_HI = 1.03;
const float RIM_THICKNESS = 0.04;
const float INTERIOR_LO = 1.1;
const float INTERIOR_HI = 1.6;
const float HIGHLIGHT_FADE_LO = 1.4;
const float HIGHLIGHT_FADE_HI = 1.9;
const float HIGHLIGHT_POW = 4.0;
const float HIGHLIGHT_GRAD_MIN = 0.0001;

const vec2 LIGHT_DIR = vec2(0.6, 0.7);

const vec3 BG_COLOR = vec3(0.010, 0.015, 0.030);
const vec3 BLOB_BASE = vec3(0.10, 0.12, 0.22);
const vec3 BLOB_DEEP = vec3(0.18, 0.09, 0.24);
const vec3 RIM_COOL = vec3(0.40, 0.42, 0.55);
const vec3 RIM_HUE_TINT = vec3(0.25, 0.22, 0.35);
const float RIM_HUE_INTENSITY = 0.55;
const vec3 HIGHLIGHT_COLOR = vec3(0.55, 0.55, 0.65);

const float SURFACE_INTENSITY = 0.7;
const float INTERIOR_INTENSITY = 0.35;
const float RIM_INTENSITY = 0.55;
const float RIM_HUE_BLEND = 0.7;
const float ENERGY_RIM_BASE = 1.0;
const float ENERGY_RIM_GAIN = 0.4;
const float ENERGY_HIGHLIGHT_BASE = 0.9;
const float ENERGY_HIGHLIGHT_GAIN = 0.5;

const float VIGNETTE_RADIUS = 1.6;
const float VIGNETTE_SOFTNESS = 0.7;
const float OUTPUT_CLAMP_MAX = 0.65;

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= WIDESCREEN_RATIO;

  vec2 p = audioRot(audioGate(uFlow * FLOW_GAIN)) * uv;

  float t = uTimeSlow * TIME_SCALE;

  float kx[6];
  kx[0] = 0.27; kx[1] = 0.41; kx[2] = 0.33; kx[3] = 0.19; kx[4] = 0.47; kx[5] = 0.23;
  float ky[6];
  ky[0] = 0.34; ky[1] = 0.22; ky[2] = 0.45; ky[3] = 0.31; ky[4] = 0.18; ky[5] = 0.38;
  float ox[6];
  ox[0] = 0.0; ox[1] = 1.7; ox[2] = 3.1; ox[3] = 4.6; ox[4] = 0.9; ox[5] = 5.2;
  float oy[6];
  oy[0] = 1.2; oy[1] = 4.4; oy[2] = 0.5; oy[3] = 2.8; oy[4] = 5.7; oy[5] = 3.6;

  float lowR = audioGate(uLow * LOW_RADIUS_GAIN);
  float midR = audioGate(uMid * MID_RADIUS_GAIN);
  float highR = audioGate(uHigh * HIGH_RADIUS_GAIN);
  float radii[6];
  radii[0] = BASE_RADIUS + lowR;
  radii[1] = BASE_RADIUS + lowR * SECONDARY_RADIUS_FALLOFF;
  radii[2] = BASE_RADIUS + midR;
  radii[3] = BASE_RADIUS + midR * SECONDARY_RADIUS_FALLOFF;
  radii[4] = BASE_RADIUS * SECONDARY_RADIUS_FALLOFF + highR;
  radii[5] = BASE_RADIUS * SECONDARY_RADIUS_FALLOFF + highR * SECONDARY_RADIUS_FALLOFF;

  float field = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < BLOB_COUNT; i++) {
    vec2 c = vec2(
      cos(t * kx[i] + ox[i]) * BLOB_X_SPAN,
      sin(t * ky[i] + oy[i]) * BLOB_Y_SPAN
    );
    vec2 d = p - c;
    float d2 = max(dot(d, d), MIN_DIST_SQ);
    float r2 = radii[i] * radii[i];
    float inv = 1.0 / d2;
    field += r2 * inv;
    grad += -2.0 * r2 * d * inv * inv;
  }

  float surface = smoothstep(SURFACE_LO, SURFACE_HI, field);
  float rim = 1.0 - smoothstep(0.0, RIM_THICKNESS, abs(field - 1.0));
  float interior = smoothstep(INTERIOR_LO, INTERIOR_HI, field);

  float gradLen = length(grad);
  float highlight = 0.0;
  if (gradLen > HIGHLIGHT_GRAD_MIN) {
    vec2 n = grad / gradLen;
    vec2 lightDir = normalize(LIGHT_DIR);
    highlight = max(0.0, dot(n, lightDir));
    highlight = pow(highlight, HIGHLIGHT_POW);
    highlight *= surface * (1.0 - smoothstep(HIGHLIGHT_FADE_LO, HIGHLIGHT_FADE_HI, field));
  }

  vec3 hueTint = huePalette(uHue);
  vec3 fill = mix(BLOB_BASE, BLOB_DEEP, audioGate(uCentroid));
  vec3 rimColor = mix(RIM_COOL, hueTint * RIM_HUE_INTENSITY + RIM_HUE_TINT, audioGate(RIM_HUE_BLEND));

  float rimBoost = audioMul(ENERGY_RIM_BASE + uEnergy * ENERGY_RIM_GAIN);
  vec3 color = BG_COLOR
    + fill * surface * SURFACE_INTENSITY
    + fill * interior * INTERIOR_INTENSITY
    + rimColor * rim * rimBoost * RIM_INTENSITY
    + HIGHLIGHT_COLOR * highlight * audioMul(ENERGY_HIGHLIGHT_BASE + uEnergy * ENERGY_HIGHLIGHT_GAIN);

  float vignette = 1.0 - length((vUv - 0.5) * VIGNETTE_RADIUS);
  color *= smoothstep(0.0, VIGNETTE_SOFTNESS, vignette);

  color = clamp(color, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
