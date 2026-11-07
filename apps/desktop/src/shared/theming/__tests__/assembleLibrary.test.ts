import { describe, it, expect } from 'bun:test';
import { assembleLibrary } from '../assembleLibrary';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawTheme, RawThemeScan, ThemeLibraryScan } from '@shared/types';

const raw = (over: Partial<RawTheme>): RawTheme => ({
  cssPath: '/lib/x.css', folder: null, css: '', manifest: {}, assets: {}, sceneFiles: {}, ...over,
});

describe('assembleLibrary', () => {
  it('sanitizes, labels and sorts', () => {
    const scan = assembleLibrary({ dir: '/lib', problems: [], themes: [
      raw({ cssPath: '/lib/sea-glass.css', css: '[data-theme="sea-glass"] { --accent: #f00; }' }),
      raw({ cssPath: '/lib/dusk/theme.css', folder: '/lib/dusk', manifest: { name: 'Dusk', author: 'Ola' },
            css: '[data-theme="dusk"] { --accent: #f00; }\n:root { --bg: red; }' }),
    ]});
    expect(scan.themes.map((t) => [t.id, t.label, t.author])).toEqual([['dusk', 'Dusk', 'Ola'], ['sea-glass', 'Sea Glass', null]]);
    expect(scan.themes[0]!.css).not.toContain('red');
  });

  it('uses the asset map and reports built-in and duplicate ids', () => {
    const scan = assembleLibrary({ dir: '/lib', problems: [], themes: [
      raw({ css: '@font-face { font-family: A; src: url(f.woff2); } [data-theme="a"] { --accent: red; }',
            assets: { 'f.woff2': 'data:font/woff2;base64,Rk9OVA==' } }),
      raw({ cssPath: '/lib/m.css', css: '[data-theme="mono"] {}' }),
      raw({ cssPath: '/lib/b.css', css: '[data-theme="a"] {}' }),
    ]});
    expect(scan.themes[0]!.css).toContain('data:font/woff2;base64,Rk9OVA==');
    expect(scan.problems.map((p) => p.path)).toEqual(['/lib/m.css', '/lib/b.css']);
  });
});

// cord-core's raw scan of the shared fixture library, assembled here, must give
// what the old sidecar gave (recorded in scan.assembled.json before it was deleted).
describe('assembleLibrary on the shared fixture', () => {
  it('gives exactly the recorded library', () => {
    const dir = join(import.meta.dir, '../../../../../../crates/cord-core/fixtures/themes');
    const raw = JSON.parse(readFileSync(join(dir, 'scan.raw.json'), 'utf8')) as RawThemeScan;
    const recorded: unknown = JSON.parse(readFileSync(join(dir, 'scan.assembled.json'), 'utf8'));
    expect(assembleLibrary(raw)).toEqual(recorded as ThemeLibraryScan);
  });
});
