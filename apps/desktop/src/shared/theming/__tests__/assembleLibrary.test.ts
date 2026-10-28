import { describe, it, expect } from 'bun:test';
import { assembleLibrary } from '../assembleLibrary';
import type { RawTheme } from '@shared/types';

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
