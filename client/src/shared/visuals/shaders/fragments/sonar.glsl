const float TIME_SCALE = 0.6;

const float RING_FREQ = 11.0;
const float RING_TIME_SPEED = 1.2;
const float RING_POW = 6.0;

const float HALO_FREQ = 3.0;
const float HALO_TIME_SPEED = 0.4;
const float HALO_POW = 3.0;
const float HALO_INTENSITY = 0.3;

const float PING_VOLUME_GAIN = 0.6;
const float PING_MID_GAIN = 0.5;

const float FALLOFF_RADIUS = 2.5;

const float ANGULAR_HARMONIC = 3.0;
const float ANGULAR_TIME_SPEED = 0.2;
const float ANGULAR_AMP = 0.06;

const float WARM_NEUTRAL = 0.5;
const vec3 RING_COLOR_COOL = vec3(0.05, 0.18, 0.32);
const vec3 RING_COLOR_WARM = vec3(0.32, 0.18, 0.10);
const float HUE_RING_BLEND = 0.6;
const float HUE_RING_DARKEN = 0.5;
const float HUE_RING_TINT = 0.3;

const vec3 BG_COLOR = vec3(0.005, 0.01, 0.02);
const vec3 HALO_COLOR = vec3(0.04, 0.05, 0.10);

const float VIGNETTE_RADIUS = 1.5;
const float VIGNETTE_SOFTNESS = 0.7;
const float OUTPUT_CLAMP_MAX = 0.55;

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= WIDESCREEN_RATIO;

  float dist = length(uv);
  float angle = atan(uv.y, uv.x);

  float t = uTimeFast * TIME_SCALE;

  float ring = sin(dist * RING_FREQ - t * RING_TIME_SPEED) * 0.5 + 0.5;
  ring = pow(ring, RING_POW);

  float halo = sin(dist * HALO_FREQ - t * HALO_TIME_SPEED) * 0.5 + 0.5;
  halo = pow(halo, HALO_POW) * HALO_INTENSITY;

  float ping = audioMul(1.0 + uVolume * PING_VOLUME_GAIN + uMid * PING_MID_GAIN);
  ring *= ping;

  float falloff = smoothstep(FALLOFF_RADIUS, 0.0, dist);
  ring *= falloff;
  halo *= falloff;

  float angularMod = sin(angle * ANGULAR_HARMONIC + t * ANGULAR_TIME_SPEED) * ANGULAR_AMP + 1.0;
  ring *= angularMod;

  float warm = mix(WARM_NEUTRAL, uCentroid, uAudioReactive);
  vec3 baseRing = mix(RING_COLOR_COOL, RING_COLOR_WARM, warm);
  vec3 hueTint = huePalette(uHue);
  baseRing = mix(baseRing, baseRing * HUE_RING_DARKEN + hueTint * HUE_RING_TINT, audioGate(HUE_RING_BLEND));

  vec3 color = BG_COLOR + baseRing * ring + HALO_COLOR * halo;

  float vignette = 1.0 - length((vUv - 0.5) * VIGNETTE_RADIUS);
  color *= smoothstep(0.0, VIGNETTE_SOFTNESS, vignette);

  color = clamp(color, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
