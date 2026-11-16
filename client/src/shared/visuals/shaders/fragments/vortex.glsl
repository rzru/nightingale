const float TIME_SCALE = 0.6;
const float FLOW_GAIN = 0.4;
const float PITCH_DISPLACE_GAIN = 0.6;
const float PITCH_DISPLACE_FREQ = 4.0;
const float PITCH_DISPLACE_TIME_SPEED = 0.5;

const float DEPTH_MIN_RADIUS = 0.05;
const float DEPTH_RING_FREQ = 2.5;
const float DEPTH_RING_TIME_SPEED = 1.0;
const float DEPTH_RING_ANGULAR_HARMONIC = 2.0;
const float RING_POW_BASE = 4.0;
const float RING_POW_ENERGY_GAIN = 2.5;

const float SPOKE_HARMONIC = 6.0;
const float SPOKE_TIME_SPEED = 0.3;
const float SPOKE_POW = 4.0;
const float SPOKE_INTENSITY = 0.15;

const vec3 NEAR_WARM_COOL = vec3(0.10, 0.05, 0.18);
const vec3 NEAR_WARM_HOT = vec3(0.20, 0.10, 0.06);
const vec3 FAR_COLD = vec3(0.005, 0.010, 0.025);
const float BASE_GAIN = 1.5;

const vec3 RING_COLOR_COOL = vec3(0.12, 0.10, 0.22);
const vec3 RING_COLOR_WARM = vec3(0.18, 0.12, 0.16);
const float RING_WARM_BLEND = 0.7;
const float HUE_TINT_INTENSITY = 0.3;
const float HUE_RING_DARKEN = 0.6;
const float HUE_RING_BLEND = 0.5;

const float ENERGY_RING_BASE = 0.9;
const float ENERGY_RING_GAIN = 0.5;
const float SPOKE_FALLOFF_GAIN = 0.4;

const float CORE_FALLOFF = 4.0;
const float CORE_INTENSITY = 0.25;
const vec3 CORE_COLOR = vec3(0.10, 0.06, 0.18);

const float FALLOFF_RADIUS = 2.0;
const float VIGNETTE_RADIUS = 1.5;
const float VIGNETTE_SOFTNESS = 0.6;
const float OUTPUT_CLAMP_MAX = 0.6;

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= WIDESCREEN_RATIO;

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  float t = uTimeFast * TIME_SCALE;

  a += audioGate(uFlow * FLOW_GAIN);
  a += audioGate(uPitch * PITCH_DISPLACE_GAIN) * sin(r * PITCH_DISPLACE_FREQ - uTimeFast * PITCH_DISPLACE_TIME_SPEED);

  float depth = 1.0 / max(r, DEPTH_MIN_RADIUS);
  float ring = sin(depth * DEPTH_RING_FREQ - t * DEPTH_RING_TIME_SPEED + a * DEPTH_RING_ANGULAR_HARMONIC) * 0.5 + 0.5;
  float k = RING_POW_BASE - audioGate(uEnergy * RING_POW_ENERGY_GAIN);
  ring = pow(ring, k);

  float spokes = sin(a * SPOKE_HARMONIC + t * SPOKE_TIME_SPEED) * 0.5 + 0.5;
  spokes = pow(spokes, SPOKE_POW) * SPOKE_INTENSITY;

  vec3 nearWarm = mix(NEAR_WARM_COOL, NEAR_WARM_HOT, audioGate(uCentroid));
  vec3 base = mix(nearWarm, FAR_COLD, smoothstep(0.0, 1.0, r));

  vec3 hueTint = huePalette(uHue) * HUE_TINT_INTENSITY;
  vec3 ringColor = mix(RING_COLOR_COOL, RING_COLOR_WARM, audioGate(RING_WARM_BLEND));
  ringColor = mix(ringColor, ringColor * HUE_RING_DARKEN + hueTint, audioGate(HUE_RING_BLEND));

  float falloff = smoothstep(FALLOFF_RADIUS, 0.0, r);

  vec3 color = base * BASE_GAIN + ringColor * ring * falloff * audioMul(ENERGY_RING_BASE + uEnergy * ENERGY_RING_GAIN);
  color += ringColor * spokes * falloff * SPOKE_FALLOFF_GAIN;

  float core = exp(-r * CORE_FALLOFF) * CORE_INTENSITY;
  color += CORE_COLOR * core;

  float vignette = 1.0 - length((vUv - 0.5) * VIGNETTE_RADIUS);
  color *= smoothstep(0.0, VIGNETTE_SOFTNESS, vignette);

  color = clamp(color, vec3(0.0), vec3(OUTPUT_CLAMP_MAX));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
