import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { ThemeLibraryService } from '../ThemeLibraryService';

const themeCss = (id: string) => `[data-theme="${id}"] { --accent: #f00; }\n:root { --bg: red; }`;

describe('ThemeLibraryService', () => {
  let root: string;
  let library: string;
  const service = new ThemeLibraryService();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cord-theme-test-'));
    library = join(root, 'library');
    mkdirSync(library);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads folder themes with a manifest and loose .css files', () => {
    mkdirSync(join(library, 'dusk'));
    writeFileSync(join(library, 'dusk', 'theme.css'), themeCss('dusk'));
    writeFileSync(join(library, 'dusk', 'theme.json'), JSON.stringify({ name: 'Dusk', author: 'Ola' }));
    writeFileSync(join(library, 'sea-glass.css'), themeCss('sea-glass'));

    const scan = service.scan(library);
    expect(scan.themes.map((t) => [t.id, t.label, t.author])).toEqual([
      ['dusk', 'Dusk', 'Ola'],
      ['sea-glass', 'Sea Glass', null],
    ]);
    expect(scan.themes[0]!.css).not.toContain('red');
    expect(scan.themes[0]!.dropped).toHaveLength(1);
  });

  it('inlines fonts beside the theme and refuses ones outside it', () => {
    mkdirSync(join(library, 'dusk'));
    writeFileSync(join(library, 'dusk', 'f.woff2'), 'FONT');
    writeFileSync(join(root, 'secret.woff2'), 'NOPE');
    writeFileSync(join(library, 'dusk', 'theme.css'), `
      @font-face { font-family: A; src: url(f.woff2); }
      @font-face { font-family: B; src: url(../../secret.woff2); }
      [data-theme="dusk"] { --accent: red; }`);
    const css = service.scan(library).themes[0]!.css;
    expect(css).toContain(`data:font/woff2;base64,${Buffer.from('FONT').toString('base64')}`);
    expect(css).not.toContain(Buffer.from('NOPE').toString('base64'));
  });

  it('reports missing folders, built-in ids and duplicate ids', () => {
    expect(service.scan(join(root, 'nope')).problems).toHaveLength(1);
    writeFileSync(join(library, 'a.css'), themeCss('mono'));
    writeFileSync(join(library, 'b.css'), themeCss('dup'));
    writeFileSync(join(library, 'c.css'), themeCss('dup'));
    const scan = service.scan(library);
    expect(scan.themes.map((t) => t.id)).toEqual(['dup']);
    expect(scan.problems).toHaveLength(2);
  });

  it('imports every theme in a folder, nested a level down', () => {
    const pack = join(root, 'pack');
    mkdirSync(join(pack, 'themes', 'dusk'), { recursive: true });
    writeFileSync(join(pack, 'themes', 'dusk', 'theme.css'), themeCss('dusk'));
    writeFileSync(join(pack, 'themes', 'loose.css'), themeCss('loose'));

    const result = service.importFrom(pack, library);
    expect(result.imported.map((t) => t.id).sort()).toEqual(['dusk', 'loose']);
    expect(existsSync(join(library, 'dusk', 'theme.css'))).toBe(true);
    expect(existsSync(join(library, 'loose', 'theme.css'))).toBe(true);
    expect(service.scan(library).themes).toHaveLength(2);
  });

  it('imports from a zip and leaves no temp files behind', () => {
    const zip = join(root, 'pack.zip');
    writeFileSync(zip, zipSync({
      'pack/dusk/theme.css': strToU8(themeCss('dusk')),
      'pack/dusk/theme.json': strToU8('{"name":"Dusk"}'),
    }));
    const result = service.importFrom(zip, library);
    expect(result.imported).toEqual([{ id: 'dusk', label: 'Dusk' }]);
    expect(readFileSync(join(library, 'dusk', 'theme.json'), 'utf8')).toContain('Dusk');
  });

  it('refuses zip entries that climb out of the extraction folder', () => {
    const zip = join(root, 'evil.zip');
    writeFileSync(zip, zipSync({ '../../evil.css': strToU8(themeCss('evil')) }));
    expect(() => service.importFrom(zip, library)).toThrow();
  });

  it('says so when nothing in the source is a theme', () => {
    mkdirSync(join(root, 'empty'));
    expect(() => service.importFrom(join(root, 'empty'), library)).toThrow(/No themes found/);
  });

  it('imports from a repo link, honours a folder in it, and remembers the link', async () => {
    const zip = zipSync({
      'themes-main/README.md': strToU8('hi'),
      'themes-main/packs/dusk/theme.css': strToU8(themeCss('dusk')),
      'themes-main/other/theme.css': strToU8(themeCss('other')),
    });
    const asked: string[] = [];
    const fromRepo = new ThemeLibraryService(async (url) => { asked.push(url); return new Response(new Uint8Array(zip)); });

    const link = 'https://github.com/acme/themes/tree/main/packs';
    const result = await fromRepo.importFromUrl(link, library);
    expect(asked).toEqual(['https://github.com/acme/themes/archive/main.zip']);
    expect(result.imported.map((t) => t.id)).toEqual(['dusk']);
    expect(fromRepo.scan(library).themes[0]!.source).toBe(link);
  });
});
