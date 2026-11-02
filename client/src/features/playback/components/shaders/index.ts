import metaballs from './fragments/metaballs.glsl?raw';
import nebula from './fragments/nebula.glsl?raw';
import oscilloscope from './fragments/oscilloscope.glsl?raw';
import pitchGuide from './fragments/pitch-guide.glsl?raw';
import plasma from './fragments/plasma.glsl?raw';
import sonar from './fragments/sonar.glsl?raw';
import spectrum from './fragments/spectrum.glsl?raw';
import starfield from './fragments/starfield.glsl?raw';
import voronoi from './fragments/voronoi.glsl?raw';
import vortex from './fragments/vortex.glsl?raw';
import waves from './fragments/waves.glsl?raw';
import audioUniforms from './utils/audio-uniforms.glsl?raw';
import noise from './utils/noise.glsl?raw';
import srgb from './utils/srgb.glsl?raw';
import vertex from './vertex.glsl?raw';

const compose = (...parts: string[]) => parts.join('\n');
const withAudio = (frag: string) => compose(audioUniforms, srgb, noise, frag);
export const composeCustomFragment = withAudio;

export const vertexShader = vertex;

export type ShaderDefinition = {
  id: string;
  name: string;
  fragmentShader: string;
};

export const shaders: ShaderDefinition[] = [
  { id: 'plasma', name: 'Plasma', fragmentShader: withAudio(plasma) },
  { id: 'waves', name: 'Waves', fragmentShader: withAudio(waves) },
  { id: 'nebula', name: 'Nebula', fragmentShader: withAudio(nebula) },
  { id: 'starfield', name: 'Starfield', fragmentShader: withAudio(starfield) },
  { id: 'sonar', name: 'Sonar', fragmentShader: withAudio(sonar) },
  { id: 'voronoi', name: 'Voronoi', fragmentShader: withAudio(voronoi) },
  { id: 'vortex', name: 'Vortex', fragmentShader: withAudio(vortex) },
  { id: 'metaballs', name: 'Metaballs', fragmentShader: withAudio(metaballs) },
  { id: 'spectrum', name: 'Spectrum', fragmentShader: withAudio(spectrum) },
  { id: 'oscilloscope', name: 'Oscilloscope', fragmentShader: withAudio(oscilloscope) },
  { id: 'pitch-guide', name: 'Pitch Guide', fragmentShader: withAudio(pitchGuide) },
];
