# Settings Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare every Cord setting once in a schema and derive the Settings UI, search, validation, defaults and a hand-editable `~/.cord/settings.json` (plus `keybindings.json`) from it.

**Architecture:** The renderer owns the schema (`renderer/settings/`), a Zustand store of effective values, and all parsing — files are JSONC and edited in place with `jsonc-parser` so comments survive. The sidecar stores the two files as opaque text with atomic writes (`SettingsFileService`), reached through two thin Tauri commands. A localStorage boot cache paints the first frame; the file is the source of truth.

**Tech Stack:** React + Vite + TypeScript (strict), Zustand, `jsonc-parser`, Bun sidecar, Tauri 2 (Rust), `bun test`.

**Spec:** `docs/specs/2026-09-27-settings-foundation-design.md`

## Conventions for every task

- Work in the worktree `C:\Users\Olek\Downloads\evrything-cord\cord-colour-leaks`, branch `feature/settings`.
- Run commands from `apps/desktop` in **bash** (the `test` script uses Unix env syntax):
  - Tests: `CORD_DB_PATH=:memory: bun test <path>`
  - Types: `pnpm typecheck`
  - Build: `pnpm build:renderer`
- Commit messages: plain sentence style matching `git log` (e.g. "Add the settings file service"). **No `Co-Authored-By` trailer** in this repo.
- No `console.*` outside `renderer/lib/log.ts`; use `log(level, scope, message, data?)`.
- `pnpm lint` has no ESLint config in this repo; skip it.

## File map

**Sidecar**
- Create `apps/desktop/src/sidecar/services/SettingsFileService.ts` — read/write `settings.json` / `keybindings.json` as text, atomically.
- Create `apps/desktop/src/sidecar/handlers/settings.ts` — `GET/POST /settings/:file`.
- Modify `apps/desktop/src/sidecar/index.ts` — wire the service and handlers.

**Tauri**
- Create `apps/desktop/src-tauri/src/commands/settings.rs` — `settings_read`, `settings_write`.
- Modify `apps/desktop/src-tauri/src/commands/mod.rs`, `apps/desktop/src-tauri/src/lib.rs`.

**Renderer — settings core** (`apps/desktop/src/renderer/settings/`)
- `jsonText.ts` — parse a JSONC object with positioned errors; set/remove one key in text.
- `schema.ts` — declaration types, `SettingValues`, validation, `resolveValues`.
- `registry.ts` — `useSettingsRegistry`, `registerSetting`, `settingDefinition`.
- `configFile.ts` — `ConfigFileIO` interface, debounced + serialised `ConfigFileWriter`.
- `ipcConfigIO.ts` — `ConfigFileIO` over `api.settings`.
- `store.ts` — `createSettingsStore(deps)` factory (pure, testable).
- `migration.ts` — legacy localStorage → first `settings.json`.
- `index.ts` — the app's store instance and hooks: `useSetting`, `getSetting`, `setSetting`, `resetSetting`, `snapToSetting`.
- `builtin.ts` — built-in declarations + CSS-variable effect.
- `boot.ts` — startup sequence and focus reload.
- `search.ts` — `filterSettings`.

**Renderer — UI** (`apps/desktop/src/renderer/components/settings/`)
- `controls.tsx`, `SettingRow.tsx`, `ThemePickerControl.tsx`, `FontSizeControl.tsx`, `KeyboardPage.tsx`, `VaultPage.tsx`, `TagsPage.tsx`, `pages.ts`, `JsonView.tsx`, `ProblemsBanner.tsx`.
- Rewrite `apps/desktop/src/renderer/components/SettingsPage.tsx`; extend `SettingsPage.module.css`.

**Modified elsewhere:** `ipc/index.ts`, `shared/types/index.ts`, `main.tsx`, `App.tsx`, `store/theme.ts`, `store/keybindings.ts`, `components/Editor.tsx`, `components/VaultSidebar.tsx`, `docs/theming/public-api.md`. **Deleted:** `store/settings.ts`.

---

### Task 1: SettingsFileService (sidecar)

**Files:**
- Create: `apps/desktop/src/sidecar/services/SettingsFileService.ts`
- Test: `apps/desktop/src/sidecar/services/__tests__/SettingsFileService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CONFIG_BYTES, SettingsFileService } from '../SettingsFileService';

// Settings files are stored as opaque text: the renderer owns parsing, so a
// hand-edited file — comments and all — must round-trip byte for byte.

describe('SettingsFileService', () => {
  let dir: string;
  let service: SettingsFileService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cord-config-'));
    process.env['CORD_CONFIG_DIR'] = join(dir, 'nested');
    service = new SettingsFileService();
  });

  afterEach(() => {
    delete process.env['CORD_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a missing file as null', () => {
    expect(service.read('settings')).toBeNull();
  });

  it('writes text verbatim, creating the directory, and reads it back', () => {
    const text = '{\n  // bigger text\n  "editor.fontSize": 17,\n}\n';
    service.write('settings', text);
    expect(readFileSync(join(dir, 'nested', 'settings.json'), 'utf8')).toBe(text);
    expect(service.read('settings')).toBe(text);
  });

  it('replaces an existing file and leaves no temp file behind', () => {
    service.write('keybindings', '{"a":1}');
    service.write('keybindings', '{"a":2}');
    expect(service.read('keybindings')).toBe('{"a":2}');
    expect(readdirSync(join(dir, 'nested'))).toEqual(['keybindings.json']);
  });

  it('rejects unknown file names', () => {
    expect(() => service.read('../cord')).toThrow(/Unknown settings file/);
    expect(() => service.write('secrets', '{}')).toThrow(/Unknown settings file/);
  });

  it('rejects oversized text without touching the file', () => {
    service.write('settings', '{}');
    expect(() => service.write('settings', 'x'.repeat(MAX_CONFIG_BYTES + 1))).toThrow(/exceeds/);
    expect(service.read('settings')).toBe('{}');
  });

  it('rejects non-string text', () => {
    expect(() => service.write('settings', 42 as unknown as string)).toThrow(/must be a string/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/SettingsFileService.test.ts`
Expected: FAIL — `Cannot find module '../SettingsFileService'`.

- [ ] **Step 3: Implement the service**

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDbPath } from '../db/client';

/**
 * Stores the user's settings files as opaque text in the config directory
 * (`~/.cord`, beside the database). The renderer owns the schema and does all
 * parsing, so a hand-edited file — comments and all — round-trips exactly.
 */

export const CONFIG_FILES = ['settings', 'keybindings'] as const;
export type ConfigFileName = (typeof CONFIG_FILES)[number];

/** Anything larger is not a settings file someone meant to write. */
export const MAX_CONFIG_BYTES = 1024 * 1024;

export function resolveConfigDir(): string {
  return process.env['CORD_CONFIG_DIR'] ?? dirname(resolveDbPath());
}

export class SettingsFileService {
  read(name: string): string | null {
    const path = this.pathFor(name);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }

  write(name: string, text: string): void {
    const path = this.pathFor(name);
    if (typeof text !== 'string') throw new Error('Settings text must be a string');
    if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) {
      throw new Error(`Settings file exceeds ${MAX_CONFIG_BYTES} bytes`);
    }
    mkdirSync(dirname(path), { recursive: true });
    // Write beside the target and rename over it, so a crash mid-write never
    // leaves a truncated settings file.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, path);
  }

  private pathFor(name: string): string {
    if (!(CONFIG_FILES as readonly string[]).includes(name)) {
      throw new Error(`Unknown settings file "${name}"`);
    }
    return join(resolveConfigDir(), `${name}.json`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/SettingsFileService.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/services/SettingsFileService.ts src/sidecar/services/__tests__/SettingsFileService.test.ts
git commit -m "Add the settings file service"
```

---

### Task 2: Settings IPC — sidecar handlers, Tauri commands, renderer api

**Files:**
- Create: `apps/desktop/src/sidecar/handlers/settings.ts`
- Modify: `apps/desktop/src/sidecar/index.ts` (imports near line 18, services near line 33, registration near line 50)
- Create: `apps/desktop/src-tauri/src/commands/settings.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`, `apps/desktop/src-tauri/src/lib.rs:86`
- Modify: `apps/desktop/src/shared/types/index.ts` (append), `apps/desktop/src/renderer/ipc/index.ts`
- Test: existing `apps/desktop/src/renderer/ipc/__tests__/parity.test.ts`

- [ ] **Step 1: Add the renderer api first so the parity test fails**

Append to `apps/desktop/src/shared/types/index.ts`:

```ts
/** The user's hand-editable config files in ~/.cord. */
export type ConfigFileName = 'settings' | 'keybindings';
```

In `apps/desktop/src/renderer/ipc/index.ts`, add `ConfigFileName` to the `@shared/types` import list, and add this block after `auth: { … },` (before `} as const;`):

```ts
  settings: {
    read:  (file: ConfigFileName)               => invoke<{ text: string | null }>('settings_read', { file }),
    write: (file: ConfigFileName, text: string) => invoke<{ ok: true }>('settings_write', { file, text }),
  },
```

- [ ] **Step 2: Run the parity test to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/ipc`
Expected: FAIL — `settings_read` and `settings_write` are invoked but not registered.

- [ ] **Step 3: Add the Tauri commands**

Create `apps/desktop/src-tauri/src/commands/settings.rs`:

```rust
use crate::state::AppState;
use super::http::{fwd_get, fwd_post};
use serde_json::{json, Value};
use tauri::State;

// Thin forwards. The sidecar validates the file name and stores the text.

#[tauri::command]
pub async fn settings_read(state: State<'_, AppState>, file: String) -> Result<Value, String> {
    fwd_get(&state, &format!("/settings/{file}")).await
}

#[tauri::command]
pub async fn settings_write(
    state: State<'_, AppState>,
    file: String,
    text: String,
) -> Result<Value, String> {
    fwd_post(&state, &format!("/settings/{file}"), json!({ "text": text })).await
}
```

In `apps/desktop/src-tauri/src/commands/mod.rs` add `pub mod settings;` after `pub mod notes;` (keep the list alphabetical after `http`).

In `apps/desktop/src-tauri/src/lib.rs`, after `commands::attachments::attachments_create,` add:

```rust
            // settings
            commands::settings::settings_read,
            commands::settings::settings_write,
```

- [ ] **Step 4: Add the sidecar handlers**

Create `apps/desktop/src/sidecar/handlers/settings.ts`:

```ts
import { Router, json, ok } from '../router';
import type { SettingsFileService } from '../services/SettingsFileService';

// No session check: the theme and colour mode apply on the sign-in screen too,
// and settings are per-device, not per-account.
export function registerSettingsHandlers(router: Router, files: SettingsFileService): void {
  router.get('/settings/:file', async (_req, { file }) => {
    return json({ text: files.read(file!) });
  });

  router.post('/settings/:file', async (req, { file }) => {
    const { text } = (await req.json()) as { text: string };
    files.write(file!, text);
    return ok();
  });
}
```

In `apps/desktop/src/sidecar/index.ts`:
- after the `AttachmentService` import add `import { SettingsFileService } from './services/SettingsFileService';`
- after the `registerAttachmentHandlers` import add `import { registerSettingsHandlers }   from './handlers/settings';`
- after `const attachments = new AttachmentService();` add `const settingsFiles = new SettingsFileService();`
- after `registerAttachmentHandlers(router, attachments, auth);` add `registerSettingsHandlers(router, settingsFiles);`

- [ ] **Step 5: Verify**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/ipc` → PASS.
Run: `pnpm typecheck` → no errors.
Run (from `apps/desktop/src-tauri`): `cargo check` → `Finished`, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/sidecar/handlers/settings.ts src/sidecar/index.ts src-tauri/src/commands/settings.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/shared/types/index.ts src/renderer/ipc/index.ts
git commit -m "Expose settings files over IPC"
```

---

### Task 3: jsonText — JSONC parsing and in-place key edits

**Files:**
- Modify: `apps/desktop/package.json` (dependency)
- Create: `apps/desktop/src/renderer/settings/jsonText.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/jsonText.test.ts`

- [ ] **Step 1: Add the dependency**

Run (from `apps/desktop`): `pnpm add jsonc-parser@^3.3.1`
Expected: `package.json` gains `"jsonc-parser": "^3.3.1"` under `dependencies`; lockfile updated.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { parseJsoncObject, positionOf, setKeyInText } from '../jsonText';

// settings.json is meant to be edited by hand, so it allows comments and
// trailing commas, and edits made from the UI must leave the rest of the text
// — comments, order, formatting — exactly as the user wrote it.

describe('parseJsoncObject', () => {
  it('treats empty text as an empty object', () => {
    expect(parseJsoncObject('')).toEqual({ data: {}, problems: [] });
    expect(parseJsoncObject('  \n')).toEqual({ data: {}, problems: [] });
  });

  it('accepts comments and trailing commas', () => {
    const { data, problems } = parseJsoncObject('{\n  // note\n  "a.b": 1,\n}');
    expect(problems).toEqual([]);
    expect(data).toEqual({ 'a.b': 1 });
  });

  it('reports syntax errors with a line number and no data', () => {
    const { data, problems } = parseJsoncObject('{\n  "a.b": 1\n  "c.d": 2\n}');
    expect(data).toBeNull();
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.line).toBe(3);
    expect(problems[0]?.message).toMatch(/line 3/);
  });

  it('rejects a top level that is not an object', () => {
    expect(parseJsoncObject('[1]').data).toBeNull();
    expect(parseJsoncObject('3').data).toBeNull();
    expect(parseJsoncObject('null').problems[0]?.message).toMatch(/single JSON object/);
  });
});

describe('setKeyInText', () => {
  it('creates an object in empty text', () => {
    expect(JSON.parse(setKeyInText('', 'editor.fontSize', 17))).toEqual({ 'editor.fontSize': 17 });
  });

  it('adds and replaces a key while keeping comments and other keys', () => {
    const start = '{\n  // mine\n  "a.b": 1\n}';
    const added = setKeyInText(start, 'c.d', true);
    expect(added).toContain('// mine');
    expect(parseJsoncObject(added).data).toEqual({ 'a.b': 1, 'c.d': true });
    const replaced = setKeyInText(added, 'a.b', 2);
    expect(replaced).toContain('// mine');
    expect(parseJsoncObject(replaced).data).toEqual({ 'a.b': 2, 'c.d': true });
  });

  it('removes a key when the value is undefined, and ignores a missing one', () => {
    const text = '{\n  "a.b": 1,\n  "c.d": 2\n}';
    expect(parseJsoncObject(setKeyInText(text, 'a.b', undefined)).data).toEqual({ 'c.d': 2 });
    expect(setKeyInText(text, 'x.y', undefined)).toBe(text);
  });

  it('treats a dotted key as one property, not a path', () => {
    expect(parseJsoncObject(setKeyInText('{}', 'editor.fontSize', 3)).data).toEqual({ 'editor.fontSize': 3 });
  });
});

describe('positionOf', () => {
  it('maps an offset to a 1-based line and column', () => {
    expect(positionOf('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(positionOf('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/jsonText.test.ts`
Expected: FAIL — `Cannot find module '../jsonText'`.

- [ ] **Step 4: Implement**

```ts
import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type ParseError,
  type ParseErrorCode,
} from 'jsonc-parser';

/**
 * Reading and editing Cord's config files as text. The files are JSONC —
 * comments and trailing commas allowed — and edits touch only the key being
 * changed, so whatever else the user wrote survives.
 */

export interface SettingsProblem {
  /** The setting or binding the problem is about; null for file-level problems. */
  key: string | null;
  severity: 'error' | 'warning';
  message: string;
  /** 1-based line, for syntax errors. */
  line?: number;
}

export interface ParsedObject {
  /** The parsed object, or null when the text is not a valid JSONC object. */
  data: Record<string, unknown> | null;
  problems: SettingsProblem[];
}

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' } as const;

export function positionOf(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function describe(code: ParseErrorCode): string {
  const words = printParseErrorCode(code).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function parseJsoncObject(text: string): ParsedObject {
  if (text.trim() === '') return { data: {}, problems: [] };

  const errors: ParseError[] = [];
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return {
      data: null,
      problems: errors.map((e) => {
        const { line, column } = positionOf(text, e.offset);
        return {
          key: null,
          severity: 'error' as const,
          message: `${describe(e.error)} at line ${line}, column ${column}`,
          line,
        };
      }),
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      data: null,
      problems: [{ key: null, severity: 'error', message: 'The file must contain a single JSON object' }],
    };
  }
  return { data: parsed as Record<string, unknown>, problems: [] };
}

/**
 * `text` with one top-level key set to `value`, or removed when `value` is
 * undefined. Keys are flat — `editor.fontSize` is one property, not a path.
 */
export function setKeyInText(text: string, key: string, value: unknown): string {
  const base = text.trim() === '' ? '{}' : text;
  const edits = modify(base, [key], value, { formattingOptions: FORMATTING });
  if (edits.length === 0) return text.trim() === '' && value === undefined ? text : base;
  return applyEdits(base, edits);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/jsonText.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add package.json ../../pnpm-lock.yaml src/renderer/settings/jsonText.ts src/renderer/settings/__tests__/jsonText.test.ts
git commit -m "Parse and edit JSONC settings text in place"
```

---

### Task 4: schema — declarations, validation, resolution

**Files:**
- Create: `apps/desktop/src/renderer/settings/schema.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { resolveValues, validateDefinition, validateValue, type SettingDefinition } from '../schema';

// One declaration per setting drives validation and defaults. A value that
// fails its declaration must never reach the app: it falls back to the
// default and is reported, and the file itself is left alone.

const size: SettingDefinition = {
  key: 'editor.fontSize', type: 'number', title: 'Font size', description: '', section: 'Editor',
  default: 15, min: 12, max: 20, step: 1,
};
const width: SettingDefinition = {
  key: 'editor.lineWidth', type: 'number', title: 'Line width', description: '', section: 'Editor',
  default: 720, min: 480, max: 1200, step: 40,
};
const spell: SettingDefinition = {
  key: 'editor.spellCheck', type: 'boolean', title: 'Spell check', description: '', section: 'Editor', default: false,
};
const scheme: SettingDefinition = {
  key: 'appearance.colorScheme', type: 'enum', title: 'Color mode', description: '', section: 'Appearance',
  default: 'dark', options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
};
const theme: SettingDefinition = {
  key: 'appearance.theme', type: 'string', title: 'Theme', description: '', section: 'Appearance',
  default: 'mono', pattern: /^[a-z0-9-]+$/, maxLength: 64,
};

describe('validateValue', () => {
  it('checks booleans', () => {
    expect(validateValue(spell, true)).toBeNull();
    expect(validateValue(spell, 'true')).toMatch(/true or false/);
  });

  it('checks number type, range and step', () => {
    expect(validateValue(width, 760)).toBeNull();
    expect(validateValue(width, 'x')).toMatch(/number/);
    expect(validateValue(width, Number.NaN)).toMatch(/number/);
    expect(validateValue(width, 1240)).toMatch(/480–1200/);
    expect(validateValue(width, 500)).toMatch(/steps of 40/);
  });

  it('checks enum membership', () => {
    expect(validateValue(scheme, 'light')).toBeNull();
    expect(validateValue(scheme, 'sepia')).toMatch(/"dark", "light"/);
  });

  it('checks string pattern and length', () => {
    expect(validateValue(theme, 'midnight')).toBeNull();
    expect(validateValue(theme, 'Mid Night')).toMatch(/format/);
    expect(validateValue(theme, 'a'.repeat(65))).toMatch(/64/);
    expect(validateValue(theme, 3)).toMatch(/string/);
  });
});

describe('validateDefinition', () => {
  it('accepts a good declaration', () => {
    expect(() => validateDefinition(size)).not.toThrow();
  });

  it('rejects malformed keys', () => {
    for (const key of ['fontSize', 'Editor.fontSize', 'editor.font-size', 'editor.', '.x']) {
      expect(() => validateDefinition({ ...spell, key })).toThrow(/key/);
    }
  });

  it('rejects a default that fails its own declaration', () => {
    expect(() => validateDefinition({ ...size, default: 30 })).toThrow(/default/);
  });

  it('rejects impossible number bounds and empty enums', () => {
    expect(() => validateDefinition({ ...size, min: 20, max: 12, default: 15 })).toThrow(/min/);
    expect(() => validateDefinition({ ...size, step: 0 })).toThrow(/step/);
    expect(() => validateDefinition({ ...scheme, options: [] })).toThrow(/option/);
  });
});

describe('resolveValues', () => {
  const defs = [size, spell, scheme];

  it('uses defaults for missing keys and file values for valid ones', () => {
    const { values, problems } = resolveValues(defs, { 'editor.fontSize': 17 });
    expect(values).toEqual({ 'editor.fontSize': 17, 'editor.spellCheck': false, 'appearance.colorScheme': 'dark' });
    expect(problems).toEqual([]);
  });

  it('falls back to the default for an invalid value and reports it', () => {
    const { values, problems } = resolveValues(defs, { 'editor.fontSize': 99 });
    expect(values['editor.fontSize']).toBe(15);
    expect(problems).toEqual([expect.objectContaining({ key: 'editor.fontSize', severity: 'error' })]);
  });

  it('keeps unknown keys out of the values and warns about them', () => {
    const { values, problems } = resolveValues(defs, { 'future.option': 1 });
    expect('future.option' in values).toBe(false);
    expect(problems).toEqual([expect.objectContaining({ key: 'future.option', severity: 'warning' })]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/schema.test.ts`
Expected: FAIL — `Cannot find module '../schema'`.

- [ ] **Step 3: Implement**

```ts
import type { ComponentType } from 'react';
import type { SettingsProblem } from './jsonText';

/**
 * Setting declarations. Each option is declared once; its control, search
 * entry, validation and default all derive from the declaration.
 */

/**
 * Every setting's value type, keyed by setting key. Modules that declare
 * settings extend this interface with `declare module` so keys and values
 * are checked at compile time.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SettingValues {}

export type SettingKey = keyof SettingValues & string;

export interface SettingControlProps<T> {
  value: T;
  onChange: (value: T) => void;
  definition: SettingDefinition;
}

interface SettingDefinitionBase<T> {
  /** `section.name`, lowercase camelCase segments: `editor.fontSize`. */
  key: string;
  title: string;
  /** One sentence, shown under the title and matched by search. */
  description: string;
  /** Nav section the setting appears under: `Editor`, `Appearance`, … */
  section: string;
  default: T;
  /** Position within the section, lower first. */
  order?: number;
  /** Extra search terms. */
  keywords?: readonly string[];
  /** Replaces the control derived from the type. */
  control?: ComponentType<SettingControlProps<T>>;
  /**
   * Runs after the user changes the value (from the UI or a setter), never
   * when values are loaded from the file — so it is safe for side effects.
   */
  onUserChange?: (value: T, previous: T) => void;
}

export type BooleanSetting = SettingDefinitionBase<boolean> & { type: 'boolean' };

export type NumberSetting = SettingDefinitionBase<number> & {
  type: 'number';
  min: number;
  max: number;
  step: number;
  /** Shown after the value, e.g. `px`. */
  unit?: string;
  /** Spacing between slider notches when `step` is too fine to mark each one. */
  notchStep?: number;
};

export type StringSetting = SettingDefinitionBase<string> & {
  type: 'string';
  maxLength?: number;
  pattern?: RegExp;
};

export type EnumSetting = SettingDefinitionBase<string> & {
  type: 'enum';
  options: readonly { value: string; label: string }[];
};

export type SettingDefinition = BooleanSetting | NumberSetting | StringSetting | EnumSetting;

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Why `value` is not acceptable for `def`, or null when it is. */
export function validateValue(def: SettingDefinition, value: unknown): string | null {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected true or false';
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected a number';
      if (value < def.min || value > def.max) return `expected ${def.min}–${def.max}`;
      const steps = (value - def.min) / def.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) return `expected steps of ${def.step} from ${def.min}`;
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return 'expected a string';
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        return `expected at most ${def.maxLength} characters`;
      }
      if (def.pattern && !def.pattern.test(value)) return 'invalid format';
      return null;
    case 'enum':
      return typeof value === 'string' && def.options.some((o) => o.value === value)
        ? null
        : `expected one of ${def.options.map((o) => `"${o.value}"`).join(', ')}`;
  }
}

/** Throws when a declaration is malformed, so mistakes fail at startup. */
export function validateDefinition(def: SettingDefinition): void {
  if (!KEY.test(def.key)) {
    throw new Error(`Setting key "${def.key}" must look like "section.name" (lowercase camelCase segments)`);
  }
  if (def.type === 'number') {
    if (!(def.min < def.max)) throw new Error(`${def.key}: min must be below max`);
    if (!(def.step > 0)) throw new Error(`${def.key}: step must be positive`);
  }
  if (def.type === 'enum') {
    if (def.options.length === 0) throw new Error(`${def.key}: an enum needs at least one option`);
    if (new Set(def.options.map((o) => o.value)).size !== def.options.length) {
      throw new Error(`${def.key}: option values must be unique`);
    }
  }
  const error = validateValue(def, def.default);
  if (error) throw new Error(`${def.key}: default is invalid (${error})`);
}

/**
 * Effective values for `defs` given parsed file `data`: valid file values win,
 * everything else falls back to its default. Invalid values and unknown keys
 * are reported, never thrown.
 */
export function resolveValues(
  defs: readonly SettingDefinition[],
  data: Readonly<Record<string, unknown>>,
): { values: Record<string, unknown>; problems: SettingsProblem[] } {
  const values: Record<string, unknown> = {};
  const problems: SettingsProblem[] = [];
  const known = new Set<string>();

  for (const def of defs) {
    known.add(def.key);
    if (!Object.prototype.hasOwnProperty.call(data, def.key)) {
      values[def.key] = def.default;
      continue;
    }
    const error = validateValue(def, data[def.key]);
    if (error) {
      values[def.key] = def.default;
      problems.push({ key: def.key, severity: 'error', message: `${def.key}: ${error}; using the default` });
    } else {
      values[def.key] = data[def.key];
    }
  }

  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      problems.push({ key, severity: 'warning', message: `${key}: unknown setting, kept in the file` });
    }
  }
  return { values, problems };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/schema.test.ts`
Expected: all pass. Then `pnpm typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/schema.ts src/renderer/settings/__tests__/schema.test.ts
git commit -m "Add setting declarations and validation"
```

---

### Task 5: SettingsRegistry

**Files:**
- Create: `apps/desktop/src/renderer/settings/registry.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { registerSetting, settingDefinition, useSettingsRegistry } from '../registry';
import type { SettingDefinition } from '../schema';

const spell: SettingDefinition = {
  key: 'editor.spellCheck', type: 'boolean', title: 'Spell check', description: '', section: 'Editor', default: false,
};

beforeEach(() => useSettingsRegistry.setState({ definitions: [] }));

describe('SettingsRegistry', () => {
  it('registers and looks up a declaration', () => {
    registerSetting(spell);
    expect(settingDefinition('editor.spellCheck')).toBe(spell);
    expect(useSettingsRegistry.getState().definitions).toEqual([spell]);
  });

  it('refuses a duplicate key', () => {
    registerSetting(spell);
    expect(() => registerSetting({ ...spell, title: 'Again' })).toThrow(/already registered/);
  });

  it('refuses a malformed declaration', () => {
    expect(() => registerSetting({ ...spell, key: 'spellcheck' })).toThrow(/key/);
    expect(useSettingsRegistry.getState().definitions).toEqual([]);
  });

  it('returns undefined for an unknown key', () => {
    expect(settingDefinition('nope.nothing')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/registry.test.ts`
Expected: FAIL — `Cannot find module '../registry'`.

- [ ] **Step 3: Implement**

```ts
import { create } from 'zustand';
import { validateDefinition, type SettingDefinition } from './schema';

// Every declared setting. Built-ins register from builtin.ts; a module
// registers its own the same way. Reactive, so a late registration shows up
// in the Settings page and in effective values.

interface SettingsRegistryStore {
  definitions: SettingDefinition[];
  register: (def: SettingDefinition) => void;
}

export const useSettingsRegistry = create<SettingsRegistryStore>((set, get) => ({
  definitions: [],

  register: (def) => {
    validateDefinition(def);
    if (get().definitions.some((d) => d.key === def.key)) {
      throw new Error(`Setting "${def.key}" is already registered`);
    }
    set((s) => ({ definitions: [...s.definitions, def] }));
  },
}));

export function registerSetting(def: SettingDefinition): void {
  useSettingsRegistry.getState().register(def);
}

export function settingDefinition(key: string): SettingDefinition | undefined {
  return useSettingsRegistry.getState().definitions.find((d) => d.key === key);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/registry.test.ts` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/registry.ts src/renderer/settings/__tests__/registry.test.ts
git commit -m "Add the settings registry"
```

---

### Task 6: ConfigFileWriter — debounced, serialised writes

**Files:**
- Create: `apps/desktop/src/renderer/settings/configFile.ts`
- Create: `apps/desktop/src/renderer/settings/ipcConfigIO.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/configFile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { ConfigFileWriter, type ConfigFileIO } from '../configFile';

// Sliders change a setting many times a second. Writes are debounced, never
// overlap, and the last text always wins; a failed write is retried.

function fakeIO(): ConfigFileIO & { writes: string[]; fail: boolean; gate: Promise<void> | null } {
  const io = {
    writes: [] as string[],
    fail: false,
    gate: null as Promise<void> | null,
    read: async () => null,
    write: async (_file: 'settings' | 'keybindings', text: string) => {
      if (io.gate) await io.gate;
      if (io.fail) throw new Error('disk full');
      io.writes.push(text);
    },
  };
  return io;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ConfigFileWriter', () => {
  it('coalesces scheduled writes into the latest text', async () => {
    const io = fakeIO();
    const writer = new ConfigFileWriter('settings', io, 20);
    writer.schedule('a');
    writer.schedule('b');
    writer.schedule('c');
    await sleep(40);
    expect(io.writes).toEqual(['c']);
  });

  it('flush writes immediately and is a no-op with nothing pending', async () => {
    const io = fakeIO();
    const writer = new ConfigFileWriter('settings', io, 10_000);
    writer.schedule('now');
    await writer.flush();
    await writer.flush();
    expect(io.writes).toEqual(['now']);
  });

  it('never runs two writes at once; the newest text lands last', async () => {
    const io = fakeIO();
    let open!: () => void;
    io.gate = new Promise((r) => { open = r; });
    const writer = new ConfigFileWriter('settings', io, 10_000);
    writer.schedule('first');
    const first = writer.flush();
    writer.schedule('second');
    const second = writer.flush();
    io.gate = null;
    open();
    await Promise.all([first, second]);
    expect(io.writes).toEqual(['first', 'second']);
  });

  it('keeps failed text pending, reports the error, and retries on the next flush', async () => {
    const io = fakeIO();
    const errors: unknown[] = [];
    const writer = new ConfigFileWriter('settings', io, 10_000);
    writer.onError = (e) => errors.push(e);
    io.fail = true;
    writer.schedule('x');
    await writer.flush();
    expect(errors).toHaveLength(1);
    io.fail = false;
    await writer.flush();
    expect(io.writes).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/configFile.test.ts`
Expected: FAIL — `Cannot find module '../configFile'`.

- [ ] **Step 3: Implement `configFile.ts`**

```ts
import type { ConfigFileName } from '@shared/types';

export type { ConfigFileName };

/** Raw access to a config file; the sidecar in the app, a fake in tests. */
export interface ConfigFileIO {
  read: (file: ConfigFileName) => Promise<string | null>;
  write: (file: ConfigFileName, text: string) => Promise<void>;
}

/**
 * Writes one config file. `schedule` debounces; `flush` writes now. Writes
 * never overlap and the latest text always wins. A failed write stays pending
 * (unless newer text replaced it) and goes out with the next flush.
 */
export class ConfigFileWriter {
  onError: ((err: unknown) => void) | null = null;
  onSaved: (() => void) | null = null;

  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly file: ConfigFileName,
    private readonly io: ConfigFileIO,
    private readonly delayMs = 300,
  ) {}

  schedule(text: string): void {
    this.pending = text;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight) await this.inFlight;
    const text = this.pending;
    if (text === null) return;
    this.pending = null;

    this.inFlight = this.io.write(this.file, text).then(
      () => { this.onSaved?.(); },
      (err: unknown) => {
        if (this.pending === null) this.pending = text;
        this.onError?.(err);
      },
    ).finally(() => { this.inFlight = null; });
    await this.inFlight;
  }
}
```

- [ ] **Step 4: Implement `ipcConfigIO.ts`**

```ts
import { api } from '../ipc';
import type { ConfigFileIO } from './configFile';

/** Config files through the sidecar. */
export const ipcConfigIO: ConfigFileIO = {
  read: async (file) => (await api.settings.read(file)).text,
  write: async (file, text) => { await api.settings.write(file, text); },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/configFile.test.ts` → 4 pass.
Run: `pnpm typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/settings/configFile.ts src/renderer/settings/ipcConfigIO.ts src/renderer/settings/__tests__/configFile.test.ts
git commit -m "Add a debounced, serialised config file writer"
```

---

### Task 7: The settings store

**Files:**
- Create: `apps/desktop/src/renderer/settings/store.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { createSettingsStore, type SettingsDeps } from '../store';
import type { SettingDefinition } from '../schema';

// The file is the source of truth and the user may have written it by hand.
// UI changes edit it in place; a file that doesn't parse is never overwritten;
// the boot cache only paints the first frame.

const defs: SettingDefinition[] = [
  { key: 'editor.fontSize', type: 'number', title: '', description: '', section: 'Editor', default: 15, min: 12, max: 20, step: 1 },
  { key: 'editor.spellCheck', type: 'boolean', title: '', description: '', section: 'Editor', default: false },
];

function harness(file: string | null, extra: Partial<SettingsDeps> = {}) {
  const disk = { text: file, writes: [] as string[] };
  let cache: string | null = null;
  const store = createSettingsStore({
    io: {
      read: async () => disk.text,
      write: async (_f, text) => { disk.text = text; disk.writes.push(text); },
    },
    definitions: () => defs,
    cache: { read: () => cache, write: (t) => { cache = t; } },
    writeDelayMs: 5,
    ...extra,
  });
  return { store, disk, getCache: () => cache, setCache: (c: string) => { cache = c; } };
}

describe('settings store', () => {
  it('starts from defaults', () => {
    const { store } = harness(null);
    expect(store.getState().values).toEqual({ 'editor.fontSize': 15, 'editor.spellCheck': false });
  });

  it('applies the boot cache synchronously, ignoring garbage', () => {
    const h = harness(null);
    h.setCache('{"editor.fontSize":18}');
    h.store.getState().applyBootCache();
    expect(h.store.getState().values['editor.fontSize']).toBe(18);
    h.setCache('not json');
    h.store.getState().applyBootCache();
    expect(h.store.getState().values['editor.fontSize']).toBe(18);
  });

  it('loads file values and refreshes the cache', async () => {
    const h = harness('{ "editor.fontSize": 17 }');
    await h.store.getState().load();
    expect(h.store.getState().values['editor.fontSize']).toBe(17);
    expect(h.store.getState().loaded).toBe(true);
    expect(JSON.parse(h.getCache()!)).toEqual({ 'editor.fontSize': 17 });
  });

  it('edits the text in place, preserving comments, and removes keys set to default', async () => {
    const h = harness('{\n  // mine\n  "editor.fontSize": 17\n}');
    await h.store.getState().load();
    h.store.getState().set('editor.spellCheck', true);
    await h.store.getState().flush();
    expect(h.disk.text).toContain('// mine');
    expect(h.disk.text).toContain('"editor.spellCheck": true');
    h.store.getState().set('editor.fontSize', 15);
    await h.store.getState().flush();
    expect(h.disk.text).not.toContain('editor.fontSize');
    expect(h.disk.text).toContain('// mine');
  });

  it('throws on unknown keys and invalid values', async () => {
    const { store } = harness(null);
    await store.getState().load();
    expect(() => store.getState().set('nope.nothing', 1)).toThrow(/Unknown setting/);
    expect(() => store.getState().set('editor.fontSize', 99)).toThrow(/Invalid value/);
  });

  it('holds UI edits in memory while the file has a syntax error', async () => {
    const h = harness('{ "editor.fontSize": 17, }}');
    await h.store.getState().load();
    expect(h.store.getState().syntaxError).toBe(true);
    h.store.getState().set('editor.spellCheck', true);
    await h.store.getState().flush();
    expect(h.store.getState().values['editor.spellCheck']).toBe(true);
    expect(h.disk.writes).toEqual([]);
  });

  it('reports invalid values and keeps defaults for them', async () => {
    const h = harness('{ "editor.fontSize": 99, "future.thing": 1 }');
    await h.store.getState().load();
    expect(h.store.getState().values['editor.fontSize']).toBe(15);
    expect(h.store.getState().problems.map((p) => p.severity).sort()).toEqual(['error', 'warning']);
  });

  it('runs onUserChange for set, not for load', async () => {
    const calls: unknown[] = [];
    const watched: SettingDefinition[] = [
      { ...defs[1]!, onUserChange: (v: boolean, p: boolean) => { calls.push([v, p]); } } as SettingDefinition,
    ];
    const h = harness('{ "editor.spellCheck": true }', { definitions: () => watched });
    await h.store.getState().load();
    expect(calls).toEqual([]);
    h.store.getState().set('editor.spellCheck', false);
    expect(calls).toEqual([[false, true]]);
  });

  it('seeds a missing file from migrate and reports success', async () => {
    let migrated = false;
    const h = harness(null, { migrate: () => ({ 'editor.fontSize': 18 }), onMigrated: () => { migrated = true; } });
    await h.store.getState().load();
    expect(JSON.parse(h.disk.text!)).toEqual({ 'editor.fontSize': 18 });
    expect(migrated).toBe(true);
    expect(h.store.getState().values['editor.fontSize']).toBe(18);
  });

  it('does not report migration when the write fails', async () => {
    let migrated = false;
    const store = createSettingsStore({
      io: { read: async () => null, write: async () => { throw new Error('no disk'); } },
      definitions: () => defs,
      cache: { read: () => null, write: () => {} },
      migrate: () => ({ 'editor.fontSize': 18 }),
      onMigrated: () => { migrated = true; },
    });
    await store.getState().load();
    expect(migrated).toBe(false);
    expect(store.getState().values['editor.fontSize']).toBe(18);
    expect(store.getState().saveError).toMatch(/no disk/);
  });

  it('saveText refuses syntax errors and saves valid text immediately', async () => {
    const h = harness('{}');
    await h.store.getState().load();
    const bad = await h.store.getState().saveText('{ "editor.fontSize": }');
    expect(bad[0]?.severity).toBe('error');
    expect(h.disk.writes).toEqual([]);
    await h.store.getState().saveText('{ "editor.fontSize": 19 }');
    expect(h.disk.text).toBe('{ "editor.fontSize": 19 }');
    expect(h.store.getState().values['editor.fontSize']).toBe(19);
  });

  it('reload picks up an external edit', async () => {
    const h = harness('{}');
    await h.store.getState().load();
    h.disk.text = '{ "editor.fontSize": 13 }';
    await h.store.getState().reload();
    expect(h.store.getState().values['editor.fontSize']).toBe(13);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/store.test.ts`
Expected: FAIL — `Cannot find module '../store'`.

- [ ] **Step 3: Implement**

```ts
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { ConfigFileWriter, type ConfigFileIO } from './configFile';
import { parseJsoncObject, setKeyInText, type SettingsProblem } from './jsonText';
import { resolveValues, validateValue, type SettingDefinition } from './schema';

export interface SettingsDeps {
  io: ConfigFileIO;
  definitions: () => readonly SettingDefinition[];
  /** Last good file contents, for painting the first frame before the file loads. */
  cache: { read: () => string | null; write: (text: string) => void };
  /** Values to seed a missing settings.json with (the one-time migration). */
  migrate?: () => Record<string, unknown>;
  /** Called only after the seeded file was written successfully. */
  onMigrated?: () => void;
  writeDelayMs?: number;
}

export interface SettingsState {
  /** Effective value of every declared setting. */
  values: Record<string, unknown>;
  /** The last file contents that parsed. */
  data: Record<string, unknown>;
  /** The file text as last read or written. */
  text: string;
  problems: SettingsProblem[];
  /** The file does not parse: UI edits apply in memory but are not saved. */
  syntaxError: boolean;
  saveError: string | null;
  loaded: boolean;

  applyBootCache: () => void;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  set: (key: string, value: unknown) => void;
  reset: (key: string) => void;
  /** Save text from the JSON view. Returns the problems; syntax errors block the save. */
  saveText: (text: string) => Promise<SettingsProblem[]>;
  refreshDefinitions: () => void;
  flush: () => Promise<void>;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createSettingsStore(deps: SettingsDeps): UseBoundStore<StoreApi<SettingsState>> {
  const writer = new ConfigFileWriter('settings', deps.io, deps.writeDelayMs ?? 300);

  return create<SettingsState>((set, get) => {
    writer.onSaved = () => set({ saveError: null });
    writer.onError = (err) => set({ saveError: `Couldn't save settings: ${message(err)}` });

    function cacheData(data: Record<string, unknown>): void {
      try {
        deps.cache.write(JSON.stringify(data));
      } catch {
        // Storage blocked: the next launch paints defaults for one frame.
      }
    }

    function applyText(text: string): void {
      const parsed = parseJsoncObject(text);
      if (!parsed.data) {
        set({ text, problems: parsed.problems, syntaxError: true });
        return;
      }
      const { values, problems } = resolveValues(deps.definitions(), parsed.data);
      set({ text, data: parsed.data, values, problems, syntaxError: false });
      cacheData(parsed.data);
    }

    function definition(key: string): SettingDefinition {
      const def = deps.definitions().find((d) => d.key === key);
      if (!def) throw new Error(`Unknown setting "${key}"`);
      return def;
    }

    return {
      values: resolveValues(deps.definitions(), {}).values,
      data: {},
      text: '',
      problems: [],
      syntaxError: false,
      saveError: null,
      loaded: false,

      applyBootCache: () => {
        let cached: unknown = null;
        try {
          const raw = deps.cache.read();
          cached = raw ? JSON.parse(raw) : null;
        } catch {
          cached = null;
        }
        if (typeof cached !== 'object' || cached === null || Array.isArray(cached)) return;
        const data = cached as Record<string, unknown>;
        set({ data, values: resolveValues(deps.definitions(), data).values });
      },

      load: async () => {
        let text: string | null;
        try {
          text = await deps.io.read('settings');
        } catch (err) {
          set({ saveError: `Couldn't read settings: ${message(err)}` });
          return;
        }
        if (text === null) {
          const seed = deps.migrate?.() ?? {};
          text = Object.entries(seed).reduce((t, [k, v]) => setKeyInText(t, k, v), '');
          if (Object.keys(seed).length > 0) {
            try {
              await deps.io.write('settings', text);
              deps.onMigrated?.();
            } catch (err) {
              set({ saveError: `Couldn't save settings: ${message(err)}` });
            }
          }
        }
        applyText(text);
        set({ loaded: true });
      },

      reload: async () => {
        if (!get().loaded) return get().load();
        await writer.flush();
        let text: string | null;
        try {
          text = await deps.io.read('settings');
        } catch {
          return;
        }
        if (text !== null && text !== get().text) applyText(text);
      },

      set: (key, value) => {
        const def = definition(key);
        const error = validateValue(def, value);
        if (error) throw new Error(`Invalid value for ${key}: ${error}`);
        const previous = get().values[key];
        if (Object.is(previous, value)) return;
        const values = { ...get().values, [key]: value };

        if (get().syntaxError) {
          // Never overwrite a file the user broke; the banner says so.
          set({ values });
        } else {
          const stored = Object.is(value, def.default) ? undefined : value;
          const text = setKeyInText(get().text, key, stored);
          const data = { ...get().data };
          if (stored === undefined) delete data[key];
          else data[key] = stored;
          const { problems } = resolveValues(deps.definitions(), data);
          set({ values, text, data, problems });
          cacheData(data);
          writer.schedule(text);
        }
        (def.onUserChange as ((v: unknown, p: unknown) => void) | undefined)?.(value, previous);
      },

      reset: (key) => {
        get().set(key, definition(key).default);
      },

      saveText: async (text) => {
        const parsed = parseJsoncObject(text);
        if (!parsed.data) return parsed.problems;
        applyText(text);
        writer.schedule(text);
        await writer.flush();
        return get().problems;
      },

      refreshDefinitions: () => {
        const { values, problems } = resolveValues(deps.definitions(), get().data);
        set(get().syntaxError ? { values } : { values, problems });
      },

      flush: () => writer.flush(),
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/store.test.ts` → all pass.
Run: `pnpm typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/store.ts src/renderer/settings/__tests__/store.test.ts
git commit -m "Add the settings store"
```

---

### Task 8: Legacy migration

**Files:**
- Create: `apps/desktop/src/renderer/settings/migration.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/migration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { clearLegacySettings, readLegacySettings } from '../migration';
import type { SettingDefinition } from '../schema';

// Settings used to live in scattered localStorage keys. They move into the
// first settings.json once; only valid, non-default values are carried over.

const defs: SettingDefinition[] = [
  { key: 'editor.fontSize', type: 'number', title: '', description: '', section: 'Editor', default: 15, min: 12, max: 20, step: 1 },
  { key: 'editor.unlinkedMentions', type: 'boolean', title: '', description: '', section: 'Editor', default: true },
  { key: 'appearance.colorScheme', type: 'enum', title: '', description: '', section: 'Appearance', default: 'dark',
    options: [{ value: 'dark', label: '' }, { value: 'light', label: '' }, { value: 'system', label: '' }] },
  { key: 'appearance.theme', type: 'string', title: '', description: '', section: 'Appearance', default: 'mono', pattern: /^[a-z0-9-]+$/ },
];

function storage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => { map.delete(k); },
  };
}

describe('readLegacySettings', () => {
  it('carries over valid non-default values', () => {
    const s = storage({ 'cord-font-size': '17', 'cord-unlinked-mentions': 'false', 'cord-scheme': 'light', 'cord-theme': 'teal' });
    expect(readLegacySettings(s, defs)).toEqual({
      'editor.fontSize': 17,
      'editor.unlinkedMentions': false,
      'appearance.colorScheme': 'light',
      'appearance.theme': 'teal',
    });
  });

  it('drops defaults, invalid values and missing keys', () => {
    const s = storage({ 'cord-font-size': '15', 'cord-scheme': 'sepia', 'cord-theme': 'Not A Slug' });
    expect(readLegacySettings(s, defs)).toEqual({});
  });
});

describe('clearLegacySettings', () => {
  it('removes every legacy settings key and nothing else', () => {
    const s = storage({ 'cord-font-size': '17', 'cord-theme': 'teal', 'cord-vault-order': '[]' });
    clearLegacySettings(s);
    expect([...s.map.keys()]).toEqual(['cord-vault-order']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/migration.test.ts`
Expected: FAIL — `Cannot find module '../migration'`.

- [ ] **Step 3: Implement**

```ts
import { validateValue, type SettingDefinition } from './schema';

/**
 * The one-time move from the old localStorage keys into the first
 * settings.json. Vault order (`cord-vault-order`) is UI state and stays put.
 */

const LEGACY: Record<string, { storageKey: string; parse: (raw: string) => unknown }> = {
  'editor.fontSize':         { storageKey: 'cord-font-size',             parse: Number },
  'editor.lineWidth':        { storageKey: 'cord-line-width',            parse: Number },
  'editor.spellCheck':       { storageKey: 'cord-spell-check',           parse: (r) => r === 'true' },
  'editor.unlinkedMentions': { storageKey: 'cord-unlinked-mentions',     parse: (r) => r !== 'false' },
  'vaults.distinctColors':   { storageKey: 'cord-distinct-vault-colors', parse: (r) => r === 'true' },
  'appearance.theme':        { storageKey: 'cord-theme',                 parse: (r) => r },
  'appearance.colorScheme':  { storageKey: 'cord-scheme',                parse: (r) => r },
};

/** Keybinding overrides moved into keybindings.json the same way. */
export const LEGACY_KEYBINDINGS_KEY = 'cord-keybindings';

export function readLegacySettings(
  storage: Pick<Storage, 'getItem'>,
  defs: readonly SettingDefinition[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, { storageKey, parse }] of Object.entries(LEGACY)) {
    const raw = storage.getItem(storageKey);
    const def = defs.find((d) => d.key === key);
    if (raw === null || !def) continue;
    const value = parse(raw);
    if (validateValue(def, value) === null && !Object.is(value, def.default)) out[key] = value;
  }
  return out;
}

export function clearLegacySettings(storage: Pick<Storage, 'removeItem'>): void {
  for (const { storageKey } of Object.values(LEGACY)) storage.removeItem(storageKey);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/migration.test.ts` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/migration.ts src/renderer/settings/__tests__/migration.test.ts
git commit -m "Migrate legacy localStorage settings once"
```

---

### Task 9: App wiring — store instance, built-ins, boot, consumers

This task replaces `store/settings.ts`. Nothing new is tested here beyond what Tasks 3–8 cover; the gate is typecheck + the full suite + build.

**Files:**
- Create: `apps/desktop/src/renderer/settings/index.ts`, `builtin.ts`, `boot.ts`
- Modify: `apps/desktop/src/renderer/main.tsx`, `App.tsx`, `components/Editor.tsx:13,68,326`, `components/VaultSidebar.tsx:8,42`, `components/SettingsPage.tsx:6,244-246,256-262,275-318,463`
- Delete: `apps/desktop/src/renderer/store/settings.ts`; remove `AppSettings` from `apps/desktop/src/shared/types/index.ts:227-234`

- [ ] **Step 1: Create `settings/index.ts`**

```ts
import { ipcConfigIO } from './ipcConfigIO';
import { clearLegacySettings, readLegacySettings } from './migration';
import { settingDefinition, useSettingsRegistry } from './registry';
import type { SettingKey, SettingValues } from './schema';
import { createSettingsStore } from './store';

export type { SettingKey, SettingValues } from './schema';
export { registerSetting, settingDefinition, useSettingsRegistry } from './registry';

const CACHE_KEY = 'cord-settings-cache';

/** The app's settings. File-backed through the sidecar. */
export const useSettings = createSettingsStore({
  io: ipcConfigIO,
  definitions: () => useSettingsRegistry.getState().definitions,
  cache: {
    read: () => localStorage.getItem(CACHE_KEY),
    write: (text) => localStorage.setItem(CACHE_KEY, text),
  },
  migrate: () => readLegacySettings(localStorage, useSettingsRegistry.getState().definitions),
  onMigrated: () => clearLegacySettings(localStorage),
});

// A module that registers late gets its values resolved from the file too.
useSettingsRegistry.subscribe(() => useSettings.getState().refreshDefinitions());

export function useSetting<K extends SettingKey>(key: K): SettingValues[K] {
  return useSettings((s) => s.values[key]) as SettingValues[K];
}

export function getSetting<K extends SettingKey>(key: K): SettingValues[K] {
  return useSettings.getState().values[key] as SettingValues[K];
}

export function setSetting<K extends SettingKey>(key: K, value: SettingValues[K]): void {
  useSettings.getState().set(key, value);
}

export function resetSetting(key: SettingKey): void {
  useSettings.getState().reset(key);
}

/**
 * `n` clamped to a number setting's range and rounded to its step — for
 * values that come from a drag rather than from the setting's own control.
 */
export function snapToSetting(key: SettingKey, n: number): number {
  const def = settingDefinition(key);
  if (def?.type !== 'number') return n;
  const clamped = Math.min(def.max, Math.max(def.min, n));
  return def.min + Math.round((clamped - def.min) / def.step) * def.step;
}
```

- [ ] **Step 2: Create `settings/builtin.ts`**

The two custom controls are created in Task 13; to keep this task compiling, declare the settings without `control` now and add the `control` fields in Task 13.

```ts
import { log } from '../lib/log';
import { useVaultStore } from '../store/vaults';
import { registerSetting, useSettings } from './index';
import type { SettingValues } from './schema';

declare module './schema' {
  interface SettingValues {
    'editor.fontSize': number;
    'editor.lineWidth': number;
    'editor.spellCheck': boolean;
    'editor.unlinkedMentions': boolean;
    'vaults.distinctColors': boolean;
    'appearance.theme': string;
    'appearance.colorScheme': 'dark' | 'light' | 'system';
  }
}

registerSetting({
  key: 'editor.fontSize', type: 'number', section: 'Editor', order: 10,
  title: 'Font size', description: 'Text size in the editor.',
  default: 15, min: 12, max: 20, step: 1, unit: 'px', keywords: ['zoom', 'text size'],
});

registerSetting({
  key: 'editor.lineWidth', type: 'number', section: 'Editor', order: 20,
  title: 'Line width', description: 'Maximum width of a line of text in the editor.',
  default: 720, min: 480, max: 1200, step: 40, notchStep: 120, unit: 'px', keywords: ['margin', 'column'],
});

registerSetting({
  key: 'editor.spellCheck', type: 'boolean', section: 'Editor', order: 30,
  title: 'Spell check', description: 'Underline misspelled words. Takes effect after a restart.',
  default: false,
});

registerSetting({
  key: 'editor.unlinkedMentions', type: 'boolean', section: 'Editor', order: 40,
  title: 'Unlinked mentions', description: 'Show notes that mention this note’s title without linking to it.',
  default: true, keywords: ['backlinks'],
});

registerSetting({
  key: 'appearance.colorScheme', type: 'enum', section: 'Appearance', order: 10,
  title: 'Color mode', description: 'Dark, light, or follow the system setting.',
  default: 'dark',
  options: [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ],
  keywords: ['dark mode', 'light mode', 'scheme'],
});

registerSetting({
  key: 'appearance.theme', type: 'string', section: 'Appearance', order: 20,
  title: 'Theme', description: 'Colour palette for the whole app.',
  default: 'mono', pattern: /^[a-z0-9][a-z0-9-]{0,63}$/, maxLength: 64, keywords: ['colors', 'palette'],
});

registerSetting({
  key: 'vaults.distinctColors', type: 'boolean', section: 'Vaults', order: 10,
  title: 'Use distinct vault colors',
  description: 'Limit the palette to a curated set of high-contrast hues, and repaint existing vaults with their nearest match.',
  default: false,
  // Turning it on is not just a filter on the picker — it repaints the vaults
  // you already have. A rail where half the dots come from the curated set and
  // half don't defeats the point of the setting.
  onUserChange: (on) => {
    if (!on) return;
    useVaultStore.getState().applyDistinctColors().catch((err: unknown) => {
      log('error', 'settings', 'Failed to remap vault colors', err);
    });
  },
});

// ── Effects ──────────────────────────────────────────────────────────────────

function applyEditorVars(values: Record<string, unknown>): void {
  const root = document.documentElement;
  root.style.setProperty('--editor-font-size', `${values['editor.fontSize'] as SettingValues['editor.fontSize']}px`);
  root.style.setProperty('--editor-line-width', `${values['editor.lineWidth'] as SettingValues['editor.lineWidth']}px`);
}

applyEditorVars(useSettings.getState().values);
useSettings.subscribe((s, prev) => {
  if (s.values !== prev.values) applyEditorVars(s.values);
});
```

- [ ] **Step 3: Create `settings/boot.ts`**

```ts
import { useThemeStore } from '../store/theme';
import { useSettings } from './index';

/**
 * Startup: paint the first frame from the boot cache, then load the real
 * files. Re-read them whenever the window regains focus, since there is no
 * filesystem watcher and the user may have edited them in another editor.
 */
export function bootSettings(): void {
  useSettings.getState().applyBootCache();
  useThemeStore.getState().init();
  void useSettings.getState().load();

  window.addEventListener('focus', () => {
    void useSettings.getState().reload();
  });
}
```

- [ ] **Step 4: Call it from `main.tsx` before rendering**

Replace the top of `apps/desktop/src/renderer/main.tsx` so it reads:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './settings/builtin';
import { bootSettings } from './settings/boot';
import './styles/global.css';
import 'shuttle-editor/styles.css';
import './styles/shuttle-theme.css';

bootSettings();

const root = document.getElementById('root');
```

(the rest of the file is unchanged).

- [ ] **Step 5: Remove the old boot calls from `App.tsx`**

Delete the imports `import { useSettingsStore } from './store/settings';` and `import { useThemeStore } from './store/theme';`, and delete these two lines from the mount effect:

```ts
    useSettingsStore.getState().load();
    useThemeStore.getState().init();
```

- [ ] **Step 6: Switch the consumers**

`components/Editor.tsx`:
- replace `import { useSettingsStore } from '../store/settings';` with `import { setSetting, snapToSetting, useSetting } from '../settings';`
- replace line 68 (`const { unlinkedMentions: mentionsEnabled, spellCheck, editorLineWidth, update: updateSettings } = useSettingsStore();`) with:

```ts
  const mentionsEnabled = useSetting('editor.unlinkedMentions');
  const spellCheck = useSetting('editor.spellCheck');
  const editorLineWidth = useSetting('editor.lineWidth');
```

- replace `onLineWidthChange={(w: number) => { void updateSettings({ editorLineWidth: w }); }}` with:

```tsx
          onLineWidthChange={(w: number) => setSetting('editor.lineWidth', snapToSetting('editor.lineWidth', w))}
```

`components/VaultSidebar.tsx`:
- replace `import { useSettingsStore } from '../store/settings';` with `import { useSetting } from '../settings';`
- replace `const distinctVaultColors = useSettingsStore((s) => s.distinctVaultColors);` with `const distinctVaultColors = useSetting('vaults.distinctColors');`

`components/SettingsPage.tsx` (temporary — fully rewritten in Task 13):
- replace `import { useSettingsStore } from '../store/settings';` with `import { setSetting, useSetting } from '../settings';`
- in `EditorChapter`, replace the `useSettingsStore()` destructure and `handleDistinctToggle` with:

```tsx
  const editorFontSize = useSetting('editor.fontSize');
  const editorLineWidth = useSetting('editor.lineWidth');
  const spellCheck = useSetting('editor.spellCheck');
  const distinctVaultColors = useSetting('vaults.distinctColors');
```

  and delete the `applyDistinctColors` line (the remap now lives in the setting's `onUserChange`).
- in the same chapter replace `update({ editorFontSize: v })` → `setSetting('editor.fontSize', v)`, `update({ editorLineWidth: v })` → `setSetting('editor.lineWidth', v)`, `update({ spellCheck: v })` → `setSetting('editor.spellCheck', v)`, and `onChange={handleDistinctToggle}` → `onChange={(v) => setSetting('vaults.distinctColors', v)}`.
- in `VaultChapter` replace `useSettingsStore((s) => s.distinctVaultColors)` with `useSetting('vaults.distinctColors')`.

- [ ] **Step 7: Delete the old store and type**

Run: `git rm src/renderer/store/settings.ts`
Remove the `AppSettings` interface (and its doc comment) from `src/shared/types/index.ts`.

- [ ] **Step 8: Verify**

Run: `pnpm typecheck` → no errors. `grep -rn "useSettingsStore\|AppSettings" src` → no matches.
Run: `CORD_DB_PATH=:memory: bun test src` → all pass.
Run: `pnpm build:renderer` → `✓ built`.

- [ ] **Step 9: Commit**

```bash
git add -A src/renderer src/shared/types/index.ts
git commit -m "Back the app's settings with the schema and settings.json"
```

---

### Task 10: Theme store reads from settings

**Files:**
- Modify: `apps/desktop/src/renderer/store/theme.ts` (full replacement)
- Modify: `apps/desktop/src/renderer/store/__tests__/theme.test.ts` (full replacement)

- [ ] **Step 1: Rewrite the test first**

```ts
import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Theme and colour mode are settings now. The theme store still owns which
// theme is actually shown: a saved augment theme shows the default until its
// augment registers, and the saved choice is never overwritten by the fallback.

const attrs = new Map<string, string>();
Object.assign(globalThis, {
  document: { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), style: { setProperty: () => {} } } },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  window: { matchMedia: () => ({ matches: true, onchange: null }), addEventListener: () => {} },
});

mock.module('@renderer/ipc', () => ({
  api: { settings: { read: async () => ({ text: null }), write: async () => ({ ok: true }) } },
}));

const { registerSetting, useSettings, setSetting, getSetting } = await import('../../settings');
const { useThemeStore } = await import('../theme');
const { useThemeRegistry, BUILTIN_THEMES } = await import('../../registry/ThemeRegistry');

registerSetting({
  key: 'appearance.theme', type: 'string', title: '', description: '', section: 'Appearance',
  default: 'mono', pattern: /^[a-z0-9][a-z0-9-]{0,63}$/,
});
registerSetting({
  key: 'appearance.colorScheme', type: 'enum', title: '', description: '', section: 'Appearance', default: 'dark',
  options: [{ value: 'dark', label: '' }, { value: 'light', label: '' }, { value: 'system', label: '' }],
});

const augment = { id: 'dithered', label: 'Dithered', description: '', source: 'augment' as const };

beforeEach(() => {
  attrs.clear();
  useThemeRegistry.setState({ themes: [...BUILTIN_THEMES] });
  useSettings.setState({ values: { 'appearance.theme': 'mono', 'appearance.colorScheme': 'dark' }, data: {}, text: '', syntaxError: false });
  useThemeStore.getState().init();
});

describe('theme store', () => {
  it('applies the theme setting', () => {
    setSetting('appearance.theme', 'olive');
    expect(attrs.get('data-theme')).toBe('olive');
    expect(useThemeStore.getState().theme).toBe('olive');
  });

  it('setTheme and setColorScheme write the settings', () => {
    useThemeStore.getState().setTheme('teal');
    useThemeStore.getState().setColorScheme('light');
    expect(getSetting('appearance.theme')).toBe('teal');
    expect(getSetting('appearance.colorScheme')).toBe('light');
    expect(attrs.get('data-scheme')).toBe('light');
  });

  it('shows the default until a saved augment theme registers, then switches', () => {
    setSetting('appearance.theme', 'dithered');
    expect(attrs.get('data-theme')).toBe('mono');
    expect(useThemeStore.getState().theme).toBe('dithered');
    useThemeRegistry.getState().register(augment);
    expect(attrs.get('data-theme')).toBe('dithered');
  });

  it('falls back when the active augment theme is unregistered, keeping the setting', () => {
    useThemeRegistry.getState().register(augment);
    setSetting('appearance.theme', 'dithered');
    useThemeRegistry.getState().unregister('dithered');
    expect(attrs.get('data-theme')).toBe('mono');
    expect(getSetting('appearance.theme')).toBe('dithered');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/store/__tests__/theme.test.ts`
Expected: FAIL — the current store reads localStorage, so `setSetting` does not change `data-theme`.

- [ ] **Step 3: Replace `store/theme.ts`**

```ts
import { create } from 'zustand';
import { DEFAULT_THEME_ID, resolveThemeId, useThemeRegistry } from '../registry/ThemeRegistry';
import { getSetting, setSetting, useSettings } from '../settings';

export type ColorScheme = 'dark' | 'light' | 'system';

interface ThemeStore {
  /** The saved choice (the `appearance.theme` setting), even while unavailable. */
  theme:       string;
  /** What is actually applied: `theme` if registered, otherwise the default. */
  activeTheme: string;
  colorScheme: ColorScheme;
  setTheme:       (id: string)     => void;
  setColorScheme: (s: ColorScheme) => void;
  init:        () => void;
}

export function resolveScheme(scheme: ColorScheme): 'dark' | 'light' {
  if (scheme !== 'system') return scheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(themeId: string, scheme: ColorScheme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);
  root.setAttribute('data-scheme', resolveScheme(scheme));
}

let systemQuery: MediaQueryList | null = null;

function watchSystemScheme(scheme: ColorScheme): void {
  if (systemQuery) systemQuery.onchange = null;
  systemQuery = null;
  if (scheme !== 'system') return;
  systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemQuery.onchange = () => apply(useThemeStore.getState().activeTheme, 'system');
}

let applied = false;

/** Bring the store and the document in line with the settings and registry. */
function sync(): void {
  const theme = getSetting('appearance.theme');
  const colorScheme = getSetting('appearance.colorScheme');
  const activeTheme = resolveThemeId(theme, useThemeRegistry.getState().themes);
  const current = useThemeStore.getState();
  if (applied && current.theme === theme && current.activeTheme === activeTheme && current.colorScheme === colorScheme) {
    return;
  }
  applied = true;
  useThemeStore.setState({ theme, activeTheme, colorScheme });
  apply(activeTheme, colorScheme);
  watchSystemScheme(colorScheme);
}

export const useThemeStore = create<ThemeStore>(() => ({
  theme:       DEFAULT_THEME_ID,
  activeTheme: DEFAULT_THEME_ID,
  colorScheme: 'dark',

  setTheme:       (id) => setSetting('appearance.theme', id),
  setColorScheme: (scheme) => setSetting('appearance.colorScheme', scheme),

  init: () => {
    applied = false;
    sync();
  },
}));

// Settings change when the file loads or the user picks a theme; the registry
// changes when augments register their themes after startup.
useSettings.subscribe(sync);
useThemeRegistry.subscribe(sync);
```

- [ ] **Step 4: Verify**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/store/__tests__/theme.test.ts` → 4 pass.
Run: `CORD_DB_PATH=:memory: bun test src` → all pass. `pnpm typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store/theme.ts src/renderer/store/__tests__/theme.test.ts
git commit -m "Read the theme and colour mode from settings"
```

---

### Task 11: Keybindings persist to keybindings.json

**Files:**
- Modify: `apps/desktop/src/renderer/store/keybindings.ts` (persistence section, lines ~31–215)
- Modify: `apps/desktop/src/renderer/settings/boot.ts`
- Test: `apps/desktop/src/renderer/store/__tests__/keybindings.test.ts` (add a block)

- [ ] **Step 1: Add failing tests**

At the top of `keybindings.test.ts`, after the existing imports, add the IPC mock and a disk fake:

```ts
import { mock } from 'bun:test';

const disk: { text: string | null; writes: string[] } = { text: null, writes: [] };
mock.module('@renderer/ipc', () => ({
  api: {
    settings: {
      read: async () => ({ text: disk.text }),
      write: async (_file: string, text: string) => { disk.text = text; disk.writes.push(text); return { ok: true }; },
    },
  },
}));
```

and append this block at the end of the file:

```ts
describe('keybindings.json', () => {
  // Earlier tests leave debounced writes pending; land them before resetting
  // the fake disk so they cannot leak into these assertions.
  beforeEach(async () => { await flushKeybindings(); disk.text = null; disk.writes = []; });

  it('loads overrides from the file, comments allowed', async () => {
    disk.text = '{\n  // mine\n  "app.newNote": "Mod+J",\n}';
    await useKeybindingStore.getState().load();
    expect(useKeybindingStore.getState().bindings['app.newNote']).toBe('Mod+J');
  });

  it('edits the file in place, keeping comments and unknown keys', async () => {
    disk.text = '{\n  // mine\n  "app.newNote": "Mod+J",\n  "future.action": "Mod+Q"\n}';
    await useKeybindingStore.getState().load();
    useKeybindingStore.getState().setBinding('app.settings', 'Mod+Shift+K');
    await flushKeybindings();
    expect(disk.text).toContain('// mine');
    expect(disk.text).toContain('"future.action": "Mod+Q"');
    expect(disk.text).toContain('"app.settings": "Mod+Shift+K"');
  });

  it('never overwrites a file that does not parse', async () => {
    disk.text = '{ "app.newNote": ';
    await useKeybindingStore.getState().load();
    expect(useKeybindingStore.getState().fileError).toMatch(/line 1/);
    useKeybindingStore.getState().setBinding('app.settings', 'Mod+Shift+K');
    await flushKeybindings();
    expect(disk.writes).toEqual([]);
  });
});
```

Add `flushKeybindings` to the existing import list from `'../keybindings'`, and make sure `beforeEach` is imported from `bun:test`.

- [ ] **Step 2: Run them to verify they fail**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/store/__tests__/keybindings.test.ts`
Expected: FAIL — `flushKeybindings` is not exported; `load` does not read the file.

- [ ] **Step 3: Change persistence in `store/keybindings.ts`**

Add imports at the top:

```ts
import { ConfigFileWriter } from '../settings/configFile';
import { ipcConfigIO } from '../settings/ipcConfigIO';
import { parseJsoncObject, setKeyInText } from '../settings/jsonText';
import { LEGACY_KEYBINDINGS_KEY } from '../settings/migration';
```

Delete `const STORAGE_KEY = 'cord-keybindings';`.

In the `KeybindingStore` interface, change `load: () => void;` to:

```ts
  /** Why keybindings.json could not be used, or null. Writes are held while set. */
  fileError: string | null;
  load: () => Promise<void>;
  reload: () => Promise<void>;
```

Replace the functions `persist`, `parseOverrides` and `readOverrides` with:

```ts
const writer = new ConfigFileWriter('keybindings', ipcConfigIO);
/** keybindings.json as last read or written; edits are applied to this text. */
let fileText = '';

/** Overrides from parsed file data. Unknown ids and non-strings are dropped. */
function overridesFrom(data: Record<string, unknown>): Partial<KeybindingMap> {
  const out: Partial<KeybindingMap> = {};
  for (const [id, accel] of Object.entries(data)) {
    if (typeof accel === 'string' && BY_ID.has(id as KeybindingId)) out[id as KeybindingId] = accel;
  }
  return out;
}

/**
 * Overrides from stored text. Anything unparseable yields none, so a corrupt
 * or outdated entry never breaks the shortcuts that are still valid.
 */
export function parseOverrides(raw: string | null): Partial<KeybindingMap> {
  if (!raw) return {};
  const { data } = parseJsoncObject(raw);
  return data ? overridesFrom(data) : {};
}

function persist(bindings: KeybindingMap): void {
  // Never overwrite a file the user broke; Settings shows the error.
  if (useKeybindingStore.getState().fileError) return;
  // Only overrides are written, so changing a default later reaches users who
  // never touched that binding. Each key is edited in place, so comments and
  // ids this version does not know survive.
  let text = fileText;
  for (const def of KEYBINDINGS) {
    const current = bindings[def.id];
    text = setKeyInText(text, def.id, current !== def.defaultAccel ? current : undefined);
  }
  fileText = text;
  writer.schedule(text);
}

/** Write any pending keybinding change now. */
export function flushKeybindings(): Promise<void> {
  return writer.flush();
}

function legacyOverrides(): Partial<KeybindingMap> {
  try {
    return parseOverrides(localStorage.getItem(LEGACY_KEYBINDINGS_KEY));
  } catch {
    return {};
  }
}
```

Replace the store's first two members (`bindings: …` and `load: …`) with:

```ts
  bindings: defaultMap(),
  fileError: null,

  load: async () => {
    let text: string | null;
    try {
      text = await ipcConfigIO.read('keybindings');
    } catch (err) {
      set({ fileError: `Couldn't read keybindings: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (text === null) {
      const legacy = legacyOverrides();
      text = Object.entries(legacy).reduce((t, [id, accel]) => setKeyInText(t, id, accel), '');
      if (Object.keys(legacy).length > 0) {
        try {
          await ipcConfigIO.write('keybindings', text);
          localStorage.removeItem(LEGACY_KEYBINDINGS_KEY);
        } catch {
          // Keep the legacy key; the move is retried next launch.
        }
      }
    }
    fileText = text;
    const parsed = parseJsoncObject(text);
    if (!parsed.data) {
      set({ fileError: `keybindings.json: ${parsed.problems.map((p) => p.message).join('; ')}` });
      return;
    }
    set({ bindings: { ...defaultMap(), ...overridesFrom(parsed.data) }, fileError: null });
  },

  reload: async () => {
    await writer.flush();
    await get().load();
  },
```

(`setBinding`, `clearBinding`, `resetBinding`, `resetAll` stay as they are — they already call `persist(next)`.)

- [ ] **Step 4: Load keybindings at boot**

In `settings/boot.ts` add `import { useKeybindingStore } from '../store/keybindings';`, add `void useKeybindingStore.getState().load();` after `void useSettings.getState().load();`, and inside the focus listener add `void useKeybindingStore.getState().reload();`.

- [ ] **Step 5: Verify**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/store/__tests__/keybindings.test.ts` → all pass (old and new).
Run: `grep -rn "useKeybindingStore.getState().load()\|\.load()" src/renderer --include=*.tsx` and fix any remaining synchronous caller of the old `load` (expected: none outside boot).
Run: `CORD_DB_PATH=:memory: bun test src` → all pass. `pnpm typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store/keybindings.ts src/renderer/store/__tests__/keybindings.test.ts src/renderer/settings/boot.ts
git commit -m "Store keybinding overrides in keybindings.json"
```

---

### Task 12: Settings search

**Files:**
- Create: `apps/desktop/src/renderer/settings/search.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { filterSettings, modifiedKeys } from '../search';
import type { SettingDefinition } from '../schema';

const defs: SettingDefinition[] = [
  { key: 'editor.fontSize', type: 'number', title: 'Font size', description: 'Text size in the editor.', section: 'Editor', default: 15, min: 12, max: 20, step: 1, keywords: ['zoom'] },
  { key: 'editor.spellCheck', type: 'boolean', title: 'Spell check', description: 'Underline misspelled words.', section: 'Editor', default: false },
  { key: 'appearance.theme', type: 'string', title: 'Theme', description: 'Colour palette.', section: 'Appearance', default: 'mono' },
];

const keys = (d: SettingDefinition[]) => d.map((x) => x.key);

describe('filterSettings', () => {
  it('returns everything for an empty query', () => {
    expect(keys(filterSettings(defs, '  ', new Set()))).toEqual(keys(defs));
  });

  it('matches title, description, key, section and keywords, case-insensitively', () => {
    expect(keys(filterSettings(defs, 'SPELL', new Set()))).toEqual(['editor.spellCheck']);
    expect(keys(filterSettings(defs, 'misspelled', new Set()))).toEqual(['editor.spellCheck']);
    expect(keys(filterSettings(defs, 'appearance.theme', new Set()))).toEqual(['appearance.theme']);
    expect(keys(filterSettings(defs, 'zoom', new Set()))).toEqual(['editor.fontSize']);
    expect(keys(filterSettings(defs, 'editor', new Set()))).toEqual(['editor.fontSize', 'editor.spellCheck']);
  });

  it('requires every word to match', () => {
    expect(keys(filterSettings(defs, 'editor size', new Set()))).toEqual(['editor.fontSize']);
  });

  it('@modified filters to changed settings, alone or with words', () => {
    const changed = new Set(['editor.fontSize', 'appearance.theme']);
    expect(keys(filterSettings(defs, '@modified', changed))).toEqual(['editor.fontSize', 'appearance.theme']);
    expect(keys(filterSettings(defs, '@modified theme', changed))).toEqual(['appearance.theme']);
  });
});

describe('modifiedKeys', () => {
  it('lists settings whose value differs from the default', () => {
    expect([...modifiedKeys(defs, { 'editor.fontSize': 17, 'editor.spellCheck': false, 'appearance.theme': 'mono' })])
      .toEqual(['editor.fontSize']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/search.test.ts`
Expected: FAIL — `Cannot find module '../search'`.

- [ ] **Step 3: Implement**

```ts
import type { SettingDefinition } from './schema';

export const MODIFIED_FILTER = '@modified';

function haystack(def: SettingDefinition): string {
  return [def.title, def.description, def.key, def.section, ...(def.keywords ?? [])].join(' ').toLowerCase();
}

/**
 * Settings matching `query`: every word must appear in the title, description,
 * key, section or keywords. `@modified` limits the result to changed settings.
 */
export function filterSettings(
  defs: readonly SettingDefinition[],
  query: string,
  modified: ReadonlySet<string>,
): SettingDefinition[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const onlyModified = tokens.includes(MODIFIED_FILTER);
  const words = tokens.filter((t) => t !== MODIFIED_FILTER);
  return defs.filter((def) => {
    if (onlyModified && !modified.has(def.key)) return false;
    const text = haystack(def);
    return words.every((w) => text.includes(w));
  });
}

export function modifiedKeys(
  defs: readonly SettingDefinition[],
  values: Readonly<Record<string, unknown>>,
): Set<string> {
  return new Set(defs.filter((d) => !Object.is(values[d.key], d.default)).map((d) => d.key));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/search.test.ts` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/search.ts src/renderer/settings/__tests__/search.test.ts
git commit -m "Add settings search"
```

---

### Task 13: The generated Settings page

The UI has no DOM test harness in this repo; the gates are typecheck, build, the full suite, and a manual check in `pnpm dev` (Step 12).

**Files:**
- Create: `apps/desktop/src/renderer/components/settings/controls.tsx`, `SettingRow.tsx`, `ThemePickerControl.tsx`, `FontSizeControl.tsx`, `KeyboardPage.tsx`, `VaultPage.tsx`, `TagsPage.tsx`, `pages.ts`
- Modify: `apps/desktop/src/renderer/settings/builtin.ts` (add `control` fields)
- Rewrite: `apps/desktop/src/renderer/components/SettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/components/SettingsPage.module.css` (append)

- [ ] **Step 1: `components/settings/controls.tsx`**

```tsx
import type { ComponentType } from 'react';
import { StepSlider } from '../StepSlider';
import type { SettingControlProps, SettingDefinition } from '../../settings/schema';
import styles from '../SettingsPage.module.css';

// Default controls, chosen from a setting's type. A declaration can replace
// its control with `control`.

export function ToggleControl({ value, onChange, definition }: SettingControlProps<boolean>) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={definition.title}
      className={`${styles.toggle} ${value ? styles.toggleOn : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className={styles.toggleThumb} />
    </button>
  );
}

export function SliderControl({ value, onChange, definition }: SettingControlProps<number>) {
  if (definition.type !== 'number') return null;
  return (
    <div className={styles.sliderRow}>
      <StepSlider
        label={definition.title}
        min={definition.min}
        max={definition.max}
        step={definition.step}
        notchStep={definition.notchStep}
        value={value}
        onChange={onChange}
      />
      <span className={styles.sliderValue}>{value}{definition.unit ?? ''}</span>
    </div>
  );
}

export function SegmentedControl({ value, onChange, definition }: SettingControlProps<string>) {
  if (definition.type !== 'enum') return null;
  return (
    <div className={styles.schemeRow} role="radiogroup" aria-label={definition.title}>
      {definition.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={`${styles.schemeBtn} ${value === o.value ? styles.schemeBtnActive : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SelectControl({ value, onChange, definition }: SettingControlProps<string>) {
  if (definition.type !== 'enum') return null;
  return (
    <select
      className={styles.selectInput}
      aria-label={definition.title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {definition.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function TextControl({ value, onChange, definition }: SettingControlProps<string>) {
  return (
    <input
      className={styles.textInput}
      aria-label={definition.title}
      value={value}
      maxLength={definition.type === 'string' ? definition.maxLength : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** The control for a declaration: its own `control`, else one derived from its type. */
// The union of per-type prop types cannot be expressed as one ComponentType, so
// callers pass the matching value; SettingRow is the only caller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function controlFor(def: SettingDefinition): ComponentType<SettingControlProps<any>> {
  if (def.control) return def.control as ComponentType<SettingControlProps<unknown>>;
  switch (def.type) {
    case 'boolean': return ToggleControl;
    case 'number':  return SliderControl;
    case 'enum':    return def.options.length <= 4 ? SegmentedControl : SelectControl;
    case 'string':  return TextControl;
  }
}
```

- [ ] **Step 2: `components/settings/SettingRow.tsx`**

```tsx
import { RotateCcw } from 'lucide-react';
import { useSettings } from '../../settings';
import type { SettingDefinition } from '../../settings/schema';
import { controlFor } from './controls';
import styles from '../SettingsPage.module.css';

// One setting: title, description, control. A changed setting shows a marker
// and a reset button; the key is shown on hover so it can be found in the JSON.

export function SettingRow({ definition }: { definition: SettingDefinition }) {
  const value = useSettings((s) => s.values[definition.key]);
  const set = useSettings((s) => s.set);
  const reset = useSettings((s) => s.reset);
  const modified = !Object.is(value, definition.default);
  const Control = controlFor(definition);
  const inline = definition.type === 'boolean' && !definition.control;

  return (
    <div
      className={`${styles.field} ${styles.settingRow} cord-settings__field ${modified ? `${styles.settingModified} cord-settings__field--modified` : ''}`}
      data-setting={definition.key}
    >
      <div className={inline ? styles.toggleRow : styles.settingHead}>
        <div>
          <div className={styles.fieldLabel}>
            {definition.title}
            <code className={styles.settingKey} title="Setting key in settings.json">{definition.key}</code>
          </div>
          <div className={styles.fieldHint}>{definition.description}</div>
        </div>
        <div className={styles.settingActions}>
          {modified && (
            <button
              className={styles.keyReset}
              onClick={() => reset(definition.key)}
              title="Reset to default"
              aria-label={`Reset ${definition.title} to default`}
            >
              <RotateCcw size={13} strokeWidth={1.75} />
            </button>
          )}
          {inline && <Control value={value} onChange={(v: unknown) => set(definition.key, v)} definition={definition} />}
        </div>
      </div>
      {!inline && <Control value={value} onChange={(v: unknown) => set(definition.key, v)} definition={definition} />}
    </div>
  );
}
```

- [ ] **Step 3: `components/settings/ThemePickerControl.tsx`**

Moves the theme grid out of the old `AppearanceChapter` unchanged in behaviour; the selected card follows `activeTheme` (what is shown), and picking a card writes the setting.

```tsx
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useThemeRegistry } from '../../registry/ThemeRegistry';
import { resolveScheme, useThemeStore } from '../../store/theme';
import type { SettingControlProps } from '../../settings/schema';
import styles from '../SettingsPage.module.css';

export function ThemePickerControl({ onChange }: SettingControlProps<string>) {
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const themes = useThemeRegistry((s) => s.themes);
  const [filter, setFilter] = useState('');
  const isDark = resolveScheme(colorScheme) === 'dark';

  const visibleThemes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return themes;
    return themes.filter(
      (t) => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [filter, themes]);

  return (
    <>
      <div className={styles.filterRow}>
        <Search size={13} strokeWidth={1.75} className={styles.filterIcon} />
        <input
          className={styles.filterInput}
          placeholder="Filter themes…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button className={styles.filterClear} onClick={() => setFilter('')} title="Clear filter">
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      {visibleThemes.length === 0 ? (
        <div className={styles.empty}>No themes match “{filter}”.</div>
      ) : (
        <div className={styles.themeGrid}>
          {visibleThemes.map((t) => (
            <button
              key={t.id}
              className={`${styles.themeCard} ${activeTheme === t.id ? styles.themeCardActive : ''}`}
              onClick={() => onChange(t.id)}
            >
              {/* Previews read each theme's own tokens, so a theme's colours are
                  defined once: in global.css, or in its augment's stylesheet. */}
              <div className={styles.themePreview} data-theme={t.id} data-scheme={isDark ? 'dark' : 'light'}>
                <div className={styles.previewSidebar} />
                <div className={styles.previewContent}>
                  <div className={styles.previewAccent} />
                  <div className={styles.previewLines}>
                    <span /><span /><span style={{ width: '60%' }} />
                  </div>
                </div>
              </div>
              <div className={styles.themeCardLabel}>{t.label}</div>
              <div className={styles.themeCardDesc}>{t.description}</div>
              {activeTheme === t.id && <div className={styles.themeCardCheck}>✓</div>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: `components/settings/FontSizeControl.tsx`**

```tsx
import type { SettingControlProps } from '../../settings/schema';
import { SliderControl } from './controls';
import styles from '../SettingsPage.module.css';

const FONT_PREVIEW_TEXT =
  'The quick brown fox jumps over the lazy dog while the editor renders at this size.';

/** The size slider with a line of text at the chosen size. */
export function FontSizeControl(props: SettingControlProps<number>) {
  return (
    <>
      <SliderControl {...props} />
      <div className={styles.fontPreview} style={{ fontSize: `${props.value}px` }}>
        {FONT_PREVIEW_TEXT}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Add the controls to `settings/builtin.ts`**

Add imports:

```ts
import { FontSizeControl } from '../components/settings/FontSizeControl';
import { ThemePickerControl } from '../components/settings/ThemePickerControl';
```

Add `control: FontSizeControl,` to the `editor.fontSize` declaration and `control: ThemePickerControl,` to the `appearance.theme` declaration.

- [ ] **Step 6: Move the three data pages out of `SettingsPage.tsx`**

These are data management, not preferences, so they stay hand-built — but register on the UI registry instead of being hard-coded into the page. The page shell renders each one's `<section>` and `<h2>` from the registration, so the moved bodies drop those wrappers.

`components/settings/KeyboardPage.tsx`: move `KeyboardChapter` from `SettingsPage.tsx` (current lines 352–456) into this file as `export default function KeyboardPage()`. Changes while moving: remove the `{ sectionRef }: ChapterProps` parameter; replace the outer `<section …>` and the `<h2 …>Keyboard</h2>` with a fragment `<>…</>`. Imports it needs: `useEffect, useState` from `react`; `RotateCcw` from `lucide-react`; `KEYBINDINGS, KEYBINDING_GROUPS, conflictsFor, eventToAccel, formatAccel, keybindingDef, useKeybindingStore, type KeybindingId` from `'../../store/keybindings'`; `styles from '../SettingsPage.module.css'`.

`components/settings/VaultPage.tsx`: move `VaultChapter` (lines 460–586) plus `ColorSwatchProps`/`ColorSwatch` (588–608) and `NAME_SAVE_DEBOUNCE_MS` (line 32) into this file; export `VaultChapter` as `export default function VaultPage()`. Changes while moving: remove the `sectionRef` parameter; in both return branches replace the `<section …>` + `<h2 …>Vault</h2>` wrapper with a fragment; replace the three `console.error('…', err)` calls with `log('error', 'settings', '…', err)` (same message text, without the trailing colon). Imports: `useEffect, useState` from `react`; `api` from `'../../ipc'`; `useVaultStore` from `'../../store/vaults'`; `useUIStore` from `'../../store/ui'`; `useSetting` from `'../../settings'`; `log` from `'../../lib/log'`; `HoldButton` from `'../HoldButton'`; `HOLD_ARCHIVE_MS` from `'@shared/constants'`; `VAULT_COLOR_FAMILIES, VAULT_SHADE_LABELS, DISTINCT_VAULT_COLORS, DEFAULT_VAULT_COLOR` from `'@shared/constants/vaultColors'`; `styles from '../SettingsPage.module.css'`.

`components/settings/TagsPage.tsx`: move `TagsChapter` (lines 610–646) as `export default function TagsPage()`, same wrapper change. Imports: `X` from `lucide-react`; `useTagStore` from `'../../store/tags'`; `styles from '../SettingsPage.module.css'`. The body's `confirm(…)` call is unchanged.

- [ ] **Step 7: `components/settings/pages.ts`**

```ts
import { registry } from '../../registry';
import KeyboardPage from './KeyboardPage';
import TagsPage from './TagsPage';
import VaultPage from './VaultPage';

// Hand-built Settings pages. They follow the generated sections in `position`
// order. Registering, rather than hard-coding them into the page, is what lets
// a module add its own.

registry.addPage('settings', { id: 'keyboard', label: 'Keyboard', component: KeyboardPage, position: 10 });
registry.addPage('settings', { id: 'vault',    label: 'Vault',    component: VaultPage,    position: 20 });
registry.addPage('settings', { id: 'tags',     label: 'Tags',     component: TagsPage,     position: 30 });
```

- [ ] **Step 8: Rewrite `components/SettingsPage.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Braces, Search, X } from 'lucide-react';
import { registry } from '../registry';
import { useSettings, useSettingsRegistry } from '../settings';
import { filterSettings, modifiedKeys } from '../settings/search';
import type { SettingDefinition } from '../settings/schema';
import { useUIStore, type SettingsTab } from '../store/ui';
import { SettingRow } from './settings/SettingRow';
import { JsonView } from './settings/JsonView';
import { ProblemsBanner } from './settings/ProblemsBanner';
import './settings/pages';
import styles from './SettingsPage.module.css';

/** Sections with a fixed place; any other section follows alphabetically. */
const SECTION_ORDER = ['Editor', 'Appearance', 'Vaults'];

/**
 * The command palette opens Settings at a named place. Old tab names survive
 * as anchors so "Appearance" and "Vault settings" still land correctly.
 */
const TAB_TO_ANCHOR: Record<SettingsTab, string> = {
  appearance: 'section:Appearance',
  app:        'section:Editor',
  vault:      'page:vault',
};

interface Chapter {
  anchor: string;
  label: string;
  settings?: SettingDefinition[];
  page?: ComponentType;
}

function sectionRank(section: string): number {
  const i = SECTION_ORDER.indexOf(section);
  return i === -1 ? SECTION_ORDER.length : i;
}

export default function SettingsPage() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const definitions = useSettingsRegistry((s) => s.definitions);
  const values = useSettings((s) => s.values);
  const [query, setQuery] = useState('');
  const [jsonOpen, setJsonOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeAnchor, setActiveAnchor] = useState(TAB_TO_ANCHOR[settingsTab]);

  // Re-read the files when Settings opens, in case they were edited elsewhere.
  useEffect(() => { void useSettings.getState().reload(); }, []);

  const chapters = useMemo<Chapter[]>(() => {
    const modified = modifiedKeys(definitions, values);
    const matching = filterSettings(definitions, query, modified);
    const bySection = new Map<string, SettingDefinition[]>();
    for (const def of matching) {
      bySection.set(def.section, [...(bySection.get(def.section) ?? []), def]);
    }
    const sections: Chapter[] = [...bySection.entries()]
      .sort(([a], [b]) => sectionRank(a) - sectionRank(b) || a.localeCompare(b))
      .map(([section, defs]) => ({
        anchor: `section:${section}`,
        label: section,
        settings: [...defs].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
      }));

    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter((w) => w && w !== '@modified');
    const pages: Chapter[] = q.includes('@modified')
      ? []
      : registry.getPages('settings')
        .filter((p) => words.every((w) => p.label.toLowerCase().includes(w)))
        .map((p) => ({ anchor: `page:${p.id}`, label: p.label, page: p.component }));
    return [...sections, ...pages];
  }, [definitions, values, query]);

  function scrollTo(anchor: string) {
    chapterRefs.current[anchor]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Jump to whichever place the caller asked for when settings opened.
  useEffect(() => {
    const target = TAB_TO_ANCHOR[settingsTab];
    setActiveAnchor(target);
    const raf = requestAnimationFrame(() => {
      chapterRefs.current[target]?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [settingsTab]);

  // Highlight the chapter currently in view.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || jsonOpen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const anchor = visible?.target.getAttribute('data-chapter');
        if (anchor) setActiveAnchor(anchor);
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const el of Object.values(chapterRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [chapters, jsonOpen]);

  return (
    <div className={`${styles.page} cord-settings`}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarLabel}>Settings</div>
        <nav className={`${styles.sidebarNav} cord-settings__nav`}>
          {chapters.map((c) => (
            <button
              key={c.anchor}
              className={`${styles.navItem} cord-settings__nav-item ${activeAnchor === c.anchor ? `${styles.navActive} cord-settings__nav-item--active` : ''}`}
              onClick={() => { setJsonOpen(false); requestAnimationFrame(() => scrollTo(c.anchor)); }}
            >
              {c.label}
            </button>
          ))}
        </nav>
        <div className={styles.autosaveNote}>Changes save automatically.</div>
      </div>

      <div className={styles.content} ref={scrollRef}>
        <div className={styles.settingsHeader}>
          <div className={`${styles.filterRow} ${styles.searchRow} cord-settings__search`}>
            <Search size={13} strokeWidth={1.75} className={styles.filterIcon} />
            <input
              className={styles.filterInput}
              placeholder="Search settings — @modified for changed ones"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setJsonOpen(false); }}
              aria-label="Search settings"
            />
            {query && (
              <button className={styles.filterClear} onClick={() => setQuery('')} title="Clear search">
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
          <button
            className={`${styles.secondaryBtn} ${jsonOpen ? styles.jsonToggleOn : ''}`}
            onClick={() => setJsonOpen((o) => !o)}
            aria-pressed={jsonOpen}
          >
            <Braces size={13} strokeWidth={1.75} /> Edit as JSON
          </button>
        </div>

        <ProblemsBanner onOpenJson={() => setJsonOpen(true)} />

        {jsonOpen ? (
          <JsonView />
        ) : chapters.length === 0 ? (
          <div className={styles.empty}>No settings match “{query}”.</div>
        ) : (
          chapters.map((c) => {
            const Page = c.page;
            return (
              <section
                key={c.anchor}
                className={`${styles.chapter} cord-settings__section`}
                data-chapter={c.anchor}
                ref={(el) => { chapterRefs.current[c.anchor] = el; }}
              >
                <h2 className={`${styles.chapterTitle} cord-settings__section-title`}>{c.label}</h2>
                {c.settings?.map((def) => <SettingRow key={def.key} definition={def} />)}
                {Page && <Page />}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Append styles to `SettingsPage.module.css`**

```css
/* ── Generated settings ─────────────────────────────────────────────────── */

.settingsHeader {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  position: sticky;
  top: 0;
  z-index: 2;
  padding: var(--space-3) 0;
  background: var(--bg);
}

.searchRow { flex: 1; margin: 0; }

.jsonToggleOn {
  background: var(--bg-active);
  color: var(--text-primary);
}

.settingRow { position: relative; }

.settingHead,
.settingActions {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.settingHead { justify-content: space-between; margin-bottom: var(--space-2); }

/* A left rule marks a changed setting, like VS Code's modified indicator. */
.settingModified::before {
  content: '';
  position: absolute;
  left: calc(-1 * var(--space-3));
  top: var(--space-1);
  bottom: var(--space-1);
  width: 2px;
  border-radius: var(--radius-full);
  background: var(--accent);
}

.settingKey {
  margin-left: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 400;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity var(--duration-fast);
  user-select: all;
}

.settingRow:hover .settingKey { opacity: 1; }

.selectInput {
  min-width: 160px;
  padding: var(--space-1-5) var(--space-2-5);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border);
  font: inherit;
  font-size: var(--text-md);
}
```

- [ ] **Step 9b: Document the two new public classes**

`publicApi.test.ts` fails for any `cord-*` class that is not documented. In `docs/theming/public-api.md`, in the "Settings, trash, sign-in" table, after the `cord-settings__field` row add:

```markdown
| `cord-settings__field--modified` | A setting changed from its default |
| `cord-settings__search` | Settings search field |
```

- [ ] **Step 10: Stub the two components Task 14 fills in, so this task compiles**

`components/settings/JsonView.tsx`:

```tsx
export function JsonView() {
  return null;
}
```

`components/settings/ProblemsBanner.tsx`:

```tsx
export function ProblemsBanner(_props: { onOpenJson: () => void }) {
  return null;
}
```

- [ ] **Step 11: Verify**

Run: `pnpm typecheck` → no errors.
Run: `CORD_DB_PATH=:memory: bun test src` → all pass, including `publicApi.test.ts`.
Run: `pnpm build:renderer` → `✓ built`.

- [ ] **Step 12: Manual check** (from the worktree: `pnpm dev`)

- Settings shows Editor, Appearance, Vaults, then Keyboard, Vault, Tags in the nav.
- Changing font size updates the preview and the editor; a modified marker and reset button appear; reset restores 15.
- Searching "spell" shows only Spell check; "@modified" shows only changed settings.
- Theme cards and colour mode work; the command palette's "Light mode" still switches.
- `~/.cord/settings.json` contains only the changed keys; add a `// comment` by hand, change a setting in the app, confirm the comment survived.
- Rebinding a shortcut creates `~/.cord/keybindings.json`.

- [ ] **Step 13: Commit**

```bash
git add src/renderer/components src/renderer/settings/builtin.ts ../../docs/theming/public-api.md
git commit -m "Generate the Settings page from the schema"
```

---

### Task 14: JSON view and problems banner

**Files:**
- Replace: `apps/desktop/src/renderer/components/settings/JsonView.tsx`, `ProblemsBanner.tsx`
- Modify: `apps/desktop/src/renderer/components/SettingsPage.module.css` (append)

- [ ] **Step 1: `JsonView.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useSettings, useSettingsRegistry } from '../../settings';
import { parseJsoncObject, type SettingsProblem } from '../../settings/jsonText';
import { resolveValues } from '../../settings/schema';
import { formatAccel } from '../../store/keybindings';
import styles from '../SettingsPage.module.css';

const IS_SAVE = (e: React.KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';

/**
 * settings.json as text. Checked as you type; syntax errors block saving,
 * while bad values and unknown keys are only flagged — a bad value falls back
 * to its default and stays reported.
 */
export function JsonView() {
  const fileText = useSettings((s) => s.text);
  const saveText = useSettings((s) => s.saveText);
  const definitions = useSettingsRegistry((s) => s.definitions);
  const [draft, setDraft] = useState(fileText);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Follow the file while there are no local edits (another tab, a reload).
  useEffect(() => {
    if (!dirty) setDraft(fileText);
  }, [fileText, dirty]);

  const problems = useMemo<SettingsProblem[]>(() => {
    const parsed = parseJsoncObject(draft);
    return parsed.data ? resolveValues(definitions, parsed.data).problems : parsed.problems;
  }, [draft, definitions]);
  const blocked = problems.some((p) => p.key === null && p.severity === 'error');

  async function save() {
    if (blocked || !dirty) return;
    setSaving(true);
    const result = await saveText(draft);
    setSaving(false);
    if (!result.some((p) => p.key === null)) setDirty(false);
  }

  return (
    <div className={`${styles.jsonView} cord-settings__json`}>
      <div className={styles.jsonBar}>
        <span className={styles.fieldHint}>
          ~/.cord/settings.json — only values that differ from their default. Comments are allowed.
        </span>
        <div className={styles.settingActions}>
          <button
            className={styles.secondaryBtn}
            onClick={() => { setDraft(fileText); setDirty(false); }}
            disabled={!dirty}
          >
            Revert
          </button>
          <button
            className={styles.secondaryBtn}
            onClick={() => { void save(); }}
            disabled={!dirty || blocked || saving}
            title={blocked ? 'Fix the syntax errors first' : `Save (${formatAccel('Mod+S')})`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <textarea
        className={styles.jsonEditor}
        value={draft}
        spellCheck={false}
        aria-label="settings.json"
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onKeyDown={(e) => {
          if (IS_SAVE(e)) { e.preventDefault(); void save(); }
          // Tab inserts two spaces instead of leaving the editor.
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: start, selectionEnd: end } = el;
            const next = `${draft.slice(0, start)}  ${draft.slice(end)}`;
            setDraft(next);
            setDirty(true);
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
          }
        }}
      />

      {problems.length > 0 && (
        <ul className={styles.problemList}>
          {problems.map((p, i) => (
            <li key={i} className={p.severity === 'error' ? styles.problemError : styles.problemWarning}>
              {p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `ProblemsBanner.tsx`**

```tsx
import { useSettings } from '../../settings';
import { useKeybindingStore } from '../../store/keybindings';
import styles from '../SettingsPage.module.css';

/** What is wrong with the config files, and what Cord is doing about it. */
export function ProblemsBanner({ onOpenJson }: { onOpenJson: () => void }) {
  const problems = useSettings((s) => s.problems);
  const syntaxError = useSettings((s) => s.syntaxError);
  const saveError = useSettings((s) => s.saveError);
  const keybindingError = useKeybindingStore((s) => s.fileError);

  const lines: string[] = [];
  if (syntaxError) {
    lines.push('settings.json has a syntax error. Cord is using the last good values, and changes made here are not saved until the file is fixed.');
  } else {
    const errors = problems.filter((p) => p.severity === 'error').length;
    const warnings = problems.filter((p) => p.severity === 'warning').length;
    if (errors) lines.push(`${errors} invalid value${errors === 1 ? '' : 's'} in settings.json ${errors === 1 ? 'is' : 'are'} using the default.`);
    if (warnings) lines.push(`${warnings} unknown key${warnings === 1 ? '' : 's'} in settings.json ${warnings === 1 ? 'is' : 'are'} kept but ignored.`);
  }
  if (saveError) lines.push(saveError);
  if (keybindingError) lines.push(`${keybindingError} Shortcut changes are not saved until it is fixed.`);
  if (lines.length === 0) return null;

  return (
    <div className={styles.problemsBanner} role="status">
      {lines.map((l) => <div key={l}>{l}</div>)}
      {(syntaxError || problems.length > 0) && (
        <button className={styles.bannerLink} onClick={onOpenJson}>Open settings.json</button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Append styles**

```css
/* ── JSON view and problems ─────────────────────────────────────────────── */

.jsonView {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.jsonBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.jsonEditor {
  min-height: 360px;
  resize: vertical;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  line-height: 1.6;
  tab-size: 2;
  white-space: pre;
}

.jsonEditor:focus { border-color: var(--border-strong); }

.problemList {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
}

.problemError   { color: var(--danger); }
.problemWarning { color: var(--text-secondary); }

.problemsBanner {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
  padding: var(--space-2-5) var(--space-3);
  border-radius: var(--radius);
  border: 1px solid var(--danger-border);
  background: var(--danger-hover-bg);
  color: var(--text-primary);
  font-size: var(--text-md);
}

.bannerLink {
  align-self: flex-start;
  color: var(--danger);
  text-decoration: underline;
  font-size: var(--text-sm);
}
```

- [ ] **Step 4: Document the JSON editor class**

In `docs/theming/public-api.md`, after the `cord-settings__search` row add:

```markdown
| `cord-settings__json` | The settings.json editor |
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck` → no errors. `CORD_DB_PATH=:memory: bun test src` → all pass. `pnpm build:renderer` → `✓ built`.

- [ ] **Step 6: Manual check** (`pnpm dev`)

- "Edit as JSON" shows the file; typing `{ "editor.fontSize": }` lists a syntax error with a line number and disables Save.
- `{ "editor.fontSize": 99 }` saves; the banner reports one invalid value; font size stays 15.
- `{ "editor.fontSize": 18 }` + `Mod+S` saves and the editor text grows.
- Break the file by hand outside Cord, focus Cord: banner says changes are not saved; changing a setting does not rewrite the file.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/settings/JsonView.tsx src/renderer/components/settings/ProblemsBanner.tsx src/renderer/components/SettingsPage.module.css ../../docs/theming/public-api.md
git commit -m "Add the settings JSON view and problems banner"
```

---

### Task 15: Final verification

- [ ] **Step 1: Full verification**

Run: `CORD_DB_PATH=:memory: bun test src` → all pass (including `publicApi.test.ts`).
Run: `pnpm typecheck` → no errors.
Run: `pnpm build:renderer` → `✓ built`.
Run (from `src-tauri`): `cargo check` → `Finished`.
Run: `grep -rn "localStorage" src/renderer --include=*.ts --include=*.tsx | grep -v __tests__` → only `store/vaults.ts` (vault order), `settings/index.ts` (boot cache + migration), `store/keybindings.ts` (legacy migration).

- [ ] **Step 2: Migration check on a real profile** (`pnpm dev`, with the old build's settings still in localStorage)

- First launch creates `~/.cord/settings.json` with your previous font size/theme and `~/.cord/keybindings.json` with previous overrides; the old `cord-*` keys are gone (DevTools → Application → Local Storage), except `cord-vault-order` and `cord-settings-cache`.

- [ ] **Step 3: Fix anything found, re-run Step 1, and commit the fixes**
