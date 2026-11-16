const float SRGB_LINEAR_THRESHOLD = 0.0031308;
const float SRGB_LINEAR_SLOPE = 12.92;
const float SRGB_GAMMA_SCALE = 1.055;
const float SRGB_GAMMA_OFFSET = 0.055;
const float SRGB_GAMMA_EXP_INV = 1.0 / 2.4;

vec3 linearToSRGB(vec3 c) {
  vec3 lo = c * SRGB_LINEAR_SLOPE;
  vec3 hi = SRGB_GAMMA_SCALE * pow(c, vec3(SRGB_GAMMA_EXP_INV)) - SRGB_GAMMA_OFFSET;
  return mix(lo, hi, step(vec3(SRGB_LINEAR_THRESHOLD), c));
}
