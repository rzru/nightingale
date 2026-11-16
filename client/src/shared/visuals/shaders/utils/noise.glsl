const float HASH_SIN_MUL = 43758.5453;
const vec2 HASH_SIN_K = vec2(127.1, 311.7);

const float HASH21_K = 0.1031;
const float HASH21_BIAS = 33.33;
const float HASH22_OFFSET = 17.31;

float hash(vec2 p) {
  return fract(sin(dot(p, HASH_SIN_K)) * HASH_SIN_MUL);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * HASH21_K);
  p3 += dot(p3, p3.yzx + HASH21_BIAS);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + HASH22_OFFSET));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
