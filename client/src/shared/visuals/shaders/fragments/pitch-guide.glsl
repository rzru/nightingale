const int GUIDE_FBM_OCTAVES = 5;
const vec3 GUIDE_DEEP = vec3(0.006, 0.009, 0.025);
const vec3 GUIDE_BLUE = vec3(0.055, 0.16, 0.32);
const vec3 GUIDE_VIOLET = vec3(0.18, 0.07, 0.28);

float guideFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < GUIDE_FBM_OCTAVES; i++) {
    value += noise(p) * amplitude;
    p = p * 2.03 + vec2(1.7, -1.2);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = vUv;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= WIDESCREEN_RATIO;

  float audio = audioGate(uEnergy * 0.7 + uVolume * 0.5);
  float t = uTimeSlow * 0.16;
  vec2 drift = vec2(cos(uFlow * 0.7), sin(uFlow * 0.7));
  float fieldA = guideFbm(p * 1.15 + drift * t);
  float fieldB = guideFbm(p * 1.8 - drift.yx * t * 0.7 + fieldA * 0.45);

  float ribbonA = exp(-8.0 * abs(p.y - sin(p.x * 1.25 + t * 2.0 + fieldA) * 0.24));
  float ribbonB = exp(-10.0 * abs(p.y + 0.28 - sin(p.x * 0.85 - t * 1.4 + fieldB) * 0.18));
  float horizon = exp(-3.5 * length(vec2(p.x * 0.45, p.y * 1.2)));

  vec3 reactiveHue = huePalette(uHue + fieldB * 0.16);
  vec3 color = GUIDE_DEEP;
  color += mix(GUIDE_BLUE, reactiveHue * 0.24, audioGate(0.55)) * ribbonA * (0.18 + audio * 0.22);
  color += GUIDE_VIOLET * ribbonB * (0.16 + audio * 0.18);
  color += mix(GUIDE_BLUE, GUIDE_VIOLET, fieldA) * horizon * (0.16 + audio * 0.08);
  color += reactiveHue * max(fieldB - 0.58, 0.0) * 0.08 * audioMul(1.0 + uHigh);

  float vignette = 1.0 - smoothstep(0.25, 1.5, length(p * vec2(0.58, 0.9)));
  color *= 0.58 + vignette * 0.42;
  color = clamp(color, vec3(0.0), vec3(0.62));

  gl_FragColor = vec4(linearToSRGB(color), 1.0);
}
