import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Augments may only use the classes and tokens listed in
// docs/theming/public-api.md. Nothing else ties that page to the code, so a
// renamed class or token would silently break every user theme. This test
// fails when the two drift apart in either direction.

const RENDERER = join(import.meta.dir, '..', '..');
const REPO = join(RENDERER, '..', '..', '..', '..');

const doc = readFileSync(join(REPO, 'docs', 'theming', 'public-api.md'), 'utf8');
const globalCss = readFileSync(join(RENDERER, 'styles', 'global.css'), 'utf8');
const settingsTs = readFileSync(join(RENDERER, 'store', 'settings.ts'), 'utf8');

const CLASS = /\bcord-[a-z]+(?:-[a-z]+)*(?:__[a-z]+(?:-[a-z]+)*)?(?:--[a-z]+(?:-[a-z]+)*)?/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return name.endsWith('.tsx') ? [path] : [];
  });
}

function documentedClasses(): Set<string> {
  return new Set([...doc.matchAll(/`\.?(cord-[a-z_-]+)`/g)].map((m) => m[1]!));
}

// Only className attributes count: 'cord-theme' and friends are storage keys.
function classesInSource(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(RENDERER)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('className')) continue;
      for (const m of line.matchAll(CLASS)) found.set(m[0], file);
    }
  }
  return found;
}

function documentedTokens(): Set<string> {
  return new Set([...doc.matchAll(/`(--[a-z0-9-]+)`/g)].map((m) => m[1]!));
}

function tokensInGlobalCss(): Set<string> {
  return new Set([...globalCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!));
}

function tokensSetAtRuntime(): Set<string> {
  return new Set([...settingsTs.matchAll(/setProperty\('(--[a-z0-9-]+)'/g)].map((m) => m[1]!));
}

describe('theming public API', () => {
  it('every documented class is applied somewhere', () => {
    const inSource = classesInSource();
    const missing = [...documentedClasses()].filter((c) => !inSource.has(c));
    expect(missing).toEqual([]);
  });

  it('every cord-* class in the renderer is documented', () => {
    const documented = documentedClasses();
    const undocumented = [...classesInSource()]
      .filter(([c]) => !documented.has(c))
      .map(([c, file]) => `${c} (${file})`);
    expect(undocumented).toEqual([]);
  });

  it('every documented token is defined', () => {
    const defined = new Set([...tokensInGlobalCss(), ...tokensSetAtRuntime()]);
    const missing = [...documentedTokens()].filter((t) => !defined.has(t));
    expect(missing).toEqual([]);
  });

  it('every token in global.css and settings is documented', () => {
    const documented = documentedTokens();
    const undocumented = [...tokensInGlobalCss(), ...tokensSetAtRuntime()]
      .filter((t) => !documented.has(t));
    expect([...new Set(undocumented)]).toEqual([]);
  });
});
