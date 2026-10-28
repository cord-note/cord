import { describe, it, expect } from 'bun:test';
import { checkSource, loadScenes, MAX_SCENES } from '../loadScenes';
import type { RawSceneFile } from '@shared/types';

const GOOD = 'float scene(vec2 p, vec2 span) { return fbm(p * 3.0 + uTime * 0.1); }\n';

describe('checkSource', () => {
  it('accepts a plain scene function', () => {
    expect(checkSource(GOOD)).toBeNull();
  });

  it.each([
    ['#extension GL_OES_standard_derivatives : enable\n' + GOOD, 'preprocessor'],
    ['#define X 1.0\n' + GOOD, 'preprocessor'],
    ['uniform sampler2D steal;\n' + GOOD, 'uniforms'],
    [GOOD + 'void main() {}\n', 'main()'],
    [GOOD.replace('return', 'gl_FragColor = vec4(1.0); return'), 'pixels'],
    ['float scene(vec2 p) { return 1.0; }', 'missing'],
    [GOOD + '// café\n', 'ASCII'],
  ])('refuses %#', (source, reason) => {
    expect(checkSource(source)).toContain(reason);
  });
});

describe('loadScenes', () => {
  it('reads listed scenes with defaults and clamped settings', () => {
    const { scenes, problems } = loadScenes('dusk', [
      { file: 'scenes/Light House.glsl', name: 'Lighthouse', marks: 'glyph', fps: 30, cell: 1 },
    ], { 'scenes/Light House.glsl': { source: GOOD } });
    expect(problems).toEqual([]);
    expect(scenes).toEqual([
      { id: 'dusk/light-house', name: 'Lighthouse', source: GOOD, marks: 'glyph', fps: 8, cell: 3 },
    ]);
  });

  it('reports bad entries instead of failing the theme', () => {
    const { scenes, problems } = loadScenes('dusk', [
      { file: 'scenes/bad.glsl' },
      { file: 'scenes/notes.txt' },
      { file: '../outside.glsl' },
      { file: 'scenes/missing.glsl' },
    ], {
      'scenes/bad.glsl': { source: '#define X\n' + GOOD },
      'scenes/notes.txt': { error: 'must be a .glsl file' },
      '../outside.glsl': { error: 'must be inside the theme folder' },
      'scenes/missing.glsl': { error: 'file not found' },
    });
    expect(scenes).toEqual([]);
    expect(problems).toHaveLength(4);
    expect(problems[2]).toContain('inside the theme folder');
  });

  it(`uses at most ${MAX_SCENES} scenes`, () => {
    const files: Record<string, RawSceneFile> = {};
    const entries = Array.from({ length: MAX_SCENES + 2 }, (_, i) => {
      files[`scenes/s${i}.glsl`] = { source: GOOD };
      return { file: `scenes/s${i}.glsl` };
    });
    const { scenes, problems } = loadScenes('dusk', entries, files);
    expect(scenes).toHaveLength(MAX_SCENES);
    expect(problems[0]).toContain(`first ${MAX_SCENES}`);
  });

  it('has nothing to say about a theme without scenes', () => {
    expect(loadScenes('dusk', undefined, {})).toEqual({ scenes: [], problems: [] });
    expect(loadScenes('dusk', 'nope', {}).problems).toHaveLength(1);
  });
});
