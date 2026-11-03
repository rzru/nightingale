import { composeCustomFragment, vertexShader } from '@/features/playback/components/shaders';
import { t } from '@/i18n';

const validationVertexShader = `
attribute vec3 position;
attribute vec2 uv;
${vertexShader}
`;

export function customFragmentShader(source: string): string {
  return composeCustomFragment(source);
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | string {
  const shader = gl.createShader(type);
  if (shader === null) {
    return t('playback.shader.createError');
  }
  gl.shaderSource(shader, `precision highp float;\n${source}`);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    return typeof log === 'string' && log !== '' ? log : t('playback.shader.compileError');
  }
  return shader;
}

export function validateCustomShader(source: string): string | undefined {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl');
  if (gl === null) {
    return t('playback.shader.webglUnavailable');
  }

  const vertex = compileShader(gl, gl.VERTEX_SHADER, validationVertexShader);
  if (typeof vertex === 'string') {
    return vertex;
  }
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, customFragmentShader(source));
  if (typeof fragment === 'string') {
    gl.deleteShader(vertex);
    return fragment;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
  const linkLog = gl.getProgramInfoLog(program);
  let message: string | undefined;
  if (!linked) {
    message = typeof linkLog === 'string' && linkLog !== '' ? linkLog : 'Shader linking failed';
  }
  gl.deleteProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return message;
}
