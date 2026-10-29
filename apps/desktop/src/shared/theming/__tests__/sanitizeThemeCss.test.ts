import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeThemeCss, checkSelector } from '../sanitizeThemeCss';

const noAssets = { resolveAsset: () => null };
const run = (css: string, resolveAsset: (p: string) => string | null = () => null) =>
  sanitizeThemeCss(css, { resolveAsset });

describe('sanitizeThemeCss', () => {
  it('takes the id from the first [data-theme] selector', () => {
    expect(run('[data-theme="dusk"] { --accent: red; }').id).toBe('dusk');
    expect(run(':root { --accent: red; }').id).toBeNull();
  });

  it('keeps token overrides scoped to the theme, per scheme', () => {
    const { css, dropped } = run(`
      [data-theme="dusk"] { --accent: #f00; }
      [data-theme="dusk"][data-scheme="light"] { --bg: #fff; }`);
    expect(css).toContain('--accent: #f00');
    expect(css).toContain('--bg: #fff');
    expect(dropped).toEqual([]);
  });

  it('drops unscoped rules and rules for other themes', () => {
    const { css, dropped } = run(`
      [data-theme="dusk"] { --accent: red; }
      :root { --bg: black; }
      [data-theme="other"] { --bg: blue; }`);
    expect(css).not.toContain('black');
    expect(css).not.toContain('blue');
    expect(dropped).toHaveLength(2);
  });

  it('allows public classes and drops private ones, per selector', () => {
    const { css, dropped } = run(`
      [data-theme="dusk"] .cord-sidebar, [data-theme="dusk"] ._item_x7f2a { color: red; }
      [data-theme="dusk"] .sh-content { color: blue; }`);
    expect(css).toContain('.cord-sidebar');
    expect(css).not.toContain('_item_x7f2a');
    expect(css).not.toContain('blue');
    expect(dropped).toHaveLength(2);
  });

  it('allows note elements only inside the editor body', () => {
    expect(checkSelector('[data-theme="dusk"] .cord-editor__body h1', 'dusk')).toBeNull();
    expect(checkSelector('[data-theme="dusk"] .cord-editor__body blockquote > p', 'dusk')).toBeNull();
    expect(checkSelector('[data-theme="dusk"] h1', 'dusk')).not.toBeNull();
    expect(checkSelector('[data-theme="dusk"] .cord-editor__body div', 'dusk')).not.toBeNull();
  });

  it('allows simple pseudo-classes and checks inside :not()', () => {
    expect(checkSelector('[data-theme="dusk"] .cord-sidebar__item:hover::before', 'dusk')).toBeNull();
    expect(checkSelector('[data-theme="dusk"] .cord-chip:not(.cord-chip--tag)', 'dusk')).toBeNull();
    expect(checkSelector('[data-theme="dusk"] .cord-chip:not(.secret)', 'dusk')).not.toBeNull();
    expect(checkSelector('[data-theme="dusk"] .cord-chip:has(.cord-chip)', 'dusk')).not.toBeNull();
  });

  it('rejects ids, *, and other attributes', () => {
    expect(checkSelector('[data-theme="dusk"] #root', 'dusk')).not.toBeNull();
    expect(checkSelector('[data-theme="dusk"] *', 'dusk')).not.toBeNull();
    expect(checkSelector('[data-theme="dusk"] [aria-label]', 'dusk')).not.toBeNull();
  });

  it('drops @import and other at-rules, keeps @media and @font-face', () => {
    const { css, dropped } = run(`
      @import url("https://evil.example/x.css");
      @media (min-width: 600px) { [data-theme="dusk"] { --bg: #111; } :root { --bg: red; } }
      @font-face { font-family: Dusk; src: url("dusk.woff2"); }
      @page { margin: 0; }
      [data-theme="dusk"] { --accent: red; }`, (p) => (p === 'dusk.woff2' ? 'data:font/woff2;base64,AAA' : null));
    expect(css).not.toContain('@import');
    expect(css).toContain('@media (min-width: 600px)');
    expect(css).not.toContain('red;  }');
    expect(css).toContain('url("data:font/woff2;base64,AAA")');
    expect(css).not.toContain('@page');
    expect(dropped.some((d) => d.includes('@import'))).toBe(true);
  });

  it('drops declarations with remote or missing url()', () => {
    const { css, dropped } = sanitizeThemeCss(`
      [data-theme="dusk"] .cord-sidebar { background: url(https://x.example/a.png); color: red; }
      [data-theme="dusk"] .cord-editor { background: url(../../secret.png); }`, noAssets);
    expect(css).toContain('color: red');
    expect(css).not.toContain('x.example');
    expect(css).not.toContain('secret');
    expect(dropped).toHaveLength(2);
  });

  it('ignores braces inside strings and comments', () => {
    const { css } = run('/* } */ [data-theme="dusk"] .cord-chip::before { content: "}{"; color: red; }');
    expect(css).toContain('content: "}{"');
    expect(css).toContain('color: red');
  });

  it('passes the documented starter theme through untouched', () => {
    const template = readFileSync(join(import.meta.dir, '../../../../../../docs/theming/template-theme.css'), 'utf8');
    const { id, dropped } = run(template);
    expect(id).toBe('my-theme');
    expect(dropped).toEqual([]);
  });
});
