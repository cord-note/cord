import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSource, loadScenes, MAX_SCENES } from '../loadScenes';

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
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cord-scene-test-'));
    mkdirSync(join(folder, 'scenes'));
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('reads listed scenes with defaults and clamped settings', () => {
    writeFileSync(join(folder, 'scenes', 'Light House.glsl'), GOOD);
    const { scenes, problems } = loadScenes('dusk', folder, [
      { file: 'scenes/Light House.glsl', name: 'Lighthouse', marks: 'glyph', fps: 30, cell: 1 },
    ]);
    expect(problems).toEqual([]);
    expect(scenes).toEqual([
      { id: 'dusk/light-house', name: 'Lighthouse', source: GOOD, marks: 'glyph', fps: 8, cell: 3 },
    ]);
  });

  it('reports bad entries instead of failing the theme', () => {
    writeFileSync(join(folder, 'scenes', 'bad.glsl'), '#define X\n' + GOOD);
    writeFileSync(join(folder, 'scenes', 'notes.txt'), GOOD);
    writeFileSync(join(folder, '..', 'outside.glsl'), GOOD);
    const { scenes, problems } = loadScenes('dusk', folder, [
      { file: 'scenes/bad.glsl' },
      { file: 'scenes/notes.txt' },
      { file: '../outside.glsl' },
      { file: 'scenes/missing.glsl' },
    ]);
    expect(scenes).toEqual([]);
    expect(problems).toHaveLength(4);
    expect(problems[2]).toContain('inside the theme folder');
    rmSync(join(folder, '..', 'outside.glsl'));
  });

  it(`uses at most ${MAX_SCENES} scenes`, () => {
    const entries = Array.from({ length: MAX_SCENES + 2 }, (_, i) => {
      writeFileSync(join(folder, 'scenes', `s${i}.glsl`), GOOD);
      return { file: `scenes/s${i}.glsl` };
    });
    const { scenes, problems } = loadScenes('dusk', folder, entries);
    expect(scenes).toHaveLength(MAX_SCENES);
    expect(problems[0]).toContain(`first ${MAX_SCENES}`);
  });

  it('has nothing to say about a theme without scenes', () => {
    expect(loadScenes('dusk', folder, undefined)).toEqual({ scenes: [], problems: [] });
    expect(loadScenes('dusk', folder, 'nope').problems).toHaveLength(1);
  });
});
