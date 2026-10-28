import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleLibrary } from '@shared/theming/assembleLibrary';
import type { RawThemeScan, ThemeLibraryScan } from '@shared/types';
import { ThemeLibraryService } from '../ThemeLibraryService';

// cord-core reads the fixture library raw (crates/cord-core/fixtures/themes/scan.raw.json);
// the renderer will assemble it. Together they must equal what the sidecar scan gives today.
const ROOT = join(import.meta.dir, '../../../../../../crates/cord-core/fixtures/themes');
const posix = (p: string): string => p.replace(/\\/g, '/');

function paths(scan: ThemeLibraryScan): ThemeLibraryScan {
  return {
    dir: posix(scan.dir),
    themes: scan.themes.map((t) => ({ ...t, path: posix(t.path) })),
    problems: scan.problems.map((p) => ({ ...p, path: posix(p.path) })),
  };
}

describe('theme library parity', () => {
  it("cord-core's raw scan plus assembleLibrary equals the sidecar scan", () => {
    const text = readFileSync(join(ROOT, 'scan.raw.json'), 'utf8').replace(/<root>/g, posix(ROOT));
    const raw = JSON.parse(text) as RawThemeScan;
    const fromRust = paths(assembleLibrary(raw));
    const fromSidecar = paths(new ThemeLibraryService().scan(join(ROOT, 'library')));
    expect(fromRust).toEqual(fromSidecar);
    expect(fromRust.themes.map((t) => t.id)).toEqual(['dusk', 'sea-glass']);
  });
});
