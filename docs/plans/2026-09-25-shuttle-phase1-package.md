# Shuttle Phase 1 — Plan A: the package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@cord/shuttle`, a standalone React editor package on official Tiptap 3 extensions, usable and testable without Cord (fake host + playground).

**Architecture:** One `<ShuttleEditor>` component owns a Tiptap 3 editor built by `buildExtensions(mode, ctxRef, options)`. Everything host-specific goes through a `ShuttleHost` object held in a ref, so extensions are built once and always see the latest host. Custom code is limited to links (Mention-based wiki links, fragment links), notepad block commands, `blockRef`, slash menu, keybindings, unlinked-mention decorations, markdown glue, and image upload glue.

**Tech Stack:** Tiptap 3.31 (MIT extensions only), React 18, TypeScript strict, Bun test + happy-dom, Vite (playground only), pnpm.

**Spec:** `docs/specs/2026-09-25-shuttle-v3-rebuild-design.md`. Plan B (Cord cutover) is written after this plan lands, against the real API.

**Repo:** `C:\Users\Olek\Downloads\evrything-cord\shuttle`, branch `phase-1-rebuild`. All paths below are relative to that directory. Commit messages carry **no** `Co-Authored-By` trailer.

## Spec adjustments made while planning (apply in Task 1)

1. `ShuttleHost.searchBlocks` → `listBlocks(noteId)`; the ref picker is two-step (note, then block), as today. `resolveBlock(blockId)` takes the block id only, matching Cord's `blocks:resolveRef`.
2. `fragmentLink` stays a small custom inline node — it has no typed trigger, it is inserted by Cord's context menu, so Mention adds nothing.
3. Tiptap packages are regular `dependencies` of Shuttle (Cord will stop depending on Tiptap directly); only `react`, `react-dom`, `katex` are peers.
4. Cord's `EditorContextMenu`, `FragmentOverlay`, `WikiLinkPills` stay in Cord as overlays — they are about Cord's tag/fragment data. Shuttle exposes the editor via `onReady` and exports `insertFragmentLink`.
5. `CustomTaskItem` is dropped: stock `TaskItem` + CSS.
6. YouTube/Twitch are embedded by pasting their URL (official paste handlers); no URL dialog in Phase 1.
7. Legacy detection uses our own `isValidDoc` check before loading, rather than relying on `enableContentCheck`'s fallback behaviour. Same user-visible result.
8. Shuttle's context carries `docKey`, so unlinked-mention highlighting can skip the note's own title.

## File map

```
package.json, tsconfig.json, bunfig.toml, .gitignore, README.md
test/setup.ts                     happy-dom registration (bun preload)
test/helpers.ts                   makeEditor(), stripIds(), sleep()
src/index.ts                      public exports
src/host.ts                       ShuttleHost + DTO types
src/context.ts                    ShuttleContext, UI event contract
src/testing/fakeHost.ts           in-memory host used by tests and playground
src/doc/topLevel.ts               topLevelAt(), blockIdAt()
src/doc/tracking.ts               collectMentionTargets(), collectFragmentLinkIds(), diffSets()
src/doc/validate.ts               isValidDoc(), EMPTY_DOC
src/extensions/index.ts           buildExtensions()
src/extensions/blockTypes.ts      BLOCK_TYPES
src/custom/notepad/commands.ts    moveBlock, duplicateBlock, deleteBlock, turnInto
src/custom/links/wikiLink.tsx     Mention.extend → [[ ]] links
src/custom/links/WikiLinkView.tsx
src/custom/links/fragmentLink.tsx
src/custom/blockRef/blockRef.tsx
src/custom/blockRef/BlockRefView.tsx
src/custom/markdown/details.ts    Details.extend with :::details markdown
src/custom/markdown/clipboard.ts  markdown paste/copy
src/custom/image/image.ts         Image.extend: src resolution, upload attrs, retry click
src/custom/image/upload.ts        insertImageFiles(), stripPendingUploads()
src/custom/unlinkedMentions.ts
src/custom/keybindings/defs.ts    catalogue, eventToAccel, formatAccel, resolveBindings
src/custom/keybindings/keybindings.ts
src/custom/slash/items.tsx        slash items + templates
src/custom/slash/slash.ts         Suggestion-based extension
src/ui/suggestionPopup.tsx        shared popup renderer for suggestions
src/ui/SuggestionList.tsx         keyboard-navigable list (slash + wiki)
src/ui/Toolbar.tsx, SelectionBubble.tsx, BlockGutter.tsx, BlockMenu.tsx,
src/ui/RefPicker.tsx, MathEditor.tsx, FindBar.tsx, Outline.tsx
src/ShuttleEditor.tsx
src/styles/shuttle.css
playground/index.html, playground/main.tsx, playground/vite.config.ts
```

---

### Task 1: Reset the repo and scaffold the package

**Files:**
- Delete: `src/` (entire v2 baseline — it lives on in git history and in Cord)
- Modify: `package.json`, `tsconfig.json`, `.gitignore`, `docs/specs/2026-09-25-shuttle-v3-rebuild-design.md`
- Create: `bunfig.toml`, `test/setup.ts`, `test/smoke.test.ts`, `src/index.ts`

- [ ] **Step 1: Remove the v2 baseline**

```bash
git rm -r -q src
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@cord/shuttle",
  "version": "0.1.0",
  "private": true,
  "description": "Shuttle — Cord's editor: official Tiptap 3 extensions plus links, notepad mode and transclusion.",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles/shuttle.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "playground": "vite --config playground/vite.config.ts"
  },
  "peerDependencies": {
    "katex": "^0.16.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "dependencies": {
    "@tiptap/core": "^3.31.3",
    "@tiptap/extension-bubble-menu": "^3.31.3",
    "@tiptap/extension-code-block-lowlight": "^3.31.3",
    "@tiptap/extension-details": "^3.31.3",
    "@tiptap/extension-drag-handle": "^3.31.3",
    "@tiptap/extension-drag-handle-react": "^3.31.3",
    "@tiptap/extension-file-handler": "^3.31.3",
    "@tiptap/extension-find-and-replace": "^3.31.3",
    "@tiptap/extension-highlight": "^3.31.3",
    "@tiptap/extension-image": "^3.31.3",
    "@tiptap/extension-list": "^3.31.3",
    "@tiptap/extension-mathematics": "^3.31.3",
    "@tiptap/extension-mention": "^3.31.3",
    "@tiptap/extension-node-range": "^3.31.3",
    "@tiptap/extension-subscript": "^3.31.3",
    "@tiptap/extension-superscript": "^3.31.3",
    "@tiptap/extension-table": "^3.31.3",
    "@tiptap/extension-table-of-contents": "^3.31.3",
    "@tiptap/extension-twitch": "^3.31.3",
    "@tiptap/extension-unique-id": "^3.31.3",
    "@tiptap/extension-youtube": "^3.31.3",
    "@tiptap/extensions": "^3.31.3",
    "@tiptap/markdown": "^3.31.3",
    "@tiptap/pm": "^3.31.3",
    "@tiptap/react": "^3.31.3",
    "@tiptap/starter-kit": "^3.31.3",
    "@tiptap/suggestion": "^3.31.3",
    "lowlight": "^3.1.0",
    "lucide-react": "^1.45.0",
    "nanoid": "^3.3.11"
  },
  "devDependencies": {
    "@happy-dom/global-registrator": "^20.11.1",
    "@types/bun": "^1.3.0",
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.2.1",
    "katex": "^0.16.45",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.4.5",
    "vite": "^5.2.0"
  },
  "packageManager": "pnpm@11.8.0"
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src", "test", "playground"]
}
```

- [ ] **Step 4: Write `bunfig.toml`, `test/setup.ts`, extend `.gitignore`**

`bunfig.toml`:
```toml
[test]
preload = ["./test/setup.ts"]
root = "."
```

`test/setup.ts`:
```ts
// A Tiptap `Editor` creates an `EditorView`, which needs a DOM. Registered once
// for the whole run, before any test module builds an editor.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (typeof globalThis.document === 'undefined') {
  GlobalRegistrator.register();
}

// Lets react-dom's `act` flush effects without warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
```

Append to `.gitignore`:
```
playground/dist/
```

- [ ] **Step 5: Write the smoke test `test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'bun:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

describe('toolchain', () => {
  it('builds a Tiptap 3 editor under bun + happy-dom', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit],
      content: '<p>hello</p>',
    });
    expect(editor.getText()).toBe('hello');
    editor.destroy();
  });
});
```

- [ ] **Step 6: Placeholder entry `src/index.ts`**

```ts
export {};
```

- [ ] **Step 7: Install and run**

Run: `pnpm install` then `bun test`
Expected: `1 pass, 0 fail`.

- [ ] **Step 8: Apply the spec adjustments**

In `docs/specs/2026-09-25-shuttle-v3-rebuild-design.md`, add a section at the end:

```markdown
## Adjustments made during planning (2026-09-25)

1. Host: `searchBlocks` replaced by `listBlocks(noteId)`; `resolveBlock(blockId)` takes the block id only.
2. `fragmentLink` is a small custom inline node, not Mention — it has no typed trigger.
3. Tiptap packages are regular dependencies; only react, react-dom, katex are peers.
4. Cord's context menu, fragment overlay and wiki-link pills stay in Cord as overlays; Shuttle exposes the editor via `onReady` and exports `insertFragmentLink`.
5. `CustomTaskItem` dropped in favour of stock TaskItem + CSS.
6. YouTube/Twitch embed by pasting a URL (official paste handlers); no URL dialog in Phase 1.
7. Legacy content is detected by Shuttle's own `isValidDoc` before loading.
8. Shuttle's context carries `docKey` so unlinked-mention highlighting skips the note's own title.
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold @cord/shuttle on Tiptap 3; drop the v2 baseline"
```

---

### Task 2: Host contract, context, fake host

**Files:**
- Create: `src/host.ts`, `src/context.ts`, `src/testing/fakeHost.ts`, `src/custom/keybindings/defs.ts` (type only for now — completed in Task 3)
- Test: `test/fakeHost.test.ts`

- [ ] **Step 1: Write the failing test `test/fakeHost.test.ts`**

```ts
import { describe, it, expect } from 'bun:test';
import { createFakeHost } from '../src/testing/fakeHost';

describe('fake host', () => {
  it('searches notes case-insensitively and finds by exact title', async () => {
    const host = createFakeHost();
    const hits = await host.searchNotes('alp');
    expect(hits.map((n) => n.title)).toEqual(['Alpha']);
    expect(host.findNoteByTitle('beta')?.id).toBe('n-beta');
    expect(host.findNoteByTitle('missing')).toBeNull();
  });

  it('records side effects', () => {
    const host = createFakeHost();
    host.onLinksChanged({ added: ['n-alpha'], removed: [] });
    host.openNote('n-beta', 'b1');
    expect(host.calls.linksChanged).toEqual([{ added: ['n-alpha'], removed: [] }]);
    expect(host.calls.opened).toEqual([{ noteId: 'n-beta', blockId: 'b1' }]);
  });

  it('fails uploads when asked to', async () => {
    const host = createFakeHost({ uploadFails: true });
    await expect(host.uploadFile(new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `bun test test/fakeHost.test.ts`
Expected: FAIL, cannot resolve `../src/testing/fakeHost`.

- [ ] **Step 3: Write `src/custom/keybindings/defs.ts` (id type only; Task 3 fills the rest)**

```ts
export type KeybindingId =
  | 'editor.bold'
  | 'editor.italic'
  | 'editor.underline'
  | 'editor.inlineCode'
  | 'editor.strike'
  | 'editor.highlight'
  | 'editor.heading1'
  | 'editor.heading2'
  | 'editor.heading3'
  | 'editor.bulletList'
  | 'editor.orderedList'
  | 'editor.taskList'
  | 'editor.toggleTask'
  | 'editor.blockquote'
  | 'editor.codeBlock'
  | 'editor.divider'
  | 'editor.find'
  | 'block.moveUp'
  | 'block.moveDown'
  | 'block.duplicate'
  | 'block.delete'
  | 'block.insertRef';
```

- [ ] **Step 4: Write `src/host.ts`**

```ts
import type { JSONContent } from '@tiptap/core';
import type { KeybindingId } from './custom/keybindings/defs';

/** `note` is a plain document; `notepad` adds the block gutter and block menu. */
export type ShuttleMode = 'note' | 'notepad';

export interface NoteRef {
  id: string;
  title: string;
}

/** One row of the host's block index, as shown in the reference picker. */
export interface BlockSummary {
  id: string;
  noteId: string;
  type: string;
  text: string;
  level: number | null;
}

/** A transcluded block, resolved by the host from the source note. */
export interface ResolvedBlock {
  blockId: string;
  noteId: string;
  noteTitle: string;
  /** The top-level node as stored in the source note's document. */
  content: JSONContent;
}

export type FragmentActionType = 'tag' | 'noteLink' | 'fragmentLink';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Everything Shuttle needs from the application embedding it.
 *
 * Shuttle never imports the host's stores, IPC or platform APIs. Anything that
 * needs the host's data or causes a side effect outside the document goes
 * through here, which is what lets the package run in the playground and in
 * tests against a fake.
 */
export interface ShuttleHost {
  // ── Lookups ───────────────────────────────────────────────────────────────
  /** Notes matching a query, for `[[` autocomplete and the reference picker. */
  searchNotes(query: string): Promise<NoteRef[]>;
  /** Exact (case-insensitive) title match, for typed `[[Title]]` and markdown. */
  findNoteByTitle(title: string): NoteRef | null;
  /** Every note title, for unlinked-mention highlighting. */
  listNoteTitles(): NoteRef[];
  /** Blocks of one note, for the second step of the reference picker. */
  listBlocks(noteId: string): Promise<BlockSummary[]>;
  /** A transcluded block's current content, or null if it no longer exists. */
  resolveBlock(blockId: string): Promise<ResolvedBlock | null>;
  /**
   * A displayable URL for a stored `src`. Stored values are platform-neutral
   * (`attachment:<id>`); unknown schemes must be returned unchanged.
   */
  resolveFileSrc(src: string): string;

  // ── Side effects ──────────────────────────────────────────────────────────
  /** Store a file and return the `src` to persist in the document. */
  uploadFile(file: File): Promise<{ src: string }>;
  /** Wiki-link targets that appeared in or disappeared from the document. */
  onLinksChanged(diff: { added: string[]; removed: string[] }): void;
  /** Fragment link nodes removed from the document, by their link id. */
  onFragmentLinksRemoved(linkIds: string[]): void;
  /** A per-block action the host implements (tagging, linking a block). */
  onFragmentAction(action: { type: FragmentActionType; blockId: string }): void;
  /** Navigate to a note, optionally scrolling to one of its blocks. */
  openNote(noteId: string, blockId?: string): void;
  /** Structured logging; Shuttle never calls `console` directly. */
  log(level: LogLevel, message: string, data?: unknown): void;

  // ── Settings ──────────────────────────────────────────────────────────────
  /** User overrides of Shuttle's default editor keybindings. */
  keybindings: Partial<Record<KeybindingId, string>>;
}
```

- [ ] **Step 5: Write `src/context.ts`**

```ts
import type { ShuttleHost } from './host';

export interface MathEditRequest {
  kind: 'inline' | 'block';
  latex: string;
  pos: number;
}

/**
 * Requests from inside the editor for UI the React layer owns. Extensions
 * cannot open React modals themselves, so they ask through these.
 */
export interface ShuttleUiEvents {
  openRefPicker(): void;
  editMath(request: MathEditRequest): void;
  openFind(): void;
  pickImage(): void;
}

export interface ShuttleContext {
  host: ShuttleHost;
  events: ShuttleUiEvents;
  /** Identity of the loaded document (Cord: the note id). */
  docKey: string;
}

/**
 * Extensions are built once per editor but the host, events and document can
 * change underneath them, so they read through a ref, never a captured value.
 */
export interface ShuttleContextRef {
  current: ShuttleContext;
}

export const noopEvents: ShuttleUiEvents = {
  openRefPicker() {},
  editMath() {},
  openFind() {},
  pickImage() {},
};
```

- [ ] **Step 6: Write `src/testing/fakeHost.ts`**

```ts
import type {
  BlockSummary, FragmentActionType, LogLevel, NoteRef, ResolvedBlock, ShuttleHost,
} from '../host';

export interface FakeHostCalls {
  linksChanged: { added: string[]; removed: string[] }[];
  fragmentLinksRemoved: string[][];
  fragmentActions: { type: FragmentActionType; blockId: string }[];
  opened: { noteId: string; blockId?: string }[];
  uploads: File[];
  logs: { level: LogLevel; message: string; data?: unknown }[];
}

export interface FakeHostOptions {
  notes?: NoteRef[];
  blocks?: BlockSummary[];
  resolved?: ResolvedBlock[];
  uploadFails?: boolean;
}

export type FakeHost = ShuttleHost & { calls: FakeHostCalls };

const DEFAULT_NOTES: NoteRef[] = [
  { id: 'n-alpha', title: 'Alpha' },
  { id: 'n-beta', title: 'Beta' },
  { id: 'n-gamma', title: 'Gamma Ray' },
];

/** In-memory host for tests and the playground. Records every side effect. */
export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
  const notes = options.notes ?? DEFAULT_NOTES;
  const blocks = options.blocks ?? [];
  const resolved = options.resolved ?? [];
  let uploadCount = 0;

  const calls: FakeHostCalls = {
    linksChanged: [],
    fragmentLinksRemoved: [],
    fragmentActions: [],
    opened: [],
    uploads: [],
    logs: [],
  };

  return {
    calls,
    keybindings: {},

    async searchNotes(query) {
      const q = query.toLowerCase();
      return notes.filter((n) => n.title.toLowerCase().includes(q));
    },
    findNoteByTitle(title) {
      const t = title.trim().toLowerCase();
      return notes.find((n) => n.title.toLowerCase() === t) ?? null;
    },
    listNoteTitles() {
      return notes;
    },
    async listBlocks(noteId) {
      return blocks.filter((b) => b.noteId === noteId);
    },
    async resolveBlock(blockId) {
      return resolved.find((r) => r.blockId === blockId) ?? null;
    },
    resolveFileSrc(src) {
      return src.startsWith('attachment:') ? `https://fake.local/${src.slice('attachment:'.length)}` : src;
    },

    async uploadFile(file) {
      calls.uploads.push(file);
      if (options.uploadFails) throw new Error('upload failed');
      uploadCount += 1;
      return { src: `attachment:up${uploadCount}` };
    },
    onLinksChanged(diff) {
      calls.linksChanged.push(diff);
    },
    onFragmentLinksRemoved(linkIds) {
      calls.fragmentLinksRemoved.push(linkIds);
    },
    onFragmentAction(action) {
      calls.fragmentActions.push(action);
    },
    openNote(noteId, blockId) {
      calls.opened.push(blockId === undefined ? { noteId } : { noteId, blockId });
    },
    log(level, message, data) {
      calls.logs.push(data === undefined ? { level, message } : { level, message, data });
    },
  };
}
```

- [ ] **Step 7: Run tests — expect pass**

Run: `bun test test/fakeHost.test.ts`
Expected: `3 pass`.

- [ ] **Step 8: Commit**

```bash
git add src test
git commit -m "Add the ShuttleHost contract, UI event context and a fake host"
```

---

### Task 3: Keybinding catalogue

**Files:**
- Modify: `src/custom/keybindings/defs.ts`
- Test: `test/keybindingDefs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import {
  SHUTTLE_KEYBINDINGS, eventToAccel, formatAccel, resolveBindings,
} from '../src/custom/keybindings/defs';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
});

describe('eventToAccel', () => {
  it('maps the primary modifier to Mod per platform', () => {
    expect(eventToAccel(key('b', { ctrlKey: true }), false)).toBe('Mod+B');
    expect(eventToAccel(key('b', { metaKey: true }), true)).toBe('Mod+B');
  });
  it('orders modifiers canonically', () => {
    expect(eventToAccel(key('ArrowUp', { altKey: true, shiftKey: true, ctrlKey: true }), false))
      .toBe('Mod+Alt+Shift+ArrowUp');
  });
  it('ignores bare modifier presses', () => {
    expect(eventToAccel(key('Shift', { shiftKey: true }), false)).toBeNull();
  });
});

describe('resolveBindings', () => {
  it('overlays host overrides on defaults', () => {
    const b = resolveBindings({ 'editor.bold': 'Mod+Shift+B' });
    expect(b['editor.bold']).toBe('Mod+Shift+B');
    expect(b['editor.italic']).toBe('Mod+I');
  });
  it('covers every catalogue entry', () => {
    const b = resolveBindings({});
    for (const def of SHUTTLE_KEYBINDINGS) expect(b[def.id]).toBe(def.defaultAccel);
  });
});

describe('formatAccel', () => {
  it('renders human labels on non-mac', () => {
    expect(formatAccel('Mod+Alt+ArrowUp', false)).toBe('Ctrl+Alt+↑');
  });
});
```

- [ ] **Step 2: Run — expect failure** (`SHUTTLE_KEYBINDINGS` not exported)

Run: `bun test test/keybindingDefs.test.ts`

- [ ] **Step 3: Replace `src/custom/keybindings/defs.ts` with the full catalogue**

```ts
/**
 * Shuttle's editor keybindings. The host stores user overrides and passes them
 * in `ShuttleHost.keybindings`; Shuttle owns the ids, labels and defaults.
 *
 * Accelerators are canonical strings: modifiers in a fixed order joined with
 * '+', e.g. `Mod+Shift+D`. `Mod` is Cmd on macOS and Ctrl elsewhere.
 */

export const IS_MAC: boolean =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export type KeybindingId =
  | 'editor.bold'
  | 'editor.italic'
  | 'editor.underline'
  | 'editor.inlineCode'
  | 'editor.strike'
  | 'editor.highlight'
  | 'editor.heading1'
  | 'editor.heading2'
  | 'editor.heading3'
  | 'editor.bulletList'
  | 'editor.orderedList'
  | 'editor.taskList'
  | 'editor.toggleTask'
  | 'editor.blockquote'
  | 'editor.codeBlock'
  | 'editor.divider'
  | 'editor.find'
  | 'block.moveUp'
  | 'block.moveDown'
  | 'block.duplicate'
  | 'block.delete'
  | 'block.insertRef';

export interface KeybindingDef {
  id: KeybindingId;
  label: string;
  group: 'Editor' | 'Blocks';
  /** Empty string means "no default binding". */
  defaultAccel: string;
  /** Only active in notepad mode. */
  notepadOnly?: true;
  hint?: string;
}

export const SHUTTLE_KEYBINDINGS: readonly KeybindingDef[] = [
  { id: 'editor.bold',        label: 'Bold',           group: 'Editor', defaultAccel: 'Mod+B' },
  { id: 'editor.italic',      label: 'Italic',         group: 'Editor', defaultAccel: 'Mod+I' },
  { id: 'editor.underline',   label: 'Underline',      group: 'Editor', defaultAccel: 'Mod+U' },
  { id: 'editor.inlineCode',  label: 'Inline code',    group: 'Editor', defaultAccel: 'Mod+E' },
  { id: 'editor.strike',      label: 'Strikethrough',  group: 'Editor', defaultAccel: 'Mod+Shift+X' },
  { id: 'editor.highlight',   label: 'Highlight',      group: 'Editor', defaultAccel: 'Mod+Shift+H' },
  { id: 'editor.heading1',    label: 'Heading 1',      group: 'Editor', defaultAccel: 'Mod+Alt+1' },
  { id: 'editor.heading2',    label: 'Heading 2',      group: 'Editor', defaultAccel: 'Mod+Alt+2' },
  { id: 'editor.heading3',    label: 'Heading 3',      group: 'Editor', defaultAccel: 'Mod+Alt+3' },
  { id: 'editor.bulletList',  label: 'Bullet list',    group: 'Editor', defaultAccel: 'Mod+Shift+8' },
  { id: 'editor.orderedList', label: 'Ordered list',   group: 'Editor', defaultAccel: 'Mod+Shift+7' },
  { id: 'editor.taskList',    label: 'Task list',      group: 'Editor', defaultAccel: 'Mod+Shift+9' },
  { id: 'editor.toggleTask',  label: 'Check / uncheck task', group: 'Editor', defaultAccel: 'Mod+Enter',
    hint: 'Only while the caret is in a task item' },
  { id: 'editor.blockquote',  label: 'Blockquote',     group: 'Editor', defaultAccel: 'Mod+Shift+B' },
  { id: 'editor.codeBlock',   label: 'Code block',     group: 'Editor', defaultAccel: 'Mod+Alt+C' },
  { id: 'editor.divider',     label: 'Insert divider', group: 'Editor', defaultAccel: '' },
  { id: 'editor.find',        label: 'Find and replace', group: 'Editor', defaultAccel: 'Mod+F' },
  { id: 'block.moveUp',    label: 'Move block up',          group: 'Blocks', defaultAccel: 'Alt+ArrowUp',         notepadOnly: true },
  { id: 'block.moveDown',  label: 'Move block down',        group: 'Blocks', defaultAccel: 'Alt+ArrowDown',       notepadOnly: true },
  { id: 'block.duplicate', label: 'Duplicate block',        group: 'Blocks', defaultAccel: 'Mod+Shift+D',         notepadOnly: true },
  { id: 'block.delete',    label: 'Delete block',           group: 'Blocks', defaultAccel: 'Mod+Shift+Backspace', notepadOnly: true },
  { id: 'block.insertRef', label: 'Insert block reference', group: 'Blocks', defaultAccel: '',                    notepadOnly: true },
];

export type KeybindingMap = Record<KeybindingId, string>;

/** Defaults with the host's overrides laid over them. */
export function resolveBindings(overrides: Partial<KeybindingMap>): KeybindingMap {
  const out = {} as KeybindingMap;
  for (const def of SHUTTLE_KEYBINDINGS) out[def.id] = overrides[def.id] ?? def.defaultAccel;
  return out;
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'Dead']);

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Canonical accelerator for a key event, or null for a bare modifier press. */
export function eventToAccel(e: KeyEventLike, mac: boolean = IS_MAC): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;

  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (!mac && e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const DISPLAY_KEYS: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: '⏎', Backspace: '⌫', Escape: 'Esc',
};

/** Human-readable accelerator for buttons and menus. */
export function formatAccel(accel: string, mac: boolean = IS_MAC): string {
  if (!accel) return '';
  const parts = accel.split('+').map((p) => {
    if (p === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (p === 'Alt') return mac ? '⌥' : 'Alt';
    if (p === 'Shift') return mac ? '⇧' : 'Shift';
    if (p === 'Ctrl') return mac ? '⌃' : 'Ctrl';
    if (p === 'Meta') return mac ? '⌘' : 'Win';
    return DISPLAY_KEYS[p] ?? p;
  });
  return mac ? parts.join('') : parts.join('+');
}
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test test/keybindingDefs.test.ts` → `6 pass`.

- [ ] **Step 5: Commit**

```bash
git add src/custom/keybindings/defs.ts test/keybindingDefs.test.ts
git commit -m "Add Shuttle's keybinding catalogue and accelerator encoding"
```

---

### Task 4: Top-level block helpers and notepad block commands

**Files:**
- Create: `src/doc/topLevel.ts`, `src/custom/notepad/commands.ts`
- Test: `test/notepadCommands.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'bun:test';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import UniqueID from '@tiptap/extension-unique-id';
import { BlockCommands } from '../src/custom/notepad/commands';
import { topLevelAt, blockIdAt } from '../src/doc/topLevel';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const p = (text: string, blockId: string): JSONContent => ({
  type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }],
});

function make(content: JSONContent[]): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit, TaskList, TaskItem,
      UniqueID.configure({ attributeName: 'blockId', types: ['paragraph', 'heading', 'bulletList', 'taskList', 'blockquote'] }),
      BlockCommands,
    ],
    content: { type: 'doc', content },
  });
  return editor;
}

const texts = (e: Editor): string[] => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(n.textContent));
  return out;
};
const ids = (e: Editor): string[] => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(n.attrs['blockId'] as string));
  return out;
};

describe('topLevelAt', () => {
  it('finds the top-level node around a position', () => {
    const e = make([p('one', 'a'), p('two', 'b')]);
    expect(topLevelAt(e.state.doc, 7)?.index).toBe(1);
    expect(blockIdAt(e.state, 2)).toBe('a');
  });
});

describe('block commands', () => {
  it('moves a block down and up', () => {
    const e = make([p('one', 'a'), p('two', 'b'), p('three', 'c')]);
    expect(e.commands.moveBlock(2, 1)).toBe(true);
    expect(texts(e).slice(0, 3)).toEqual(['two', 'one', 'three']);
    // "one" is now the second block (positions 5–10); move it back up.
    expect(e.commands.moveBlock(7, -1)).toBe(true);
    expect(texts(e).slice(0, 3)).toEqual(['one', 'two', 'three']);
  });

  it('refuses to move past the ends', () => {
    const e = make([p('one', 'a'), p('two', 'b')]);
    expect(e.commands.moveBlock(2, -1)).toBe(false);
  });

  it('duplicates with a fresh id', () => {
    const e = make([p('one', 'a')]);
    e.commands.duplicateBlock(2);
    expect(texts(e).slice(0, 2)).toEqual(['one', 'one']);
    const [first, second] = ids(e);
    expect(first).toBe('a');
    expect(second).toBeTruthy();
    expect(second).not.toBe('a');
  });

  it('deletes a block but never empties the document', () => {
    const e = make([p('one', 'a'), p('two', 'b')]);
    e.commands.deleteBlock(2);
    expect(texts(e)[0]).toBe('two');
    e.commands.deleteBlock(2);
    expect(e.state.doc.childCount).toBeGreaterThanOrEqual(1);
    expect(e.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('turns a paragraph into a heading and a list, and back', () => {
    const e = make([p('hello', 'a')]);
    e.commands.turnInto(2, 'heading', 2);
    expect(e.state.doc.firstChild?.type.name).toBe('heading');
    expect(e.state.doc.firstChild?.attrs['level']).toBe(2);
    e.commands.turnInto(2, 'bulletList');
    expect(e.state.doc.firstChild?.type.name).toBe('bulletList');
    e.commands.turnInto(2, 'paragraph');
    expect(e.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(e.state.doc.firstChild?.textContent).toBe('hello');
  });

  it('keeps ids unique after a split', () => {
    const e = make([p('hello world', 'a')]);
    e.commands.setTextSelection(6);
    e.commands.splitBlock();
    const all = ids(e);
    expect(new Set(all).size).toBe(all.length);
  });
});
```

- [ ] **Step 2: Run — expect failure** (modules missing)

Run: `bun test test/notepadCommands.test.ts`

- [ ] **Step 3: Write `src/doc/topLevel.ts`**

```ts
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

export interface TopLevel {
  /** Index among the document's children. */
  index: number;
  /** Position immediately before the node. */
  from: number;
  node: PMNode;
}

/**
 * The top-level node containing `pos` — a notepad block, or the paragraph /
 * list / table a plain note's caret is in. A position between two top-level
 * nodes resolves to the one after it (or the last one at the very end).
 */
export function topLevelAt(doc: PMNode, pos: number): TopLevel | null {
  if (doc.childCount === 0) return null;
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const index = Math.min(doc.resolve(clamped).index(0), doc.childCount - 1);
  let from = 0;
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
  return { index, from, node: doc.child(index) };
}

/** The `blockId` of the top-level node at `pos` (default: the selection). */
export function blockIdAt(state: EditorState, pos?: number): string | null {
  const top = topLevelAt(state.doc, pos ?? state.selection.from);
  const id = top?.node.attrs['blockId'];
  return typeof id === 'string' ? id : null;
}
```

- [ ] **Step 4: Write `src/custom/notepad/commands.ts`**

```ts
import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { topLevelAt } from '../../doc/topLevel';

export type TurnIntoType =
  | 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockCommands: {
      /** Move the top-level block at `pos` by `delta` places. */
      moveBlock: (pos: number, delta: number) => ReturnType;
      /** Insert a copy of the block after it; UniqueID gives the copy a new id. */
      duplicateBlock: (pos: number) => ReturnType;
      /** Delete the block, leaving an empty paragraph if it was the only one. */
      deleteBlock: (pos: number) => ReturnType;
      /** Convert the block using Tiptap's own commands. */
      turnInto: (pos: number, type: TurnIntoType, level?: 1 | 2 | 3) => ReturnType;
    };
  }
}

/**
 * Block-level operations for notepad mode. Blocks are just the document's
 * top-level nodes, so these are thin wrappers around transactions and
 * Tiptap's built-in node commands — no wrapper node, no normaliser.
 */
export const BlockCommands = Extension.create({
  name: 'blockCommands',

  addCommands() {
    return {
      moveBlock:
        (pos, delta) =>
        ({ state, tr, dispatch }) => {
          const top = topLevelAt(state.doc, pos);
          if (!top) return false;
          const target = top.index + delta;
          if (target < 0 || target >= state.doc.childCount) return false;

          if (dispatch) {
            // Insertion point in post-deletion coordinates: the sizes of the
            // siblings that remain before the target slot.
            const remaining: PMNode[] = [];
            state.doc.forEach((child, _offset, i) => { if (i !== top.index) remaining.push(child); });
            let insertAt = 0;
            for (let i = 0; i < target; i++) insertAt += remaining[i]!.nodeSize;

            tr.delete(top.from, top.from + top.node.nodeSize);
            tr.insert(insertAt, top.node);
            tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
            tr.scrollIntoView();
          }
          return true;
        },

      duplicateBlock:
        (pos) =>
        ({ state, tr, dispatch }) => {
          const top = topLevelAt(state.doc, pos);
          if (!top) return false;
          if (dispatch) {
            const copy = top.node.type.create(
              { ...top.node.attrs, blockId: null },
              top.node.content,
              top.node.marks,
            );
            const after = top.from + top.node.nodeSize;
            tr.insert(after, copy);
            tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
          }
          return true;
        },

      deleteBlock:
        (pos) =>
        ({ state, tr, dispatch }) => {
          const top = topLevelAt(state.doc, pos);
          if (!top) return false;
          if (dispatch) {
            if (state.doc.childCount <= 1) {
              const empty = state.schema.nodes['paragraph']!.create();
              tr.replaceWith(0, state.doc.content.size, empty);
              tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
            } else {
              tr.delete(top.from, top.from + top.node.nodeSize);
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(top.from, tr.doc.content.size)), -1));
            }
          }
          return true;
        },

      turnInto:
        (pos, type, level) =>
        ({ state, tr, chain }) => {
          const top = topLevelAt(state.doc, pos);
          if (!top || top.node.isAtom) return false;

          // Select the whole block, flatten it to paragraphs with the official
          // clearNodes, then apply the target type across the selection.
          const from = top.from + 1;
          const to = top.from + top.node.nodeSize - 1;
          tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)));

          const c = chain().clearNodes();
          switch (type) {
            case 'paragraph':   return c.setParagraph().run();
            case 'heading':     return c.setHeading({ level: level ?? 1 }).run();
            case 'bulletList':  return c.toggleBulletList().run();
            case 'orderedList': return c.toggleOrderedList().run();
            case 'taskList':    return c.toggleTaskList().run();
            case 'blockquote':  return c.setBlockquote().run();
            case 'codeBlock':   return c.setCodeBlock().run();
          }
        },
    };
  },
});
```

- [ ] **Step 5: Run — expect pass**

Run: `bun test test/notepadCommands.test.ts` → `7 pass`.
If `turnInto(…, 'paragraph')` leaves a list: the selection did not cover the list item text; check that `TextSelection.between` resolved inside the list (log `tr.selection.from/to`) before touching anything else.

- [ ] **Step 6: Commit**

```bash
git add src/doc/topLevel.ts src/custom/notepad/commands.ts test/notepadCommands.test.ts
git commit -m "Add top-level block helpers and notepad block commands"
```

---

### Task 5: Wiki links on Mention

**Files:**
- Create: `src/custom/links/wikiLink.tsx`, `src/custom/links/WikiLinkView.tsx`, `src/ui/suggestionPopup.tsx`, `src/ui/SuggestionList.tsx`
- Test: `test/wikiLink.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'bun:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createFakeHost } from '../src/testing/fakeHost';
import { noopEvents, type ShuttleContextRef } from '../src/context';
import { wikiLink, WIKI_TRIGGER } from '../src/custom/links/wikiLink';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

function make(): Editor {
  const ctx: ShuttleContextRef = { current: { host: createFakeHost(), events: noopEvents, docKey: 'n-self' } };
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, wikiLink(ctx, { reactViews: false })],
    content: '<p></p>',
  });
  return editor;
}

function typeText(e: Editor, text: string): void {
  // Input rules run from handleTextInput, one character at a time.
  for (const ch of text) {
    const { from, to } = e.state.selection;
    const handled = e.view.someProp('handleTextInput', (f) => f(e.view, from, to, ch, () => e.state.tr.insertText(ch, from, to)));
    if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to));
  }
}

const mentions = (e: Editor) => {
  const out: Record<string, unknown>[] = [];
  e.state.doc.descendants((n) => { if (n.type.name === 'mention') out.push(n.attrs); });
  return out;
};

describe('wiki links', () => {
  it('uses [[ as the suggestion trigger', () => {
    expect(WIKI_TRIGGER).toBe('[[');
  });

  it('converts a typed [[Title]] to a mention', () => {
    const e = make();
    typeText(e, 'see [[Alpha]]');
    expect(mentions(e)).toEqual([
      { id: 'n-alpha', label: 'Alpha', displayText: null, mentionSuggestionChar: '[[' },
    ]);
  });

  it('keeps an alias from [[Title|alias]]', () => {
    const e = make();
    typeText(e, '[[beta|the second]]');
    expect(mentions(e)[0]).toMatchObject({ id: 'n-beta', displayText: 'the second' });
  });

  it('leaves unknown titles as text', () => {
    const e = make();
    typeText(e, '[[Nope]]');
    expect(mentions(e)).toEqual([]);
    expect(e.getText()).toBe('[[Nope]]');
  });

  it('renders [[label|alias]] as plain text', () => {
    const e = make();
    typeText(e, '[[beta|the second]]');
    expect(e.getText()).toBe('[[Beta|the second]]');
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test test/wikiLink.test.ts`

- [ ] **Step 3: Write `src/ui/SuggestionList.tsx`**

```tsx
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';

export interface KeyHandlerRef {
  onKeyDown(args: { event: KeyboardEvent }): boolean;
}

export interface SuggestionListProps<Item> {
  items: Item[];
  command: (item: Item) => void;
}

export interface ListRenderSpec<Item> {
  itemKey: (item: Item) => string;
  renderItem: (item: Item) => ReactNode;
  group?: (item: Item) => string | undefined;
  header?: ReactNode;
  empty: string;
}

/**
 * Keyboard-navigable suggestion list shared by the slash menu and `[[` links.
 * The popup forwards arrow keys and Enter through the imperative handle.
 */
export function createSuggestionList<Item>(spec: ListRenderSpec<Item>) {
  const List = forwardRef<KeyHandlerRef, SuggestionListProps<Item>>(({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => setSelected(0), [items]);
    useEffect(() => { itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' }); }, [selected]);

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (items.length === 0) return false;
        if (event.key === 'ArrowUp') { setSelected((i) => (i - 1 + items.length) % items.length); return true; }
        if (event.key === 'ArrowDown') { setSelected((i) => (i + 1) % items.length); return true; }
        if (event.key === 'Enter') { const item = items[selected]; if (item) command(item); return true; }
        return false;
      },
    }));

    if (items.length === 0) {
      return <div className="sh-popup"><div className="sh-popup-empty">{spec.empty}</div></div>;
    }

    let lastGroup: string | undefined;
    return (
      <div className="sh-popup">
        {spec.header}
        {items.map((item, i) => {
          const group = spec.group?.(item);
          const showGroup = group !== undefined && group !== lastGroup;
          lastGroup = group;
          return (
            <div key={spec.itemKey(item)}>
              {showGroup && <div className="sh-popup-group">{group}</div>}
              <button
                type="button"
                ref={(el) => { itemRefs.current[i] = el; }}
                className={`sh-popup-item${i === selected ? ' is-selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => command(item)}
              >
                {spec.renderItem(item)}
              </button>
            </div>
          );
        })}
      </div>
    );
  });
  List.displayName = 'SuggestionList';
  return List;
}
```

- [ ] **Step 4: Write `src/ui/suggestionPopup.tsx`**

```tsx
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import type { KeyHandlerRef, SuggestionListProps } from './SuggestionList';

export interface PopupSize {
  maxHeight: number;
  maxWidth: number;
}

type ListComponent<Item> = ForwardRefExoticComponent<SuggestionListProps<Item> & RefAttributes<KeyHandlerRef>>;

/**
 * Suggestion `render` factory: mounts the list in a fixed-position wrapper,
 * flips it above the caret when there is no room below and keeps it on screen.
 */
export function suggestionPopup<Item>(List: ListComponent<Item>, size: PopupSize) {
  return () => {
    let renderer: ReactRenderer<KeyHandlerRef, SuggestionListProps<Item>> | null = null;
    let wrapper: HTMLDivElement | null = null;

    const place = (clientRect: (() => DOMRect | null) | null | undefined): void => {
      const rect = clientRect?.();
      if (!wrapper || !rect) return;
      const below = rect.bottom + 4;
      const top = below + size.maxHeight > window.innerHeight ? rect.top - size.maxHeight - 4 : below;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - size.maxWidth - 8));
      wrapper.style.top = `${top}px`;
      wrapper.style.left = `${left}px`;
    };

    const close = (): void => {
      wrapper?.remove();
      renderer?.destroy();
      wrapper = null;
      renderer = null;
    };

    return {
      onStart(props: SuggestionProps<Item, Item>) {
        renderer = new ReactRenderer(List, {
          props: { items: props.items, command: props.command },
          editor: props.editor,
        });
        wrapper = document.createElement('div');
        wrapper.className = 'sh-popup-anchor';
        wrapper.appendChild(renderer.element);
        document.body.appendChild(wrapper);
        place(props.clientRect);
      },
      onUpdate(props: SuggestionProps<Item, Item>) {
        renderer?.updateProps({ items: props.items, command: props.command });
        place(props.clientRect);
      },
      onKeyDown(props: SuggestionKeyDownProps): boolean {
        if (props.event.key === 'Escape') { close(); return true; }
        return renderer?.ref?.onKeyDown({ event: props.event }) ?? false;
      },
      onExit: close,
    };
  };
}
```

- [ ] **Step 5: Write `src/custom/links/WikiLinkView.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import type { ShuttleContextRef } from '../../context';

/**
 * Click opens the linked note; double-click edits the alias in place.
 * The context ref arrives through the extension's options.
 */
export default function WikiLinkView({ node, updateAttributes, extension }: NodeViewProps) {
  const ctx = (extension.options as { ctx: ShuttleContextRef }).ctx;
  const label = (node.attrs['label'] as string | null) ?? 'Untitled';
  const alias = node.attrs['displayText'] as string | null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(alias ?? label);
    requestAnimationFrame(() => input.current?.select());
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (): void => {
    const next = draft.trim();
    updateAttributes({ displayText: next && next !== label ? next : null });
    setEditing(false);
  };

  return (
    <NodeViewWrapper as="span" className="sh-wikilink" data-type="mention">
      {editing ? (
        <input
          ref={input}
          className="sh-wikilink-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          }}
        />
      ) : (
        <span
          className="sh-wikilink-label"
          title={alias ? `${alias} → ${label}` : label}
          onClick={(e) => {
            e.preventDefault();
            const id = node.attrs['id'] as string | null;
            if (id) ctx.current.host.openNote(id);
          }}
          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
        >
          {alias ?? label}
        </span>
      )}
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 6: Write `src/custom/links/wikiLink.tsx`**

```tsx
import { InputRule, mergeAttributes, type JSONContent } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { ShuttleContextRef } from '../../context';
import type { NoteRef } from '../../host';
import { createSuggestionList } from '../../ui/SuggestionList';
import { suggestionPopup } from '../../ui/suggestionPopup';
import WikiLinkView from './WikiLinkView';

export const WIKI_TRIGGER = '[[';
export const wikiLinkPluginKey = new PluginKey('wikiLinkSuggestion');

const TYPED_LINK = /\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]$/;
const MARKDOWN_LINK = /^\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/;

export interface ViewOptions {
  /** False in tests: React node views need a mounted EditorContent. */
  reactViews: boolean;
}

/** Attributes of a wiki-link mention, as stored in the document. */
export function wikiAttrs(note: NoteRef, displayText: string | null): Record<string, unknown> {
  return { id: note.id, label: note.title || 'Untitled', displayText, mentionSuggestionChar: WIKI_TRIGGER };
}

const renderLinkText = (attrs: Record<string, unknown>): string => {
  const label = (attrs['label'] as string | null) ?? '';
  const alias = attrs['displayText'] as string | null;
  return `[[${label}${alias ? `|${alias}` : ''}]]`;
};

const NoteList = createSuggestionList<NoteRef>({
  itemKey: (n) => n.id,
  renderItem: (n) => (<><span className="sh-popup-icon">[[</span><span>{n.title || 'Untitled'}</span></>),
  header: <div className="sh-popup-header">Link to note <span className="sh-popup-hint">[[title|alias]]</span></div>,
  empty: 'No matching notes',
});

/**
 * `[[Note]]` links: the official Mention node with a `[[` trigger, an alias
 * attribute, typed-link input rules, a React view and markdown support.
 * Stored as `{ type: 'mention', attrs: { id, label, displayText, mentionSuggestionChar } }`.
 */
export function wikiLink(ctx: ShuttleContextRef, view: ViewOptions) {
  return Mention.extend({
    addOptions() {
      return { ...this.parent!(), ctx };
    },

    addAttributes() {
      return {
        ...this.parent?.(),
        displayText: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-display-text'),
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs['displayText'] ? { 'data-display-text': attrs['displayText'] } : {},
        },
      };
    },

    ...(view.reactViews ? { addNodeView: () => ReactNodeViewRenderer(WikiLinkView, { as: 'span' }) } : {}),

    addInputRules() {
      return [
        new InputRule({
          find: TYPED_LINK,
          handler: ({ state, range, match }) => {
            const note = ctx.current.host.findNoteByTitle((match[1] ?? '').trim());
            if (!note) return null;
            const alias = (match[2] ?? '').trim() || null;
            state.tr.replaceWith(range.from, range.to, this.type.create(wikiAttrs(note, alias)));
          },
        }),
      ];
    },

    markdownTokenName: 'wikiLink',
    markdownTokenizer: {
      name: 'wikiLink',
      level: 'inline',
      start: (src: string) => src.indexOf('[['),
      tokenize: (src: string) => {
        const m = MARKDOWN_LINK.exec(src);
        if (!m) return undefined;
        return { type: 'wikiLink', raw: m[0], title: (m[1] ?? '').trim(), alias: (m[2] ?? '').trim() || null };
      },
    },
    parseMarkdown: (token, helpers) => {
      const note = ctx.current.host.findNoteByTitle(String(token['title'] ?? ''));
      if (!note) return helpers.createTextNode(String(token.raw ?? ''));
      return helpers.createNode('mention', wikiAttrs(note, (token['alias'] as string | null) ?? null));
    },
    renderMarkdown: (node: JSONContent) => renderLinkText(node.attrs ?? {}),
  }).configure({
    renderText: ({ node }) => renderLinkText(node.attrs),
    renderHTML: ({ options, node }) => [
      'span',
      mergeAttributes({ 'data-type': 'mention' }, options.HTMLAttributes),
      (node.attrs['displayText'] as string | null) ?? (node.attrs['label'] as string | null) ?? '',
    ],
    suggestion: {
      char: WIKI_TRIGGER,
      pluginKey: wikiLinkPluginKey,
      allowSpaces: true,
      items: async ({ query }: { query: string }) => (await ctx.current.host.searchNotes(query))
        .filter((n) => n.id !== ctx.current.docKey)
        .slice(0, 8),
      command: ({ editor, range, props }) => {
        const note = props as unknown as NoteRef;
        editor.chain().focus().insertContentAt(range, [
          { type: 'mention', attrs: wikiAttrs(note, null) },
          { type: 'text', text: ' ' },
        ]).run();
      },
      render: suggestionPopup(NoteList, { maxHeight: 280, maxWidth: 280 }),
    },
  });
}
```

- [ ] **Step 7: Run — expect pass**

Run: `bun test test/wikiLink.test.ts` → `5 pass`.
If TypeScript rejects `markdownTokenName`/`parseMarkdown` inside `extend`, check `NodeConfig` in `node_modules/@tiptap/core/dist/index.d.ts` (search `markdownTokenizer?:`) — the fields exist there in 3.31; a mismatch means the installed core is older than 3.31.

- [ ] **Step 8: Commit**

```bash
git add src/custom/links src/ui test/wikiLink.test.ts
git commit -m "Add [[wiki links]] on the official Mention node"
```

---

### Task 6: Fragment link and block reference nodes

**Files:**
- Create: `src/custom/links/fragmentLink.tsx`, `src/custom/blockRef/blockRef.tsx`, `src/custom/blockRef/BlockRefView.tsx`
- Test: `test/customNodes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'bun:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createFakeHost } from '../src/testing/fakeHost';
import { noopEvents, type ShuttleContextRef } from '../src/context';
import { fragmentLink } from '../src/custom/links/fragmentLink';
import { blockRef } from '../src/custom/blockRef/blockRef';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

function make(): Editor {
  const ctx: ShuttleContextRef = { current: { host: createFakeHost(), events: noopEvents, docKey: 'n-self' } };
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, fragmentLink(ctx, { reactViews: false }), blockRef(ctx, { reactViews: false })],
    content: '<p>x</p>',
  });
  return editor;
}

describe('fragment links', () => {
  it('inserts a fragment link with its attributes', () => {
    const e = make();
    e.commands.setTextSelection(2);
    e.commands.insertFragmentLink({ linkId: 'l1', toNoteId: 'n-beta', toFragmentId: 'b9', label: 'Beta §' });
    const json = JSON.stringify(e.getJSON());
    expect(json).toContain('"type":"fragmentLink"');
    expect(json).toContain('"linkId":"l1"');
  });
});

describe('block references', () => {
  it('inserts a transclusion that stores ids only', () => {
    const e = make();
    e.commands.insertBlockRef('b1', 'n-beta');
    const found: Record<string, unknown>[] = [];
    e.state.doc.descendants((n) => { if (n.type.name === 'blockRef') found.push(n.attrs); });
    expect(found).toEqual([{ refBlockId: 'b1', refNoteId: 'n-beta' }]);
  });

  it('renders its ids as data attributes', () => {
    const e = make();
    e.commands.insertBlockRef('b1', 'n-beta');
    expect(e.getHTML()).toContain('data-ref-block-id="b1"');
  });
});
```

(UniqueID is absent in this isolated test, so no `blockId` attribute exists here; the full build in Task 10 checks ids.)

- [ ] **Step 2: Run — expect failure**

Run: `bun test test/customNodes.test.ts`

- [ ] **Step 3: Write `src/custom/links/fragmentLink.tsx`**

```tsx
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import type { ShuttleContextRef } from '../../context';
import type { ViewOptions } from './wikiLink';

export interface FragmentLinkAttrs {
  linkId: string;
  toNoteId: string;
  toFragmentId: string | null;
  label: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fragmentLink: {
      /** Insert a link to a note or to one of its blocks at the selection. */
      insertFragmentLink: (attrs: FragmentLinkAttrs) => ReturnType;
    };
  }
}

function FragmentLinkView({ node, extension }: NodeViewProps) {
  const ctx = (extension.options as { ctx: ShuttleContextRef }).ctx;
  const toNoteId = node.attrs['toNoteId'] as string | null;
  const toFragmentId = node.attrs['toFragmentId'] as string | null;
  const label = (node.attrs['label'] as string) || (toFragmentId ? 'fragment' : 'note');
  return (
    <NodeViewWrapper as="span" className="sh-fragment-link">
      <span
        onClick={(e) => {
          e.preventDefault();
          if (toNoteId) ctx.current.host.openNote(toNoteId, toFragmentId ?? undefined);
        }}
      >
        {label}
      </span>
    </NodeViewWrapper>
  );
}

/**
 * A link to a note or a block of a note, created by the host's fragment UI.
 * Removal is reported to the host by `ShuttleEditor` via `linkId`.
 */
export function fragmentLink(ctx: ShuttleContextRef, view: ViewOptions) {
  return Node.create({
    name: 'fragmentLink',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addOptions() {
      return { ctx };
    },

    addAttributes() {
      return {
        linkId: { default: null },
        toNoteId: { default: null },
        toFragmentId: { default: null },
        label: { default: '' },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-fragment-link]' }];
    },

    renderHTML({ HTMLAttributes, node }) {
      return ['span', mergeAttributes({ 'data-fragment-link': '' }, HTMLAttributes), String(node.attrs['label'] ?? '')];
    },

    renderText({ node }) {
      return String(node.attrs['label'] ?? '');
    },

    renderMarkdown: (node) => String(node.attrs?.['label'] ?? ''),

    ...(view.reactViews ? { addNodeView: () => ReactNodeViewRenderer(FragmentLinkView, { as: 'span' }) } : {}),

    addCommands() {
      return {
        insertFragmentLink:
          (attrs) =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { ...attrs } }),
      };
    },
  });
}
```

- [ ] **Step 4: Write `src/custom/blockRef/BlockRefView.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { DOMSerializer } from '@tiptap/pm/model';
import { ArrowUpRight, Link2Off } from 'lucide-react';
import type { ShuttleContextRef } from '../../context';
import type { ResolvedBlock } from '../../host';

/**
 * Read-only transclusion. The source block is rendered through this editor's
 * own schema, so it looks exactly as it does in its home note.
 */
export default function BlockRefView({ node, editor, extension }: NodeViewProps) {
  const ctx = (extension.options as { ctx: ShuttleContextRef }).ctx;
  const refBlockId = node.attrs['refBlockId'] as string | null;
  const [target, setTarget] = useState<ResolvedBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!refBlockId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    ctx.current.host.resolveBlock(refBlockId)
      .then((r) => { if (!cancelled) setTarget(r); })
      .catch((error: unknown) => {
        ctx.current.host.log('warn', 'Block reference failed to resolve', { refBlockId, error: String(error) });
        if (!cancelled) setTarget(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refBlockId, ctx]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    el.replaceChildren();
    if (!target) return;
    try {
      const content = editor.schema.nodeFromJSON(target.content);
      el.appendChild(DOMSerializer.fromSchema(editor.schema).serializeNode(content));
    } catch {
      // Stored shape no longer parses against this schema: treat as unresolved.
      setTarget(null);
    }
  }, [target, editor]);

  if (loading) {
    return <NodeViewWrapper className="sh-blockref" contentEditable={false}><div className="sh-blockref-status">Resolving reference…</div></NodeViewWrapper>;
  }

  if (!target) {
    return (
      <NodeViewWrapper className="sh-blockref is-missing" contentEditable={false}>
        <div className="sh-blockref-status"><Link2Off size={13} strokeWidth={1.75} /> Block not found</div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="sh-blockref" contentEditable={false}>
      <button
        type="button"
        className="sh-blockref-source"
        onClick={() => ctx.current.host.openNote(target.noteId, target.blockId)}
        title="Open the source block"
      >
        {target.noteTitle || 'Untitled'} <ArrowUpRight size={12} strokeWidth={2} />
      </button>
      <div className="sh-blockref-body" ref={body} />
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 5: Write `src/custom/blockRef/blockRef.tsx`**

```tsx
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { ShuttleContextRef } from '../../context';
import type { ViewOptions } from '../links/wikiLink';
import BlockRefView from './BlockRefView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockRef: {
      /** Insert a read-only transclusion of another note's block. */
      insertBlockRef: (refBlockId: string, refNoteId: string) => ReturnType;
    };
  }
}

const MARKDOWN_REF = /^!\[\[([\w-]+)#([\w:-]+)\]\](?:\n|$)/;

/**
 * Transclusion by reference: stores `refBlockId` and `refNoteId`, never the
 * content, so it cannot go stale. Markdown form: `![[noteId#blockId]]`.
 */
export function blockRef(ctx: ShuttleContextRef, view: ViewOptions) {
  return Node.create({
    name: 'blockRef',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,

    addOptions() {
      return { ctx };
    },

    addAttributes() {
      return {
        refBlockId: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-ref-block-id'),
          renderHTML: (attrs: Record<string, unknown>) => ({ 'data-ref-block-id': attrs['refBlockId'] }),
        },
        refNoteId: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-ref-note-id'),
          renderHTML: (attrs: Record<string, unknown>) => ({ 'data-ref-note-id': attrs['refNoteId'] }),
        },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-block-ref]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-block-ref': '' })];
    },

    markdownTokenName: 'blockRef',
    markdownTokenizer: {
      name: 'blockRef',
      level: 'block',
      start: (src: string) => src.indexOf('![['),
      tokenize: (src: string) => {
        const m = MARKDOWN_REF.exec(src);
        if (!m) return undefined;
        return { type: 'blockRef', raw: m[0], noteId: m[1], blockId: m[2] };
      },
    },
    parseMarkdown: (token, helpers) =>
      helpers.createNode('blockRef', { refNoteId: token['noteId'], refBlockId: token['blockId'] }),
    renderMarkdown: (node) => `![[${String(node.attrs?.['refNoteId'] ?? '')}#${String(node.attrs?.['refBlockId'] ?? '')}]]`,

    ...(view.reactViews ? { addNodeView: () => ReactNodeViewRenderer(BlockRefView) } : {}),

    addCommands() {
      return {
        insertBlockRef:
          (refBlockId, refNoteId) =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { refBlockId, refNoteId } }),
      };
    },
  });
}
```

- [ ] **Step 6: Run — expect pass** (adjust the `blockId` expectation as noted in Step 1)

Run: `bun test test/customNodes.test.ts` → `3 pass`.

- [ ] **Step 7: Commit**

```bash
git add src/custom/links/fragmentLink.tsx src/custom/blockRef test/customNodes.test.ts
git commit -m "Add fragment link and block reference nodes"
```

---

### Task 7: Image upload glue

**Files:**
- Create: `src/custom/image/image.ts`, `src/custom/image/upload.ts`
- Test: `test/image.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'bun:test';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createFakeHost, type FakeHost } from '../src/testing/fakeHost';
import { noopEvents, type ShuttleContextRef } from '../src/context';
import { shuttleImage } from '../src/custom/image/image';
import { insertImageFiles, stripPendingUploads } from '../src/custom/image/upload';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function make(host: FakeHost): { e: Editor; ctx: ShuttleContextRef } {
  const ctx: ShuttleContextRef = { current: { host, events: noopEvents, docKey: 'n' } };
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, shuttleImage(ctx)],
    content: '<p>x</p>',
  });
  return { e: editor, ctx };
}

const images = (e: Editor) => {
  const out: Record<string, unknown>[] = [];
  e.state.doc.descendants((n) => { if (n.type.name === 'image') out.push(n.attrs); });
  return out;
};

const png = () => new File(['x'], 'pic.png', { type: 'image/png' });

describe('image upload', () => {
  it('replaces the preview with the uploaded src', async () => {
    const host = createFakeHost();
    const { e, ctx } = make(host);
    await insertImageFiles(e, ctx, [png()]);
    await sleep(0);
    expect(images(e)[0]).toMatchObject({ src: 'attachment:up1', uploadId: null, uploadError: false });
  });

  it('marks a failed upload and logs it', async () => {
    const host = createFakeHost({ uploadFails: true });
    const { e, ctx } = make(host);
    await insertImageFiles(e, ctx, [png()]);
    await sleep(0);
    expect(images(e)[0]).toMatchObject({ uploadError: true });
    expect(host.calls.logs[0]?.level).toBe('error');
  });

  it('resolves stored src through the host when rendering', () => {
    const host = createFakeHost();
    const { e } = make(host);
    e.commands.setContent({ type: 'doc', content: [{ type: 'image', attrs: { src: 'attachment:abc' } }] });
    expect(e.getHTML()).toContain('src="https://fake.local/abc"');
    expect(JSON.stringify(e.getJSON())).toContain('"src":"attachment:abc"');
  });

  it('ignores non-image files', async () => {
    const { e, ctx } = make(createFakeHost());
    await insertImageFiles(e, ctx, [new File(['x'], 'a.txt', { type: 'text/plain' })]);
    expect(images(e)).toEqual([]);
  });
});

describe('stripPendingUploads', () => {
  it('drops images still uploading and keeps a valid doc', () => {
    const doc: JSONContent = { type: 'doc', content: [{ type: 'image', attrs: { src: 'blob:1', uploadId: 'u1' } }] };
    expect(stripPendingUploads(doc)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
  it('keeps finished images', () => {
    const doc: JSONContent = { type: 'doc', content: [{ type: 'image', attrs: { src: 'attachment:a', uploadId: null } }] };
    expect(stripPendingUploads(doc)).toEqual(doc);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test test/image.test.ts`

- [ ] **Step 3: Write `src/custom/image/upload.ts`**

```ts
import type { Editor, JSONContent } from '@tiptap/core';
import { nanoid } from 'nanoid';
import type { ShuttleContextRef } from '../../context';

interface Pending {
  file: File;
  preview: string;
}

/** Files of uploads still in flight or failed, per editor, for retry. */
const pendingByEditor = new WeakMap<Editor, Map<string, Pending>>();

function pendingFor(editor: Editor): Map<string, Pending> {
  let map = pendingByEditor.get(editor);
  if (!map) { map = new Map(); pendingByEditor.set(editor, map); }
  return map;
}

function setImageAttrs(editor: Editor, uploadId: string, attrs: Record<string, unknown>): void {
  if (editor.isDestroyed) return;
  const { tr } = editor.state;
  let found = false;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs['uploadId'] === uploadId) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
      found = true;
    }
  });
  if (found) editor.view.dispatch(tr);
}

async function runUpload(editor: Editor, ctx: ShuttleContextRef, uploadId: string): Promise<void> {
  const pending = pendingFor(editor).get(uploadId);
  if (!pending) return;
  try {
    const { src } = await ctx.current.host.uploadFile(pending.file);
    setImageAttrs(editor, uploadId, { src, uploadId: null, uploadError: false });
    URL.revokeObjectURL(pending.preview);
    pendingFor(editor).delete(uploadId);
  } catch (error) {
    ctx.current.host.log('error', 'Image upload failed', { name: pending.file.name, error: String(error) });
    setImageAttrs(editor, uploadId, { uploadError: true });
  }
}

/**
 * Insert image files at `pos` (or the selection) and upload them. Each image
 * shows a local preview until the host returns its permanent `src`.
 */
export async function insertImageFiles(
  editor: Editor,
  ctx: ShuttleContextRef,
  files: File[],
  pos?: number,
): Promise<void> {
  const uploads: Promise<void>[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const uploadId = nanoid(10);
    const preview = URL.createObjectURL(file);
    pendingFor(editor).set(uploadId, { file, preview });
    const node = { type: 'image', attrs: { src: preview, alt: file.name, uploadId } };
    if (pos === undefined) editor.chain().focus().insertContent(node).run();
    else editor.chain().insertContentAt(pos, node).run();
    uploads.push(runUpload(editor, ctx, uploadId));
  }
  await Promise.all(uploads);
}

/** Retry a failed upload, if its file is still held. */
export function retryUpload(editor: Editor, ctx: ShuttleContextRef, uploadId: string): void {
  if (!pendingFor(editor).has(uploadId)) return;
  setImageAttrs(editor, uploadId, { uploadError: false });
  void runUpload(editor, ctx, uploadId);
}

/**
 * The document as it should be saved: images without a permanent `src` yet
 * (uploading or failed) are left out, so nothing points at a blob URL.
 */
export function stripPendingUploads(doc: JSONContent): JSONContent {
  const walk = (node: JSONContent): JSONContent | null => {
    if (node.type === 'image' && node.attrs?.['uploadId']) return null;
    if (!node.content) return node;
    const content = node.content.map(walk).filter((n): n is JSONContent => n !== null);
    return { ...node, content };
  };
  const out = walk(doc) ?? { type: 'doc', content: [] };
  if (out.type === 'doc' && (out.content?.length ?? 0) === 0) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return out;
}
```

- [ ] **Step 4: Write `src/custom/image/image.ts`**

```ts
import Image from '@tiptap/extension-image';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { ShuttleContextRef } from '../../context';
import { retryUpload } from './upload';

/**
 * The official Image node with three additions: stored `src` values are
 * resolved through the host when rendered, uploads carry transient
 * `uploadId` / `uploadError` attributes, and clicking a failed image retries.
 */
export function shuttleImage(ctx: ShuttleContextRef) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('src'),
          renderHTML: (attrs: Record<string, unknown>) => {
            const src = attrs['src'] as string | null;
            return src ? { src: ctx.current.host.resolveFileSrc(src) } : {};
          },
        },
        uploadId: { default: null, rendered: false },
        uploadError: {
          default: false,
          renderHTML: (attrs: Record<string, unknown>) => (attrs['uploadError'] ? { 'data-upload-error': '' } : {}),
        },
      };
    },

    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        ...(this.parent?.() ?? []),
        new Plugin({
          key: new PluginKey('imageRetry'),
          props: {
            handleClickOn(_view, _pos, node) {
              const uploadId = node.attrs['uploadId'] as string | null;
              if (node.type.name !== 'image' || !node.attrs['uploadError'] || !uploadId) return false;
              retryUpload(editor, ctx, uploadId);
              return true;
            },
          },
        }),
      ];
    },
  }).configure({ allowBase64: false });
}
```

- [ ] **Step 5: Run — expect pass**

Run: `bun test test/image.test.ts` → `6 pass`.
If `URL.createObjectURL` is undefined under happy-dom, add to `test/setup.ts`: `URL.createObjectURL ??= () => 'blob:test'; URL.revokeObjectURL ??= () => {};`.

- [ ] **Step 6: Commit**

```bash
git add src/custom/image test/image.test.ts test/setup.ts
git commit -m "Add image upload glue on the official Image node"
```

---

### Task 8: Markdown glue — details syntax and clipboard

**Files:**
- Create: `src/custom/markdown/details.ts`, `src/custom/markdown/clipboard.ts`
- Test: `test/looksLikeMarkdown.test.ts` (round trips are tested in Task 10 with the full build)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { looksLikeMarkdown } from '../src/custom/markdown/clipboard';

describe('looksLikeMarkdown', () => {
  it.each([
    '# Title', '- item', '1. first', '> quote', '```js', '---', '**bold** text',
    '[a](https://x.y)', '- [ ] task', '| a | b |', '==mark==', '[[Alpha]]', '$$\nx\n$$', ':::details S',
  ])('detects %p', (s) => expect(looksLikeMarkdown(s)).toBe(true));

  it.each(['plain words', 'a ** b ** c', '__init__', 'costs $5 and $6'])('ignores %p', (s) =>
    expect(looksLikeMarkdown(s)).toBe(false));
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test test/looksLikeMarkdown.test.ts`

- [ ] **Step 3: Write `src/custom/markdown/clipboard.ts`**

```ts
import { Extension, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Conservative markers that plain text is markdown rather than prose with
 * punctuation. A false positive rewrites text the user wanted verbatim, which
 * is worse than a missed conversion.
 */
const MARKDOWN_PATTERNS: RegExp[] = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+\.\s+\S/m,
  /^\s*>\s+\S/m,
  /^\s*```/m,
  /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m,
  /\*\*\S[^*\n]*\*\*/,
  /\[[^\]\n]+\]\([^)\n]+\)/,
  /^\s*[-*+]\s+\[[ xX]\]\s/m,
  /^\s*\|.+\|\s*$/m,
  /==\S[^=\n]*==/,
  /\[\[[^[\]\n]+\]\]/,
  /^\s*\$\$/m,
  /^:::details/m,
];

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_PATTERNS.some((re) => re.test(text));
}

/**
 * Plain-text paste that looks like markdown becomes real nodes through the
 * official Markdown extension; copying produces markdown text. Rich (HTML)
 * pastes and file pastes are left to ProseMirror and FileHandler.
 */
export const MarkdownClipboard = Extension.create({
  name: 'markdownClipboard',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('markdownClipboard'),
        props: {
          handlePaste(_view, event) {
            const data = event.clipboardData;
            if (!data || data.files.length > 0) return false;
            if (Array.from(data.types).includes('text/html')) return false;
            const text = data.getData('text/plain');
            if (!text || !looksLikeMarkdown(text)) return false;
            try {
              return editor.commands.insertContent(text, { contentType: 'markdown' });
            } catch {
              return false;
            }
          },
          clipboardTextSerializer(slice) {
            try {
              const manager = editor.markdown;
              if (!manager) throw new Error('markdown manager missing');
              return manager.serialize({ type: 'doc', content: slice.content.toJSON() as JSONContent[] });
            } catch {
              return slice.content.textBetween(0, slice.content.size, '\n\n');
            }
          },
        },
      }),
    ];
  },
});
```

- [ ] **Step 4: Write `src/custom/markdown/details.ts`**

```ts
import { Details } from '@tiptap/extension-details';
import type { JSONContent } from '@tiptap/core';

const DETAILS_BLOCK = /^:::details[ \t]*([^\n]*)\n([\s\S]*?)\n:::[ \t]*(?:\n|$)/;

const textOf = (node: JSONContent | undefined): string =>
  (node?.content ?? []).map((c) => c.text ?? textOf(c)).join('');

/**
 * Details (toggle) blocks with a markdown form:
 *
 *   :::details Summary text
 *   Body markdown
 *   :::
 */
export const ShuttleDetails = Details.extend({
  markdownTokenName: 'details',
  markdownTokenizer: {
    name: 'details',
    level: 'block',
    start: (src: string) => src.indexOf(':::details'),
    tokenize: (src: string, _tokens, lexer) => {
      const m = DETAILS_BLOCK.exec(src);
      if (!m) return undefined;
      return { type: 'details', raw: m[0], summary: (m[1] ?? '').trim(), tokens: lexer.blockTokens(m[2] ?? '') };
    },
  },
  parseMarkdown: (token, helpers) => {
    const summary = String(token['summary'] ?? '');
    const body = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode('details', {}, [
      helpers.createNode('detailsSummary', {}, summary ? [helpers.createTextNode(summary)] : []),
      helpers.createNode('detailsContent', {}, body.length > 0 ? body : [{ type: 'paragraph' }]),
    ]);
  },
  renderMarkdown: (node: JSONContent, helpers) => {
    const [summary, content] = node.content ?? [];
    const body = helpers.renderChildren(content?.content ?? [], '\n\n');
    return `:::details ${textOf(summary)}\n${body}\n:::`;
  },
}).configure({ persist: true, HTMLAttributes: { class: 'sh-details' } });
```

- [ ] **Step 5: Run — expect pass**

Run: `bun test test/looksLikeMarkdown.test.ts` → `18 pass`.

- [ ] **Step 6: Commit**

```bash
git add src/custom/markdown test/looksLikeMarkdown.test.ts
git commit -m "Add markdown clipboard and details markdown syntax"
```

---

### Task 9: Unlinked mentions, keybindings, slash menu

**Files:**
- Create: `src/custom/unlinkedMentions.ts`, `src/custom/keybindings/keybindings.ts`, `src/custom/slash/items.tsx`, `src/custom/slash/slash.ts`
- Test: `test/behaviour.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'bun:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { createFakeHost } from '../src/testing/fakeHost';
import { noopEvents, type ShuttleContextRef } from '../src/context';
import { unlinkedMentions } from '../src/custom/unlinkedMentions';
import { keybindings } from '../src/custom/keybindings/keybindings';
import { slashCommand, slashPluginKey } from '../src/custom/slash/slash';
import { filterSlashItems } from '../src/custom/slash/items';
import { BlockCommands } from '../src/custom/notepad/commands';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

function make(ctx: ShuttleContextRef, mode: 'note' | 'notepad' = 'note'): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, TaskList, TaskItem, BlockCommands, unlinkedMentions(ctx), keybindings(ctx, mode), slashCommand(ctx, mode)],
    content: '<p>Alpha meets Gamma Ray here</p>',
  });
  return editor;
}

const ctxWith = (overrides = {}): ShuttleContextRef => {
  const host = createFakeHost();
  host.keybindings = overrides;
  return { current: { host, events: noopEvents, docKey: 'n-alpha' } };
};

const press = (e: Editor, key: string, mods: Partial<KeyboardEventInit> = {}) =>
  e.view.someProp('handleKeyDown', (f) => f(e.view, new KeyboardEvent('keydown', { key, ...mods })));

describe('unlinked mentions', () => {
  it('highlights other notes named in the text, skipping the current note', () => {
    const e = make(ctxWith());
    const html = e.view.dom.innerHTML;
    expect(html).toContain('unlinked-mention');
    expect(e.view.dom.querySelectorAll('.unlinked-mention').length).toBe(1); // "Gamma Ray", not "Alpha"
  });
});

describe('keybindings', () => {
  it('applies a default binding', () => {
    const e = make(ctxWith());
    e.commands.selectAll();
    press(e, 'b', { ctrlKey: true });
    expect(e.isActive('bold')).toBe(true);
  });

  it('honours an override and swallows the displaced default', () => {
    const e = make(ctxWith({ 'editor.bold': 'Mod+Shift+K' }));
    e.commands.selectAll();
    expect(press(e, 'b', { ctrlKey: true })).toBe(true);
    expect(e.isActive('bold')).toBe(false);
    press(e, 'k', { ctrlKey: true, shiftKey: true });
    expect(e.isActive('bold')).toBe(true);
  });

  it('ignores notepad-only bindings in note mode', () => {
    const e = make(ctxWith(), 'note');
    expect(press(e, 'ArrowDown', { altKey: true })).toBeFalsy();
  });
});

describe('slash menu', () => {
  it('offers the block reference only in notepads', () => {
    expect(filterSlashItems('block ref', 'note')).toEqual([]);
    expect(filterSlashItems('block ref', 'notepad').map((i) => i.title)).toEqual(['Block reference']);
  });

  it('opens when a / is inserted programmatically', () => {
    const e = make(ctxWith(), 'notepad');
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    // Suggestion only triggers after a space or at line start.
    e.commands.insertContent(' /');
    expect(slashPluginKey.getState(e.state)?.active).toBe(true);
  });
});
```

(`jsdom`/`happy-dom` render the view but not layout; the popup's DOM placement is not asserted.)

- [ ] **Step 2: Run — expect failure**

Run: `bun test test/behaviour.test.ts`

- [ ] **Step 3: Write `src/custom/unlinkedMentions.ts`**

```ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { ShuttleContextRef } from '../context';

const key = new PluginKey<DecorationSet>('unlinkedMentions');
const MIN_TITLE_LENGTH = 3;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function build(doc: PMNode, ctx: ShuttleContextRef): DecorationSet {
  const titles = ctx.current.host.listNoteTitles()
    .filter((n) => n.id !== ctx.current.docKey && n.title.trim().length >= MIN_TITLE_LENGTH)
    .map((n) => n.title.trim());
  if (titles.length === 0) return DecorationSet.empty;

  const pattern = new RegExp(`(?<![\\w])(${titles.map(escapeRe).join('|')})(?![\\w])`, 'gi');
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(pattern)) {
      const from = pos + (m.index ?? 0);
      decos.push(Decoration.inline(from, from + m[0].length, {
        class: 'unlinked-mention',
        title: `"${m[0]}" is mentioned but not linked`,
      }));
    }
  });
  return DecorationSet.create(doc, decos);
}

/** Underlines note titles that appear in the text without a `[[link]]`. */
export function unlinkedMentions(ctx: ShuttleContextRef) {
  return Extension.create({
    name: 'unlinkedMentions',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_, state) => build(state.doc, ctx),
            apply: (tr, old) => (tr.docChanged ? build(tr.doc, ctx) : old),
          },
          props: {
            decorations: (state) => key.getState(state) ?? DecorationSet.empty,
          },
        }),
      ];
    },
  });
}
```

- [ ] **Step 4: Write `src/custom/keybindings/keybindings.ts`**

```ts
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { ShuttleContextRef } from '../../context';
import type { ShuttleMode } from '../../host';
import { SHUTTLE_KEYBINDINGS, eventToAccel, resolveBindings, type KeybindingId } from './defs';

/** Runs an action; false when it does not apply here, so the key falls through. */
function runAction(editor: Editor, ctx: ShuttleContextRef, id: KeybindingId): boolean {
  const chain = () => editor.chain().focus();
  const at = editor.state.selection.from;
  switch (id) {
    case 'editor.bold':        return chain().toggleBold().run();
    case 'editor.italic':      return chain().toggleItalic().run();
    case 'editor.underline':   return chain().toggleUnderline().run();
    case 'editor.inlineCode':  return chain().toggleCode().run();
    case 'editor.strike':      return chain().toggleStrike().run();
    case 'editor.highlight':   return chain().toggleHighlight().run();
    case 'editor.heading1':    return chain().toggleHeading({ level: 1 }).run();
    case 'editor.heading2':    return chain().toggleHeading({ level: 2 }).run();
    case 'editor.heading3':    return chain().toggleHeading({ level: 3 }).run();
    case 'editor.bulletList':  return chain().toggleBulletList().run();
    case 'editor.orderedList': return chain().toggleOrderedList().run();
    case 'editor.taskList':    return chain().toggleTaskList().run();
    case 'editor.blockquote':  return chain().toggleBlockquote().run();
    case 'editor.codeBlock':   return chain().toggleCodeBlock().run();
    case 'editor.divider':     return chain().setHorizontalRule().run();
    case 'editor.toggleTask': {
      if (!editor.isActive('taskItem')) return false;
      const checked = Boolean(editor.getAttributes('taskItem')['checked']);
      return editor.commands.updateAttributes('taskItem', { checked: !checked });
    }
    case 'editor.find':        ctx.current.events.openFind(); return true;
    case 'block.moveUp':       return editor.commands.moveBlock(at, -1);
    case 'block.moveDown':     return editor.commands.moveBlock(at, 1);
    case 'block.duplicate':    return editor.commands.duplicateBlock(at);
    case 'block.delete':       return editor.commands.deleteBlock(at);
    case 'block.insertRef':    ctx.current.events.openRefPicker(); return true;
  }
}

/**
 * Owns every editor shortcut so all of them are rebindable. Priority 1000
 * puts it ahead of Tiptap's own keymaps; a default the user moved away from
 * is swallowed rather than left working through the built-in keymap.
 */
export function keybindings(ctx: ShuttleContextRef, mode: ShuttleMode) {
  return Extension.create({
    name: 'shuttleKeybindings',
    priority: 1000,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey('shuttleKeybindings'),
          props: {
            handleKeyDown(_view, event) {
              const accel = eventToAccel(event);
              if (!accel) return false;
              const bindings = resolveBindings(ctx.current.host.keybindings);
              const applies = (def: (typeof SHUTTLE_KEYBINDINGS)[number]) => !def.notepadOnly || mode === 'notepad';

              for (const def of SHUTTLE_KEYBINDINGS) {
                if (bindings[def.id] !== accel || !applies(def)) continue;
                if (!runAction(editor, ctx, def.id)) continue;
                event.preventDefault();
                return true;
              }

              const displaced = SHUTTLE_KEYBINDINGS.some(
                (def) => def.defaultAccel === accel && bindings[def.id] !== accel && applies(def),
              );
              if (displaced) { event.preventDefault(); return true; }
              return false;
            },
          },
        }),
      ];
    },
  });
}
```

Note: `toggleHighlight` requires Highlight in the extension list; the Task 9 test does not press Mod+Shift+H, so its absence there is fine. `editor.chain().focus().toggleHighlight` type-checks because `@tiptap/extension-highlight` augments `Commands` once imported anywhere in the program (Task 10 imports it).

- [ ] **Step 5: Write `src/custom/slash/items.tsx`**

```tsx
import type { Editor, JSONContent, Range } from '@tiptap/core';
import type { ReactNode } from 'react';
import {
  Pilcrow, Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, Code2, Quote, Minus,
  Sigma, Pi, Table, ChevronRight, ImageIcon, Blocks, Tag, Link2,
  BookOpen, Calendar, CalendarCheck, Layers, BookMarked,
} from 'lucide-react';
import type { ShuttleContextRef } from '../../context';
import type { ShuttleMode } from '../../host';
import { blockIdAt } from '../../doc/topLevel';

export interface SlashArgs {
  editor: Editor;
  range: Range;
  ctx: ShuttleContextRef;
}

export interface SlashItem {
  title: string;
  description: string;
  icon: ReactNode;
  group: 'Blocks' | 'Insert' | 'Annotate' | 'Templates';
  only?: ShuttleMode;
  run: (args: SlashArgs) => void;
}

const icon = (C: typeof Pilcrow): ReactNode => <C size={14} strokeWidth={1.75} />;
const clear = ({ editor, range }: SlashArgs) => editor.chain().focus().deleteRange(range);

const fragmentAction = (type: 'tag' | 'noteLink' | 'fragmentLink') => (args: SlashArgs): void => {
  clear(args).run();
  const blockId = blockIdAt(args.editor.state);
  if (blockId) args.ctx.current.host.onFragmentAction({ type, blockId });
};

const insert = (nodes: JSONContent[]) => (args: SlashArgs): void => {
  clear(args).insertContent(nodes).run();
};

// ── Template helpers ────────────────────────────────────────────────────────
const p = (): JSONContent => ({ type: 'paragraph' });
const h = (level: 1 | 2 | 3, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const meta = (label: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: label, marks: [{ type: 'bold' }] }] });
const tasks = (n: number): JSONContent => ({ type: 'taskList', content: Array.from({ length: n }, () => ({ type: 'taskItem', attrs: { checked: false }, content: [p()] })) });
const bullets = (n: number): JSONContent => ({ type: 'bulletList', content: Array.from({ length: n }, () => ({ type: 'listItem', content: [p()] })) });
const today = (): string => new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

export const SLASH_ITEMS: readonly SlashItem[] = [
  { title: 'Text', description: 'Plain paragraph', group: 'Blocks', icon: icon(Pilcrow), run: (a) => clear(a).setParagraph().run() },
  { title: 'Heading 1', description: 'Large section heading', group: 'Blocks', icon: icon(Heading1), run: (a) => clear(a).setHeading({ level: 1 }).run() },
  { title: 'Heading 2', description: 'Medium section heading', group: 'Blocks', icon: icon(Heading2), run: (a) => clear(a).setHeading({ level: 2 }).run() },
  { title: 'Heading 3', description: 'Small section heading', group: 'Blocks', icon: icon(Heading3), run: (a) => clear(a).setHeading({ level: 3 }).run() },
  { title: 'Bullet List', description: 'Unordered list', group: 'Blocks', icon: icon(List), run: (a) => clear(a).toggleBulletList().run() },
  { title: 'Numbered List', description: 'Ordered list', group: 'Blocks', icon: icon(ListOrdered), run: (a) => clear(a).toggleOrderedList().run() },
  { title: 'Task List', description: 'Checklist', group: 'Blocks', icon: icon(CheckSquare), run: (a) => clear(a).toggleTaskList().run() },
  { title: 'Code Block', description: 'Syntax-highlighted code', group: 'Blocks', icon: icon(Code2), run: (a) => clear(a).toggleCodeBlock().run() },
  { title: 'Quote', description: 'Blockquote', group: 'Blocks', icon: icon(Quote), run: (a) => clear(a).toggleBlockquote().run() },
  { title: 'Toggle', description: 'Collapsible section', group: 'Blocks', icon: icon(ChevronRight), run: (a) => clear(a).setDetails().run() },
  { title: 'Divider', description: 'Horizontal rule', group: 'Insert', icon: icon(Minus), run: (a) => clear(a).setHorizontalRule().run() },
  { title: 'Table', description: '3 × 3 table with header', group: 'Insert', icon: icon(Table), run: (a) => clear(a).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Image', description: 'Upload an image', group: 'Insert', icon: icon(ImageIcon), run: (a) => { clear(a).run(); a.ctx.current.events.pickImage(); } },
  {
    title: 'Math (inline)', description: 'Inline LaTeX formula', group: 'Insert', icon: icon(Sigma),
    run: (a) => {
      clear(a).insertInlineMath({ latex: '' }).run();
      a.ctx.current.events.editMath({ kind: 'inline', latex: '', pos: a.range.from });
    },
  },
  {
    title: 'Math Block', description: 'Display LaTeX formula', group: 'Insert', icon: icon(Pi),
    run: (a) => {
      clear(a).insertBlockMath({ latex: '' }).run();
      const pos = a.editor.state.selection.from - 1;
      a.ctx.current.events.editMath({ kind: 'block', latex: '', pos: Math.max(0, pos) });
    },
  },
  {
    title: 'Block reference', description: 'Embed a block from another note', group: 'Insert', icon: icon(Blocks), only: 'notepad',
    run: (a) => { clear(a).run(); a.ctx.current.events.openRefPicker(); },
  },
  { title: 'Tag block', description: 'Add a tag to this block', group: 'Annotate', icon: icon(Tag), run: fragmentAction('tag') },
  { title: 'Link → note', description: 'Link this block to a note', group: 'Annotate', icon: icon(Link2), run: fragmentAction('noteLink') },
  { title: 'Link → fragment', description: 'Link this block to a block in a note', group: 'Annotate', icon: icon(Link2), run: fragmentAction('fragmentLink') },
  { title: 'Lesson', description: 'Title · Objectives · Notes · Summary', group: 'Templates', icon: icon(BookOpen),
    run: insert([h(1, 'Lesson Title'), h(2, 'Objectives'), bullets(2), h(2, 'Notes'), p(), h(2, 'Summary'), p()]) },
  { title: 'Meeting', description: 'Date · Agenda · Notes · Action items', group: 'Templates', icon: icon(Calendar),
    run: insert([h(1, 'Meeting'), meta('Date: '), meta('Time: '), meta('Attendees: '), h(2, 'Agenda'), tasks(3), h(2, 'Notes'), p(), h(2, 'Action Items'), tasks(2)]) },
  { title: 'Daily Note', description: "Today's date · Tasks · Notes · Reflection", group: 'Templates', icon: icon(CalendarCheck),
    run: (a) => insert([h(1, today()), h(2, 'Tasks'), tasks(3), h(2, 'Notes'), p(), h(2, 'Reflection'), p()])(a) },
  { title: 'Project', description: 'Overview · Goals · Tasks · Notes', group: 'Templates', icon: icon(Layers),
    run: insert([h(1, 'Project Name'), h(2, 'Overview'), p(), h(2, 'Goals'), bullets(2), h(2, 'Tasks'), tasks(3), h(2, 'Notes'), p()]) },
  { title: 'Research Note', description: 'Source · Findings · Notes · References', group: 'Templates', icon: icon(BookMarked),
    run: insert([h(1, 'Research: Topic'), meta('Source: '), h(2, 'Key Findings'), bullets(3), h(2, 'Notes'), p(), h(2, 'References'), bullets(1)]) },
];

export function filterSlashItems(query: string, mode: ShuttleMode): SlashItem[] {
  const q = query.toLowerCase();
  return SLASH_ITEMS.filter(
    (item) =>
      (item.only === undefined || item.only === mode) &&
      (item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)),
  );
}
```

- [ ] **Step 6: Write `src/custom/slash/slash.ts`**

```ts
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { createElement } from 'react';
import type { ShuttleContextRef } from '../../context';
import type { ShuttleMode } from '../../host';
import { createSuggestionList } from '../../ui/SuggestionList';
import { suggestionPopup } from '../../ui/suggestionPopup';
import { filterSlashItems, type SlashItem } from './items';

/** Exported so tests can check the menu opens after a programmatic `/`. */
export const slashPluginKey = new PluginKey('slashCommand');

const SlashList = createSuggestionList<SlashItem>({
  itemKey: (i) => i.title,
  group: (i) => i.group,
  renderItem: (i) => [
    createElement('span', { key: 'i', className: 'sh-popup-icon' }, i.icon),
    createElement('span', { key: 't' }, i.title),
  ],
  empty: 'No results',
});

/** The `/` menu, on the official Suggestion utility. */
export function slashCommand(ctx: ShuttleContextRef, mode: ShuttleMode) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          pluginKey: slashPluginKey,
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }) => filterSlashItems(query, mode),
          command: ({ editor, range, props }) => props.run({ editor, range, ctx }),
          render: suggestionPopup(SlashList, { maxHeight: 260, maxWidth: 240 }),
        }),
      ];
    },
  });
}
```

- [ ] **Step 7: Run — expect pass**

Run: `bun test test/behaviour.test.ts` → `6 pass`.
The slash items reference `setDetails`, `insertTable`, `insertInlineMath`, `insertBlockMath`; those command types come from their packages, imported in Task 10. If `tsc` complains before Task 10, it is resolved there — tests do not run `tsc`.

- [ ] **Step 8: Commit**

```bash
git add src/custom/unlinkedMentions.ts src/custom/keybindings/keybindings.ts src/custom/slash test/behaviour.test.ts
git commit -m "Add unlinked mentions, rebindable keybindings and the slash menu"
```

---

### Task 10: `buildExtensions` — the full official + custom set

**Files:**
- Create: `src/extensions/blockTypes.ts`, `src/extensions/index.ts`, `test/helpers.ts`
- Test: `test/schema.test.ts`, `test/markdown.test.ts`

- [ ] **Step 1: Write `test/helpers.ts`**

```ts
import { Editor, type JSONContent } from '@tiptap/core';
import { buildExtensions } from '../src/extensions';
import { createFakeHost, type FakeHost } from '../src/testing/fakeHost';
import { noopEvents, type ShuttleContextRef, type ShuttleUiEvents } from '../src/context';
import type { ShuttleMode } from '../src/host';

export interface Made {
  editor: Editor;
  host: FakeHost;
  ctx: ShuttleContextRef;
}

export function makeEditor(opts: {
  mode?: ShuttleMode;
  content?: JSONContent | string;
  host?: FakeHost;
  events?: Partial<ShuttleUiEvents>;
} = {}): Made {
  const host = opts.host ?? createFakeHost();
  const ctx: ShuttleContextRef = { current: { host, events: { ...noopEvents, ...opts.events }, docKey: 'n-self' } };
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: buildExtensions(opts.mode ?? 'note', ctx, { reactViews: false, twitchParent: 'localhost' }),
    content: opts.content ?? '<p></p>',
  });
  return { editor, host, ctx };
}

/** Drop generated ids so documents can be compared structurally. */
export function stripIds(node: JSONContent): JSONContent {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (attrs) {
    delete attrs['blockId'];
    if (node.type === 'heading') { delete attrs['id']; delete attrs['data-toc-id']; }
  }
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map(stripIds) } : {}),
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 2: Write the failing schema test `test/schema.test.ts`**

```ts
import { describe, it, expect } from 'bun:test';
import type { JSONContent } from '@tiptap/core';
import { makeEditor } from './helpers';
import { BLOCK_TYPES } from '../src/extensions/blockTypes';

const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

const EVERYTHING: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
    para(
      text('b', [{ type: 'bold' }]), text('i', [{ type: 'italic' }]), text('u', [{ type: 'underline' }]),
      text('s', [{ type: 'strike' }]), text('c', [{ type: 'code' }]), text('h', [{ type: 'highlight' }]),
      text('sub', [{ type: 'subscript' }]), text('sup', [{ type: 'superscript' }]),
      text('link', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
      { type: 'inlineMath', attrs: { latex: 'x^2' } },
      { type: 'mention', attrs: { id: 'n-alpha', label: 'Alpha', displayText: null, mentionSuggestionChar: '[[' } },
      { type: 'fragmentLink', attrs: { linkId: 'l1', toNoteId: 'n-beta', toFragmentId: null, label: 'Beta' } },
      { type: 'hardBreak' },
    ),
    { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('a'))] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('1'))] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para(text('done'))] }] },
    { type: 'blockquote', content: [para(text('q'))] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1')] },
    { type: 'blockMath', attrs: { latex: '\\int x' } },
    { type: 'horizontalRule' },
    { type: 'image', attrs: { src: 'attachment:abc', alt: 'pic' } },
    { type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
    { type: 'twitch', attrs: { src: 'https://www.twitch.tv/videos/1234567890' } },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [para(text('H'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [para(text('C'))] }] },
      ],
    },
    {
      type: 'details',
      content: [
        { type: 'detailsSummary', content: [text('More')] },
        { type: 'detailsContent', content: [para(text('hidden'))] },
      ],
    },
    { type: 'blockRef', attrs: { refBlockId: 'b1', refNoteId: 'n-beta' } },
    para(),
  ],
};

describe('schema', () => {
  for (const mode of ['note', 'notepad'] as const) {
    it(`loads a document using every node and mark (${mode})`, () => {
      const { editor } = makeEditor({ mode, content: EVERYTHING });
      expect(() => editor.state.doc.check()).not.toThrow();
      const types = new Set<string>();
      editor.state.doc.descendants((n) => { types.add(n.type.name); n.marks.forEach((m) => types.add(m.type.name)); });
      for (const t of ['inlineMath', 'blockMath', 'mention', 'fragmentLink', 'blockRef', 'image', 'youtube', 'twitch',
        'table', 'details', 'taskItem', 'highlight', 'subscript', 'superscript', 'underline', 'link']) {
        expect(types.has(t)).toBe(true);
      }
      editor.destroy();
    });
  }

  it('gives every top-level block a unique blockId', () => {
    const { editor } = makeEditor({ mode: 'notepad', content: EVERYTHING });
    const ids: string[] = [];
    editor.state.doc.forEach((n) => {
      if (BLOCK_TYPES.includes(n.type.name)) ids.push(n.attrs['blockId'] as string);
    });
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    editor.destroy();
  });

  it('re-mints ids on pasted duplicates', () => {
    const { editor } = makeEditor({ content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'same' }, content: [{ type: 'text', text: 'a' }] }] } });
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', attrs: { blockId: 'same' }, content: [{ type: 'text', text: 'b' }] });
    const ids: string[] = [];
    editor.state.doc.forEach((n) => ids.push(n.attrs['blockId'] as string));
    expect(new Set(ids).size).toBe(ids.length);
    editor.destroy();
  });

  it('keeps a trailing paragraph after an atom block', () => {
    const { editor } = makeEditor({ content: { type: 'doc', content: [{ type: 'horizontalRule' }] } });
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
    editor.destroy();
  });
});
```

- [ ] **Step 3: Write the failing markdown test `test/markdown.test.ts`**

```ts
import { describe, it, expect } from 'bun:test';
import { makeEditor, stripIds } from './helpers';

/** Parse markdown, serialise it, parse again: the document must survive. */
function roundTrip(md: string) {
  const { editor } = makeEditor();
  editor.commands.setContent(md, { contentType: 'markdown' });
  const first = stripIds(editor.getJSON());
  const out = editor.getMarkdown();
  editor.commands.setContent(out, { contentType: 'markdown' });
  const second = stripIds(editor.getJSON());
  editor.destroy();
  return { first, second, out };
}

describe('markdown', () => {
  it.each([
    ['wiki links', 'Link to [[Alpha]] and [[Beta|the second]].'],
    ['math', 'Inline $x^2$ here.\n\n$$\\int_0^1 x\\,dx$$'],
    ['tables', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['task lists', '- [ ] one\n- [x] two'],
    ['highlight', 'some ==marked== text'],
    ['details', ':::details Summary\nBody text\n:::'],
    ['block refs', '![[n-beta#b1]]'],
  ])('round-trips %s', (_name, md) => {
    const { first, second } = roundTrip(md);
    expect(second).toEqual(first);
  });

  it('parses wiki links into mentions', () => {
    const { first } = roundTrip('See [[Alpha]]');
    expect(JSON.stringify(first)).toContain('"type":"mention"');
    expect(JSON.stringify(first)).toContain('"id":"n-alpha"');
  });

  it('parses details into a details node', () => {
    const { first } = roundTrip(':::details Summary\nBody text\n:::');
    expect(first.content?.[0]?.type).toBe('details');
  });
});
```

- [ ] **Step 4: Run both — expect failure**

Run: `bun test test/schema.test.ts test/markdown.test.ts`
Expected: FAIL, `../src/extensions` not found.

- [ ] **Step 5: Write `src/extensions/blockTypes.ts`**

```ts
/**
 * Node types that get a `blockId` from UniqueID. Top-level instances are the
 * addressable blocks the host indexes; nested paragraphs also get ids, which
 * is what will allow per-bullet addressing later without a format change.
 */
export const BLOCK_TYPES: readonly string[] = [
  'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock',
  'blockMath', 'horizontalRule', 'image', 'youtube', 'twitch', 'table', 'details', 'blockRef',
];
```

- [ ] **Step 6: Write `src/extensions/index.ts`**

```ts
import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount, Focus, Placeholder, Selection } from '@tiptap/extensions';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Youtube } from '@tiptap/extension-youtube';
import { Twitch } from '@tiptap/extension-twitch';
import { FileHandler } from '@tiptap/extension-file-handler';
import { UniqueID } from '@tiptap/extension-unique-id';
import { TableKit } from '@tiptap/extension-table';
import { DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Highlight } from '@tiptap/extension-highlight';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { FindAndReplace } from '@tiptap/extension-find-and-replace';
import { TableOfContents } from '@tiptap/extension-table-of-contents';
import { Markdown } from '@tiptap/markdown';
import { common, createLowlight } from 'lowlight';
import { nanoid } from 'nanoid';

import type { ShuttleContextRef } from '../context';
import type { ShuttleMode } from '../host';
import type { TableOfContentData } from '@tiptap/extension-table-of-contents';
import { BLOCK_TYPES } from './blockTypes';
import { BlockCommands } from '../custom/notepad/commands';
import { wikiLink } from '../custom/links/wikiLink';
import { fragmentLink } from '../custom/links/fragmentLink';
import { blockRef } from '../custom/blockRef/blockRef';
import { ShuttleDetails } from '../custom/markdown/details';
import { MarkdownClipboard } from '../custom/markdown/clipboard';
import { shuttleImage } from '../custom/image/image';
import { insertImageFiles } from '../custom/image/upload';
import { unlinkedMentions } from '../custom/unlinkedMentions';
import { keybindings } from '../custom/keybindings/keybindings';
import { slashCommand } from '../custom/slash/slash';

const lowlight = createLowlight(common);

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'];

export interface BuildOptions {
  /** False in tests, where no React tree hosts node views. */
  reactViews: boolean;
  /** Twitch embeds require the embedding page's host name. */
  twitchParent: string;
  placeholder?: string;
  /** Receives heading outline updates for the Outline panel. */
  onOutline?: (items: TableOfContentData) => void;
}

/**
 * The editor's extension set. Both modes share one schema — a notepad is the
 * same document with the block gutter turned on — so the only mode-dependent
 * parts are the notepad-only keybindings and slash items.
 */
export function buildExtensions(mode: ShuttleMode, ctx: ShuttleContextRef, options: BuildOptions): Extensions {
  const view = { reactViews: options.reactViews };

  return [
    // ── Official ────────────────────────────────────────────────────────────
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Mathematics.configure({
      katexOptions: { throwOnError: false },
      inlineOptions: {
        onClick: (node, pos) => ctx.current.events.editMath({ kind: 'inline', latex: String(node.attrs['latex'] ?? ''), pos }),
      },
      blockOptions: {
        onClick: (node, pos) => ctx.current.events.editMath({ kind: 'block', latex: String(node.attrs['latex'] ?? ''), pos }),
      },
    }),
    shuttleImage(ctx),
    FileHandler.configure({
      allowedMimeTypes: IMAGE_TYPES,
      consumePasteEvent: true,
      onPaste: (editor, files) => { void insertImageFiles(editor, ctx, files); },
      onDrop: (editor, files, pos) => { void insertImageFiles(editor, ctx, files, pos); },
    }),
    Youtube.configure({ nocookie: true, controls: true }),
    Twitch.configure({ parent: options.twitchParent }),
    TableKit.configure({ table: { resizable: false } }),
    ShuttleDetails,
    DetailsSummary,
    DetailsContent,
    Highlight,
    Subscript,
    Superscript,
    UniqueID.configure({
      attributeName: 'blockId',
      types: [...BLOCK_TYPES],
      generateID: () => nanoid(10),
    }),
    Placeholder.configure({ placeholder: options.placeholder ?? 'Start writing… or type / for commands' }),
    CharacterCount,
    Selection,
    Focus.configure({ className: 'sh-has-focus', mode: 'shallowest' }),
    FindAndReplace.configure({ searchDebounceMs: 0, injectCSS: false }),
    TableOfContents.configure(options.onOutline ? { onUpdate: options.onOutline } : {}),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    MarkdownClipboard,

    // ── Custom ──────────────────────────────────────────────────────────────
    wikiLink(ctx, view),
    fragmentLink(ctx, view),
    blockRef(ctx, view),
    BlockCommands,
    unlinkedMentions(ctx),
    keybindings(ctx, mode),
    slashCommand(ctx, mode),
  ];
}
```

- [ ] **Step 7: Run — expect pass**

Run: `bun test test/schema.test.ts test/markdown.test.ts`
Expected: all pass. Likely snags and where to look (fix them, do not skip the test):
- A node missing from the schema test → its extension or option name; check that package's `dist/index.d.ts`.
- `details` round trip fails → debug with `console.log(out)` locally (remove after): usually the tokenizer's `start` or the trailing newline in `DETAILS_BLOCK`.
- Heading `id` differences → extend `stripIds` only for attributes TableOfContents generates.

- [ ] **Step 8: Run the whole suite and typecheck**

Run: `bun test` → all pass. Run: `pnpm typecheck` → no errors. Fix any type errors in files from earlier tasks now (they may surface only once all command augmentations are loaded).

- [ ] **Step 9: Commit**

```bash
git add src/extensions test/helpers.ts test/schema.test.ts test/markdown.test.ts
git commit -m "Build the full extension set: official Tiptap 3 plus Shuttle's custom pieces"
```

---

### Task 11: Document tracking helpers

**Files:**
- Create: `src/doc/tracking.ts`, `src/doc/validate.ts`
- Test: `test/tracking.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { makeEditor } from './helpers';
import { collectFragmentLinkIds, collectMentionTargets, diffSets } from '../src/doc/tracking';
import { EMPTY_DOC, isValidDoc } from '../src/doc/validate';

describe('tracking', () => {
  it('collects mention targets and fragment link ids', () => {
    const { editor } = makeEditor({
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'n-alpha', label: 'Alpha' } },
            { type: 'mention', attrs: { id: 'n-alpha', label: 'Alpha' } },
            { type: 'fragmentLink', attrs: { linkId: 'l1', toNoteId: 'n-beta' } },
          ],
        }],
      },
    });
    expect([...collectMentionTargets(editor.state.doc)]).toEqual(['n-alpha']);
    expect([...collectFragmentLinkIds(editor.state.doc)]).toEqual(['l1']);
    editor.destroy();
  });

  it('diffs sets', () => {
    expect(diffSets(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual({ added: ['c'], removed: ['a'] });
  });
});

describe('isValidDoc', () => {
  it('accepts current documents and rejects v2 notepad wrappers', () => {
    const { editor } = makeEditor();
    expect(isValidDoc(editor.schema, EMPTY_DOC)).toBe(true);
    expect(isValidDoc(editor.schema, {
      type: 'doc',
      content: [{ type: 'notepadBlock', attrs: { blockId: 'x' }, content: [{ type: 'paragraph' }] }],
    })).toBe(false);
    expect(isValidDoc(editor.schema, { type: 'doc', content: [{ type: 'mathInline' }] })).toBe(false);
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test test/tracking.test.ts`

- [ ] **Step 3: Write `src/doc/tracking.ts`**

```ts
import type { Node as PMNode } from '@tiptap/pm/model';

/** Note ids targeted by `[[wiki links]]` in the document. */
export function collectMentionTargets(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'mention' && typeof node.attrs['id'] === 'string') ids.add(node.attrs['id']);
  });
  return ids;
}

/** Link ids of fragment link nodes in the document. */
export function collectFragmentLinkIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'fragmentLink' && typeof node.attrs['linkId'] === 'string') ids.add(node.attrs['linkId']);
  });
  return ids;
}

export function diffSets(before: Set<string>, after: Set<string>): { added: string[]; removed: string[] } {
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  };
}
```

- [ ] **Step 4: Write `src/doc/validate.ts`**

```ts
import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * True when the stored document fits the current schema. Documents written by
 * Shuttle v2 (notepad wrappers, old math nodes) fail here and are opened
 * read-only instead of being silently rewritten.
 */
export function isValidDoc(schema: Schema, json: JSONContent): boolean {
  if (json.type !== 'doc') return false;
  try {
    schema.nodeFromJSON(json).check();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run — expect pass**, then commit

Run: `bun test test/tracking.test.ts` → `3 pass`.

```bash
git add src/doc test/tracking.test.ts
git commit -m "Add link tracking and legacy-document validation helpers"
```

---

### Task 12: `ShuttleEditor` — lifecycle, saving, legacy mode

**Files:**
- Create: `src/ShuttleEditor.tsx` (UI components come in Task 13; this task renders the editor and a minimal shell)
- Test: `test/ShuttleEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, afterEach } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor, JSONContent } from '@tiptap/core';
import { ShuttleEditor, type ShuttleEditorProps } from '../src/ShuttleEditor';
import { createFakeHost } from '../src/testing/fakeHost';
import { sleep } from './helpers';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });

const doc = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

interface Harness {
  editor: () => Editor;
  saves: { key: string; doc: JSONContent }[];
  render: (props: Partial<ShuttleEditorProps>) => void;
  host: ReturnType<typeof createFakeHost>;
}

function mount(initial: Partial<ShuttleEditorProps>): Harness {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const saves: Harness['saves'] = [];
  const host = createFakeHost();
  let current: Editor | null = null;
  let props: ShuttleEditorProps = {
    docKey: 'a', doc: doc('one'), mode: 'note', host, saveDebounceMs: 10, toolbar: false,
    onChange: (key, d) => saves.push({ key, doc: d }),
    onReady: (e) => { current = e; },
  };
  const render = (next: Partial<ShuttleEditorProps>) => {
    props = { ...props, ...next };
    act(() => root!.render(<ShuttleEditor {...props} />));
  };
  render(initial);
  return { editor: () => current!, saves, render, host };
}

describe('ShuttleEditor', () => {
  it('saves after the debounce', async () => {
    const h = mount({});
    act(() => { h.editor().commands.insertContent(' two'); });
    await act(async () => { await sleep(30); });
    expect(h.saves.at(-1)?.key).toBe('a');
    expect(JSON.stringify(h.saves.at(-1)?.doc)).toContain('one two');
  });

  it('flushes the pending edit to the old key when the document changes', () => {
    const h = mount({});
    act(() => { h.editor().commands.insertContent('!'); });
    h.render({ docKey: 'b', doc: doc('bee') });
    expect(h.saves.map((s) => s.key)).toEqual(['a']);
    expect(h.editor().getText()).toBe('bee');
  });

  it('flushes on unmount', () => {
    const h = mount({});
    act(() => { h.editor().commands.insertContent('!'); });
    act(() => root!.unmount());
    root = null;
    expect(h.saves.length).toBe(1);
  });

  it('opens v2 documents read-only and never saves them', async () => {
    const legacy: JSONContent = { type: 'doc', content: [{ type: 'notepadBlock', content: [{ type: 'paragraph' }] }] };
    const h = mount({ docKey: 'old', doc: legacy });
    expect(h.editor().isEditable).toBe(false);
    expect(container!.textContent).toContain('older format');
    act(() => { h.editor().commands.insertContent('x'); });
    await act(async () => { await sleep(30); });
    expect(h.saves).toEqual([]);
  });

  it('reports added and removed wiki links', () => {
    const h = mount({});
    act(() => {
      h.editor().commands.insertContent({ type: 'mention', attrs: { id: 'n-alpha', label: 'Alpha', mentionSuggestionChar: '[[' } });
    });
    expect(h.host.calls.linksChanged.at(-1)).toEqual({ added: ['n-alpha'], removed: [] });
    act(() => { h.editor().commands.setContent(doc('none'), { emitUpdate: true }); });
    expect(h.host.calls.linksChanged.at(-1)).toEqual({ added: [], removed: ['n-alpha'] });
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test test/ShuttleEditor.test.tsx`

- [ ] **Step 3: Write `src/ShuttleEditor.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/core';
import type { TableOfContentData } from '@tiptap/extension-table-of-contents';
import { buildExtensions } from './extensions';
import type { MathEditRequest, ShuttleContextRef, ShuttleUiEvents } from './context';
import type { ShuttleHost, ShuttleMode } from './host';
import { collectFragmentLinkIds, collectMentionTargets, diffSets } from './doc/tracking';
import { EMPTY_DOC, isValidDoc } from './doc/validate';
import { stripPendingUploads, insertImageFiles } from './custom/image/upload';
import { Toolbar } from './ui/Toolbar';
import { SelectionBubble } from './ui/SelectionBubble';
import { BlockGutter } from './ui/BlockGutter';
import { RefPicker } from './ui/RefPicker';
import { MathEditor } from './ui/MathEditor';
import { FindBar } from './ui/FindBar';
import { Outline } from './ui/Outline';

export interface ShuttleEditorProps {
  /** Identity of the document. Changing it loads `doc` and flushes pending edits. */
  docKey: string;
  /** Stored document. Read only when `docKey` changes; the editor owns it after. */
  doc: JSONContent | null;
  mode: ShuttleMode;
  host: ShuttleHost;
  /** Debounced save; also called immediately on document switch and unmount. */
  onChange: (docKey: string, doc: JSONContent) => void;
  onStats?: (stats: { words: number; characters: number }) => void;
  /** The live editor, for host overlays (context menus, fragment overlays). */
  onReady?: (editor: Editor | null) => void;
  saveDebounceMs?: number;
  toolbar?: boolean;
  outline?: boolean;
  placeholder?: string;
  twitchParent?: string;
  className?: string;
  /** Host overlays rendered inside the content area. */
  children?: ReactNode;
}

const DEFAULT_DEBOUNCE_MS = 750;

export function ShuttleEditor(props: ShuttleEditorProps) {
  const {
    docKey, doc, mode, host, saveDebounceMs = DEFAULT_DEBOUNCE_MS, toolbar = true,
    outline = false, placeholder, className, children,
  } = props;
  const twitchParent = props.twitchParent ?? (typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost');

  const [legacy, setLegacy] = useState(false);
  const [refPicker, setRefPicker] = useState(false);
  const [math, setMath] = useState<MathEditRequest | null>(null);
  const [find, setFind] = useState(false);
  const [toc, setToc] = useState<TableOfContentData>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Latest-value refs: the editor's callbacks are created once.
  const latest = useRef(props);
  latest.current = props;
  const legacyRef = useRef(false);

  const events = useMemo<ShuttleUiEvents>(() => ({
    openRefPicker: () => setRefPicker(true),
    editMath: (req) => setMath(req),
    openFind: () => setFind(true),
    pickImage: () => fileInput.current?.click(),
  }), []);

  const ctxRef = useRef<ShuttleContextRef['current']>({ host, events, docKey });
  ctxRef.current = { host, events, docKey };
  const ctx = useMemo<ShuttleContextRef>(() => ({ get current() { return ctxRef.current; } }), []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ key: string; doc: JSONContent } | null>(null);
  const mentions = useRef<Set<string>>(new Set());
  const fragments = useRef<Set<string>>(new Set());

  const flush = (): void => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const p = pending.current;
    pending.current = null;
    if (p) latest.current.onChange(p.key, p.doc);
  };

  const reportStats = (editor: Editor): void => {
    const counter = editor.storage.characterCount;
    latest.current.onStats?.({ words: counter.words(), characters: counter.characters() });
  };

  const editor = useEditor({
    extensions: buildExtensions(mode, ctx, {
      reactViews: true,
      twitchParent,
      ...(placeholder ? { placeholder } : {}),
      onOutline: (items) => setToc(items),
    }),
    content: EMPTY_DOC,
    onUpdate: ({ editor: ed }) => {
      if (legacyRef.current) return;

      const nextMentions = collectMentionTargets(ed.state.doc);
      const linkDiff = diffSets(mentions.current, nextMentions);
      mentions.current = nextMentions;
      if (linkDiff.added.length > 0 || linkDiff.removed.length > 0) ctx.current.host.onLinksChanged(linkDiff);

      const nextFragments = collectFragmentLinkIds(ed.state.doc);
      const removedFragments = diffSets(fragments.current, nextFragments).removed;
      fragments.current = nextFragments;
      if (removedFragments.length > 0) ctx.current.host.onFragmentLinksRemoved(removedFragments);

      reportStats(ed);

      pending.current = { key: ctx.current.docKey, doc: stripPendingUploads(ed.getJSON()) };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, latest.current.saveDebounceMs ?? DEFAULT_DEBOUNCE_MS);
    },
  }, [mode, twitchParent, placeholder]);

  // Load the document for this key, after writing the previous key's edit.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    flush();
    const stored = doc ?? EMPTY_DOC;
    const valid = isValidDoc(editor.schema, stored);
    legacyRef.current = !valid;
    setLegacy(!valid);
    if (!valid) host.log('warn', 'Document does not match the current schema; opened read-only', { docKey });
    editor.commands.setContent(valid ? stored : EMPTY_DOC, { emitUpdate: false });
    editor.setEditable(valid, false);
    mentions.current = collectMentionTargets(editor.state.doc);
    fragments.current = collectFragmentLinkIds(editor.state.doc);
    reportStats(editor);
    setRefPicker(false);
    setMath(null);
  }, [docKey, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    latest.current.onReady?.(editor);
    return () => latest.current.onReady?.(null);
  }, [editor]);

  // Write, never drop, an edit still inside the debounce window.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const editable = editor !== null && !legacy;

  return (
    <div className={`sh-root sh-mode-${mode}${className ? ` ${className}` : ''}`}>
      {legacy && (
        <div className="sh-legacy" role="status">
          This note uses an older format and is read-only.
        </div>
      )}
      {editor && editable && toolbar && <Toolbar editor={editor} ctx={ctx} />}
      <div className="sh-content">
        <EditorContent editor={editor} className="sh-prose" />
        {editor && editable && <SelectionBubble editor={editor} />}
        {editor && editable && mode === 'notepad' && <BlockGutter editor={editor} ctx={ctx} />}
        {children}
      </div>
      {editor && outline && <Outline items={toc} editor={editor} />}
      {editor && find && <FindBar editor={editor} onClose={() => setFind(false)} />}
      {editor && refPicker && (
        <RefPicker editor={editor} ctx={ctx} onClose={() => setRefPicker(false)} />
      )}
      {editor && math && <MathEditor editor={editor} request={math} onClose={() => setMath(null)} />}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (editor && files.length > 0) void insertImageFiles(editor, ctx, files);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create stub UI modules so the component compiles** (Task 13 replaces them)

For each of `Toolbar`, `SelectionBubble`, `BlockGutter`, `RefPicker`, `MathEditor`, `FindBar`, `Outline`, create `src/ui/<Name>.tsx`:

```tsx
export function Toolbar(_props: Record<string, unknown>) { return null; }
```

(with the matching export name in each file).

- [ ] **Step 5: Run — expect pass**

Run: `bun test test/ShuttleEditor.test.tsx` → `5 pass`.
If `useEditor` never produces an editor under happy-dom: `useEditor` creates it in an effect; the `act` wrapper around `render` flushes it. If `onReady` is still null, add `immediatelyRender: true` to the `useEditor` options.

- [ ] **Step 6: Commit**

```bash
git add src/ShuttleEditor.tsx src/ui test/ShuttleEditor.test.tsx
git commit -m "Add ShuttleEditor: debounced saving, flush on switch/unmount, legacy read-only"
```

---

### Task 13: UI — toolbar, bubble menu, gutter, block menu, pickers, find, outline

**Files:**
- Replace stubs: `src/ui/Toolbar.tsx`, `src/ui/SelectionBubble.tsx`, `src/ui/BlockGutter.tsx`, `src/ui/RefPicker.tsx`, `src/ui/MathEditor.tsx`, `src/ui/FindBar.tsx`, `src/ui/Outline.tsx`
- Create: `src/ui/BlockMenu.tsx`
- Test: `test/ui.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, afterEach } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { ShuttleEditor } from '../src/ShuttleEditor';
import { createFakeHost } from '../src/testing/fakeHost';
import { sleep } from './helpers';

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

function mount(mode: 'note' | 'notepad') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  let editor: Editor | null = null;
  const host = createFakeHost({
    blocks: [{ id: 'b1', noteId: 'n-beta', type: 'paragraph', text: 'beta block', level: null }],
  });
  act(() => root!.render(
    <ShuttleEditor docKey="n-self" doc={null} mode={mode} host={host} onChange={() => {}} onReady={(e) => { editor = e; }} />,
  ));
  return { container, editor: () => editor!, host };
}

describe('ui', () => {
  it('toolbar toggles bold', () => {
    const { container, editor } = mount('note');
    act(() => { editor().commands.insertContent('word'); editor().commands.selectAll(); });
    const bold = container.querySelector('button[title^="Bold"]') as HTMLButtonElement;
    act(() => { bold.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(editor().isActive('bold')).toBe(true);
  });

  it('find bar opens with Mod+F and highlights matches', async () => {
    const { container, editor } = mount('note');
    act(() => { editor().commands.insertContent('apple banana apple'); });
    act(() => {
      editor().view.someProp('handleKeyDown', (f) => f(editor().view, new KeyboardEvent('keydown', { key: 'f', ctrlKey: true })));
    });
    const input = container.querySelector('input[placeholder="Find"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => { editor().commands.setSearchTerm('apple'); });
    await act(async () => { await sleep(5); });
    expect(editor().storage.findAndReplace.results.length).toBe(2);
  });

  it('ref picker lists notes, then blocks, then inserts a reference', async () => {
    const { container, editor, host } = mount('notepad');
    host.keybindings = { 'block.insertRef': 'Mod+Shift+R' };
    act(() => {
      editor().view.someProp('handleKeyDown', (f) => f(editor().view, new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, shiftKey: true })));
    });
    await act(async () => { await sleep(5); });
    const betaRow = [...container.querySelectorAll('.sh-refpicker-row')].find((b) => b.textContent?.includes('Beta')) as HTMLButtonElement;
    act(() => { betaRow.click(); });
    await act(async () => { await sleep(5); });
    const blockRow = container.querySelector('.sh-refpicker-row') as HTMLButtonElement;
    expect(blockRow.textContent).toContain('beta block');
    act(() => { blockRow.click(); });
    expect(JSON.stringify(editor().getJSON())).toContain('"refBlockId":"b1"');
  });
});
```

- [ ] **Step 2: Run — expect failure** (stubs render nothing)

Run: `bun test test/ui.test.tsx`

- [ ] **Step 3: Write `src/ui/Toolbar.tsx`**

```tsx
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import type { ReactNode } from 'react';
import {
  List, ListOrdered, CheckSquare, Quote, Code2, Minus, Sigma, ImageIcon, Table, Highlighter,
  Underline, Strikethrough, Subscript, Superscript,
} from 'lucide-react';
import type { ShuttleContextRef } from '../context';
import { formatAccel, resolveBindings, type KeybindingId } from '../custom/keybindings/defs';

interface Props {
  editor: Editor;
  ctx: ShuttleContextRef;
}

function Btn({ onRun, active, title, children }: { onRun: () => void; active?: boolean; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`sh-tb-btn${active ? ' is-active' : ''}`}
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onRun(); }}
    >
      {children}
    </button>
  );
}

const ic = { size: 14, strokeWidth: 1.75 } as const;

export function Toolbar({ editor, ctx }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'),
      strike: e.isActive('strike'), code: e.isActive('code'), highlight: e.isActive('highlight'),
      sub: e.isActive('subscript'), sup: e.isActive('superscript'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'),
      quote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'),
    }),
  });
  const bindings = resolveBindings(ctx.current.host.keybindings);
  const t = (label: string, id?: KeybindingId): string => (id && bindings[id] ? `${label} (${formatAccel(bindings[id])})` : label);
  const run = () => editor.chain().focus();

  return (
    <div className="sh-toolbar" role="toolbar">
      <Btn title={t('Bold', 'editor.bold')} active={s.bold} onRun={() => run().toggleBold().run()}><strong>B</strong></Btn>
      <Btn title={t('Italic', 'editor.italic')} active={s.italic} onRun={() => run().toggleItalic().run()}><em>I</em></Btn>
      <Btn title={t('Underline', 'editor.underline')} active={s.underline} onRun={() => run().toggleUnderline().run()}><Underline {...ic} /></Btn>
      <Btn title={t('Strikethrough', 'editor.strike')} active={s.strike} onRun={() => run().toggleStrike().run()}><Strikethrough {...ic} /></Btn>
      <Btn title={t('Inline code', 'editor.inlineCode')} active={s.code} onRun={() => run().toggleCode().run()}>{'</>'}</Btn>
      <Btn title={t('Highlight', 'editor.highlight')} active={s.highlight} onRun={() => run().toggleHighlight().run()}><Highlighter {...ic} /></Btn>
      <Btn title="Subscript" active={s.sub} onRun={() => run().toggleSubscript().run()}><Subscript {...ic} /></Btn>
      <Btn title="Superscript" active={s.sup} onRun={() => run().toggleSuperscript().run()}><Superscript {...ic} /></Btn>
      <span className="sh-tb-sep" />
      <Btn title={t('Heading 1', 'editor.heading1')} active={s.h1} onRun={() => run().toggleHeading({ level: 1 }).run()}>H1</Btn>
      <Btn title={t('Heading 2', 'editor.heading2')} active={s.h2} onRun={() => run().toggleHeading({ level: 2 }).run()}>H2</Btn>
      <Btn title={t('Heading 3', 'editor.heading3')} active={s.h3} onRun={() => run().toggleHeading({ level: 3 }).run()}>H3</Btn>
      <span className="sh-tb-sep" />
      <Btn title={t('Bullet list', 'editor.bulletList')} active={s.bullet} onRun={() => run().toggleBulletList().run()}><List {...ic} /></Btn>
      <Btn title={t('Ordered list', 'editor.orderedList')} active={s.ordered} onRun={() => run().toggleOrderedList().run()}><ListOrdered {...ic} /></Btn>
      <Btn title={t('Task list', 'editor.taskList')} active={s.task} onRun={() => run().toggleTaskList().run()}><CheckSquare {...ic} /></Btn>
      <Btn title={t('Quote', 'editor.blockquote')} active={s.quote} onRun={() => run().toggleBlockquote().run()}><Quote {...ic} /></Btn>
      <Btn title={t('Code block', 'editor.codeBlock')} active={s.codeBlock} onRun={() => run().toggleCodeBlock().run()}><Code2 {...ic} /></Btn>
      <span className="sh-tb-sep" />
      <Btn title={t('Divider', 'editor.divider')} onRun={() => run().setHorizontalRule().run()}><Minus {...ic} /></Btn>
      <Btn title="Table" onRun={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table {...ic} /></Btn>
      <Btn title="Image" onRun={() => ctx.current.events.pickImage()}><ImageIcon {...ic} /></Btn>
      <Btn
        title="Math (inline)"
        onRun={() => {
          const pos = editor.state.selection.from;
          run().insertInlineMath({ latex: '' }).run();
          ctx.current.events.editMath({ kind: 'inline', latex: '', pos });
        }}
      >
        <Sigma {...ic} />
      </Btn>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/ui/SelectionBubble.tsx`**

```tsx
import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { Link2, Unlink } from 'lucide-react';

/** Formatting and link editing over a text selection. */
export function SelectionBubble({ editor }: { editor: Editor }) {
  const [editingLink, setEditingLink] = useState(false);
  const [href, setHref] = useState('');

  const applyLink = (): void => {
    const url = href.trim();
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    else editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setEditingLink(false);
  };

  return (
    <BubbleMenu editor={editor} className="sh-bubble" shouldShow={({ editor: e, from, to }) => from !== to && !e.isActive('codeBlock')}>
      {editingLink ? (
        <input
          autoFocus
          className="sh-bubble-input"
          placeholder="https://…"
          value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditingLink(false); }
          }}
          onBlur={applyLink}
        />
      ) : (
        <>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}><strong>B</strong></button>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}><em>I</em></button>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight().run(); }}>==</button>
          <button
            type="button"
            title="Link"
            onMouseDown={(e) => {
              e.preventDefault();
              setHref(String(editor.getAttributes('link')['href'] ?? ''));
              setEditingLink(true);
            }}
          >
            <Link2 size={13} strokeWidth={1.75} />
          </button>
          {editor.isActive('link') && (
            <button type="button" title="Remove link" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetLink().run(); }}>
              <Unlink size={13} strokeWidth={1.75} />
            </button>
          )}
        </>
      )}
    </BubbleMenu>
  );
}
```

- [ ] **Step 5: Write `src/ui/BlockMenu.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
  Pilcrow, Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, Quote, Code2,
  Copy, ArrowUp, ArrowDown, Link, Tag, Link2, Trash2, ChevronRight,
} from 'lucide-react';
import type { ShuttleContextRef } from '../context';
import type { TurnIntoType } from '../custom/notepad/commands';

interface Props {
  editor: Editor;
  ctx: ShuttleContextRef;
  /** Position just before the target top-level block. */
  pos: number;
  top: number;
  left: number;
  onClose: () => void;
}

const ic = { size: 13, strokeWidth: 1.75 } as const;
const TURN_INTO: { label: string; type: TurnIntoType; level?: 1 | 2 | 3; icon: ReactNode }[] = [
  { label: 'Text', type: 'paragraph', icon: <Pilcrow {...ic} /> },
  { label: 'Heading 1', type: 'heading', level: 1, icon: <Heading1 {...ic} /> },
  { label: 'Heading 2', type: 'heading', level: 2, icon: <Heading2 {...ic} /> },
  { label: 'Heading 3', type: 'heading', level: 3, icon: <Heading3 {...ic} /> },
  { label: 'Bullet list', type: 'bulletList', icon: <List {...ic} /> },
  { label: 'Numbered list', type: 'orderedList', icon: <ListOrdered {...ic} /> },
  { label: 'Task list', type: 'taskList', icon: <CheckSquare {...ic} /> },
  { label: 'Quote', type: 'blockquote', icon: <Quote {...ic} /> },
  { label: 'Code', type: 'codeBlock', icon: <Code2 {...ic} /> },
];

export function BlockMenu({ editor, ctx, pos, top, left, onClose }: Props) {
  const [turnInto, setTurnInto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const node = editor.state.doc.nodeAt(pos);
  const blockId = (node?.attrs['blockId'] as string | null | undefined) ?? null;
  const inside = pos + 1;

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null;
      if (ref.current?.contains(target) || target?.closest('[data-sh-gutter]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    const id = setTimeout(() => window.addEventListener('pointerdown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const run = (fn: () => void) => (): void => { fn(); onClose(); };
  const fragment = (type: 'tag' | 'noteLink') => run(() => { if (blockId) ctx.current.host.onFragmentAction({ type, blockId }); });

  return (
    <div className="sh-menu" style={{ top, left }} ref={ref}>
      <button type="button" className="sh-menu-item" onMouseEnter={() => setTurnInto(true)} onClick={() => setTurnInto((v) => !v)}>
        <Pilcrow {...ic} /><span>Turn into</span><ChevronRight size={12} strokeWidth={2} className="sh-menu-chevron" />
      </button>
      {turnInto && !node?.isAtom && (
        <div className="sh-submenu">
          {TURN_INTO.map((o) => (
            <button type="button" key={o.label} className="sh-menu-item" onClick={run(() => editor.commands.turnInto(inside, o.type, o.level))}>
              {o.icon}<span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="sh-menu-sep" />
      <button type="button" className="sh-menu-item" onClick={run(() => editor.commands.duplicateBlock(inside))}><Copy {...ic} /><span>Duplicate</span></button>
      <button type="button" className="sh-menu-item" onClick={run(() => editor.commands.moveBlock(inside, -1))}><ArrowUp {...ic} /><span>Move up</span></button>
      <button type="button" className="sh-menu-item" onClick={run(() => editor.commands.moveBlock(inside, 1))}><ArrowDown {...ic} /><span>Move down</span></button>
      <div className="sh-menu-sep" />
      <button type="button" className="sh-menu-item" disabled={!blockId} onClick={run(() => { if (blockId) void navigator.clipboard.writeText(blockId); })}><Link {...ic} /><span>Copy block id</span></button>
      <button type="button" className="sh-menu-item" disabled={!blockId} onClick={fragment('tag')}><Tag {...ic} /><span>Tag block</span></button>
      <button type="button" className="sh-menu-item" disabled={!blockId} onClick={fragment('noteLink')}><Link2 {...ic} /><span>Link to note</span></button>
      <div className="sh-menu-sep" />
      <button type="button" className="sh-menu-item is-danger" onClick={run(() => editor.commands.deleteBlock(inside))}><Trash2 {...ic} /><span>Delete</span></button>
    </div>
  );
}
```

- [ ] **Step 6: Write `src/ui/BlockGutter.tsx`**

```tsx
import { useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { GripVertical, Plus } from 'lucide-react';
import type { ShuttleContextRef } from '../context';
import { BlockMenu } from './BlockMenu';

/**
 * Notepad gutter on the official Drag Handle: drag to reorder, `+` to add a
 * block below (opens the slash menu), grip click for the block menu.
 */
export function BlockGutter({ editor, ctx }: { editor: Editor; ctx: ShuttleContextRef }) {
  const hovered = useRef<number>(-1);
  const [menu, setMenu] = useState<{ pos: number; top: number; left: number } | null>(null);
  const close = useCallback(() => setMenu(null), []);

  return (
    <>
      <DragHandle editor={editor} onNodeChange={({ pos }) => { hovered.current = pos; }}>
        <div className="sh-gutter" data-sh-gutter="">
          <button
            type="button"
            className="sh-gutter-btn"
            title="Add block below"
            onClick={() => {
              const pos = hovered.current;
              const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null;
              if (!node) return;
              const after = pos + node.nodeSize;
              editor.chain().focus()
                .insertContentAt(after, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
                .setTextSelection(after + 2)
                .run();
            }}
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="sh-gutter-btn sh-gutter-grip"
            title="Drag to move · click for options"
            onClick={(e) => {
              if (hovered.current < 0) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu({ pos: hovered.current, top: rect.bottom + 4, left: rect.left });
            }}
          >
            <GripVertical size={14} strokeWidth={1.75} />
          </button>
        </div>
      </DragHandle>
      {menu && <BlockMenu editor={editor} ctx={ctx} pos={menu.pos} top={menu.top} left={menu.left} onClose={close} />}
    </>
  );
}
```

- [ ] **Step 7: Write `src/ui/RefPicker.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ArrowLeft, Search } from 'lucide-react';
import type { ShuttleContextRef } from '../context';
import type { BlockSummary, NoteRef } from '../host';

const TYPE_LABELS: Record<string, string> = {
  horizontalRule: 'Divider', blockMath: 'Math block', blockRef: 'Block reference', image: 'Image',
  youtube: 'YouTube', twitch: 'Twitch', table: 'Table', details: 'Toggle',
};

/** Two-step picker: a note, then one of its blocks. */
export function RefPicker({ editor, ctx, onClose }: { editor: Editor; ctx: ShuttleContextRef; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<NoteRef[]>([]);
  const [note, setNote] = useState<NoteRef | null>(null);
  const [blocks, setBlocks] = useState<BlockSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    ctx.current.host.searchNotes(query)
      .then((r) => { if (!cancelled) setNotes(r.filter((n) => n.id !== ctx.current.docKey).slice(0, 40)); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [query, ctx]);

  useEffect(() => {
    if (!note) { setBlocks(null); return; }
    let cancelled = false;
    ctx.current.host.listBlocks(note.id)
      .then((r) => { if (!cancelled) setBlocks(r); })
      .catch(() => { if (!cancelled) setBlocks([]); });
    return () => { cancelled = true; };
  }, [note, ctx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Synthetic ids (`note:index`) are positional and cannot be referenced.
  const referenceable = (blocks ?? []).filter((b) => !b.id.includes(':'));

  return (
    <div className="sh-refpicker" onClick={onClose}>
      <div className="sh-refpicker-panel" onClick={(e) => e.stopPropagation()}>
        {note === null ? (
          <>
            <div className="sh-refpicker-search">
              <Search size={13} strokeWidth={1.75} />
              <input autoFocus placeholder="Which note?" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="sh-refpicker-list">
              {notes.length === 0 ? <p className="sh-refpicker-empty">No other notes</p> : notes.map((n) => (
                <button type="button" key={n.id} className="sh-refpicker-row" onClick={() => setNote(n)}>{n.title || 'Untitled'}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="sh-refpicker-head">
              <button type="button" className="sh-refpicker-back" onClick={() => setNote(null)}><ArrowLeft size={13} strokeWidth={2} /> Notes</button>
              <span>{note.title || 'Untitled'}</span>
            </div>
            <div className="sh-refpicker-list">
              {blocks === null ? <p className="sh-refpicker-empty">Loading…</p>
                : referenceable.length === 0 ? <p className="sh-refpicker-empty">Nothing referenceable in this note.</p>
                : referenceable.map((b) => (
                  <button
                    type="button"
                    key={b.id}
                    className="sh-refpicker-row"
                    onClick={() => { editor.chain().focus().insertBlockRef(b.id, b.noteId).run(); onClose(); }}
                  >
                    <span>{b.text || TYPE_LABELS[b.type] || b.type}</span>
                    <span className="sh-refpicker-meta">{b.type === 'heading' ? `h${b.level ?? ''}` : b.type}</span>
                  </button>
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Write `src/ui/MathEditor.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import katex from 'katex';
import type { MathEditRequest } from '../context';

/** Edit a math node's LaTeX with a live preview. Empty input deletes the node. */
export function MathEditor({ editor, request, onClose }: { editor: Editor; request: MathEditRequest; onClose: () => void }) {
  const [latex, setLatex] = useState(request.latex);
  const preview = useMemo(
    () => katex.renderToString(latex || '\\;', { throwOnError: false, displayMode: request.kind === 'block' }),
    [latex, request.kind],
  );

  const save = (): void => {
    const value = latex.trim();
    const chain = editor.chain().focus();
    if (request.kind === 'inline') {
      (value ? chain.updateInlineMath({ latex: value, pos: request.pos }) : chain.deleteInlineMath({ pos: request.pos })).run();
    } else {
      (value ? chain.updateBlockMath({ latex: value, pos: request.pos }) : chain.deleteBlockMath({ pos: request.pos })).run();
    }
    onClose();
  };

  return (
    <div className="sh-dialog" role="dialog" aria-label="Edit formula">
      <textarea
        autoFocus
        className="sh-math-input"
        value={latex}
        placeholder="LaTeX, e.g. E = mc^2"
        onChange={(e) => setLatex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
      />
      <div className="sh-math-preview" dangerouslySetInnerHTML={{ __html: preview }} />
      <div className="sh-dialog-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="is-primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Write `src/ui/FindBar.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

/** Find and replace on the official FindAndReplace extension. */
export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const { count, index } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      count: e.storage.findAndReplace.results.length,
      index: e.storage.findAndReplace.currentIndex,
    }),
  });

  useEffect(() => { editor.commands.setSearchTerm(term); }, [term, editor]);
  useEffect(() => { editor.commands.setReplaceTerm(replacement); }, [replacement, editor]);

  const close = (): void => { editor.commands.clearSearch(); onClose(); editor.commands.focus(); };

  return (
    <div className="sh-findbar" role="search">
      <input
        autoFocus
        placeholder="Find"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) editor.commands.goToPreviousResult(); else editor.commands.goToNextResult(); }
          if (e.key === 'Escape') { e.preventDefault(); close(); }
        }}
      />
      <span className="sh-findbar-count">{count === 0 ? '0/0' : `${(index ?? 0) + 1}/${count}`}</span>
      <button type="button" title="Previous" onClick={() => editor.commands.goToPreviousResult()}><ChevronUp size={13} /></button>
      <button type="button" title="Next" onClick={() => editor.commands.goToNextResult()}><ChevronDown size={13} /></button>
      <input placeholder="Replace" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
      <button type="button" onClick={() => editor.commands.replace()}>Replace</button>
      <button type="button" onClick={() => editor.commands.replaceAll()}>All</button>
      <button type="button" title="Close" onClick={close}><X size={13} /></button>
    </div>
  );
}
```

- [ ] **Step 10: Write `src/ui/Outline.tsx`**

```tsx
import type { Editor } from '@tiptap/core';
import type { TableOfContentData } from '@tiptap/extension-table-of-contents';

/** Heading outline from the official TableOfContents extension. */
export function Outline({ items, editor }: { items: TableOfContentData; editor: Editor }) {
  if (items.length < 2) return null;
  return (
    <nav className="sh-outline" aria-label="Outline">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`sh-outline-item level-${item.level}${item.isActive ? ' is-active' : ''}`}
          onClick={() => {
            editor.chain().focus().setTextSelection(item.pos + 1).run();
            item.dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        >
          {item.textContent || 'Untitled'}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 11: Run — expect pass**

Run: `bun test test/ui.test.tsx` → `3 pass`. Then `bun test` → all pass, and `pnpm typecheck` → clean.

- [ ] **Step 12: Commit**

```bash
git add src/ui test/ui.test.tsx
git commit -m "Add Shuttle's UI: toolbar, bubble menu, block gutter and menu, ref picker, math editor, find bar, outline"
```

---

### Task 14: Stylesheet

**Files:**
- Create: `src/styles/shuttle.css`

No test (visual); verified in the playground in Task 15.

- [ ] **Step 1: Write `src/styles/shuttle.css`**

```css
/*
 * Shuttle's stylesheet. Colours read host variables first (Cord's --accent,
 * --bg-*, --text-*), then fall back to neutral defaults, so the package looks
 * right in Cord and standalone.
 */
@import 'katex/dist/katex.min.css';

.sh-root {
  --sh-accent: var(--accent, #7aa2f7);
  --sh-bg: var(--bg-primary, #ffffff);
  --sh-bg-raised: var(--bg-secondary, #f5f5f7);
  --sh-border: var(--border, #e3e3e8);
  --sh-text: var(--text-primary, #1d1d22);
  --sh-muted: var(--text-muted, #8a8a94);
  --sh-link: var(--link-color, var(--sh-accent));
  --sh-radius: 6px;
  --sh-font-size: var(--editor-font-size, 15px);
  position: relative;
  display: flex;
  flex-direction: column;
  color: var(--sh-text);
  font-size: var(--sh-font-size);
}

/* ── Content ─────────────────────────────────────────────────────────────── */
.sh-content { position: relative; flex: 1; }
.sh-mode-notepad .sh-content { padding-left: 44px; }
.sh-prose .ProseMirror { outline: none; line-height: 1.65; padding: 8px 0 40vh; }
.sh-prose .ProseMirror > * + * { margin-top: 0.5em; }
.sh-prose .ProseMirror p.is-editor-empty:first-child::before,
.sh-prose .ProseMirror .is-empty::before {
  content: attr(data-placeholder); color: var(--sh-muted); float: left; height: 0; pointer-events: none;
}
.sh-prose h1 { font-size: 1.8em; font-weight: 700; }
.sh-prose h2 { font-size: 1.4em; font-weight: 650; }
.sh-prose h3 { font-size: 1.15em; font-weight: 600; }
.sh-prose blockquote { border-left: 3px solid var(--sh-border); padding-left: 12px; color: var(--sh-muted); }
.sh-prose code { background: var(--sh-bg-raised); border-radius: 4px; padding: 0.1em 0.35em; font-size: 0.9em; }
.sh-prose pre { background: var(--sh-bg-raised); border-radius: var(--sh-radius); padding: 10px 12px; overflow-x: auto; }
.sh-prose pre code { background: none; padding: 0; }
.sh-prose mark { background: color-mix(in srgb, var(--sh-accent) 30%, transparent); color: inherit; border-radius: 2px; }
.sh-prose a { color: var(--sh-link); text-decoration: underline; text-underline-offset: 2px; }
.sh-prose hr { border: none; border-top: 1px solid var(--sh-border); margin: 1em 0; }
.sh-prose img { max-width: 100%; border-radius: var(--sh-radius); }
.sh-prose img[data-upload-error] { outline: 2px dashed #e5484d; cursor: pointer; opacity: 0.6; }
.sh-prose iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: var(--sh-radius); }
.sh-prose table { border-collapse: collapse; width: 100%; }
.sh-prose th, .sh-prose td { border: 1px solid var(--sh-border); padding: 4px 8px; vertical-align: top; }
.sh-prose th { background: var(--sh-bg-raised); font-weight: 600; }
.sh-prose .selectedCell { background: color-mix(in srgb, var(--sh-accent) 15%, transparent); }
.sh-prose ul[data-type='taskList'] { list-style: none; padding-left: 4px; }
.sh-prose ul[data-type='taskList'] li { display: flex; gap: 8px; align-items: flex-start; }
.sh-prose ul[data-type='taskList'] input[type='checkbox'] { accent-color: var(--sh-accent); margin-top: 0.35em; }
.sh-prose ul[data-type='taskList'] li[data-checked='true'] > div { color: var(--sh-muted); text-decoration: line-through; }
.sh-prose .sh-details { border: 1px solid var(--sh-border); border-radius: var(--sh-radius); padding: 6px 10px; }
.sh-prose .sh-has-focus { border-radius: 4px; }
.sh-mode-notepad .sh-prose .sh-has-focus { box-shadow: -3px 0 0 color-mix(in srgb, var(--sh-accent) 45%, transparent); }
.sh-prose .unlinked-mention { text-decoration: underline dotted var(--sh-muted); text-underline-offset: 3px; }
.sh-prose .find-and-replace-result { background: color-mix(in srgb, #f5c542 45%, transparent); }
.sh-prose .find-and-replace-result-current { background: #f5c542; }
.sh-prose .tiptap-mathematics-render { cursor: pointer; }

/* ── Links and references ────────────────────────────────────────────────── */
.sh-wikilink-label, .sh-fragment-link span { color: var(--sh-link); cursor: pointer; border-radius: 3px; }
.sh-wikilink-label:hover, .sh-fragment-link span:hover { background: color-mix(in srgb, var(--sh-accent) 12%, transparent); }
.sh-wikilink-input { font: inherit; border: 1px solid var(--sh-accent); border-radius: 3px; padding: 0 3px; }
.sh-blockref { border-left: 3px solid var(--sh-accent); background: var(--sh-bg-raised); border-radius: var(--sh-radius); padding: 6px 10px; }
.sh-blockref.is-missing { border-left-color: var(--sh-muted); }
.sh-blockref-source { display: inline-flex; gap: 4px; align-items: center; font-size: 0.8em; color: var(--sh-muted); background: none; border: 0; cursor: pointer; padding: 0; }
.sh-blockref-status { display: flex; gap: 6px; align-items: center; color: var(--sh-muted); font-size: 0.85em; }

/* ── Chrome ─────────────────────────────────────────────────────────────── */
.sh-legacy { background: var(--sh-bg-raised); border: 1px solid var(--sh-border); border-radius: var(--sh-radius); padding: 8px 12px; color: var(--sh-muted); margin-bottom: 8px; }
.sh-toolbar { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px 0; border-bottom: 1px solid var(--sh-border); margin-bottom: 8px; }
.sh-tb-btn { min-width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 0; background: none; color: var(--sh-muted); border-radius: 4px; cursor: pointer; }
.sh-tb-btn:hover { background: var(--sh-bg-raised); color: var(--sh-text); }
.sh-tb-btn.is-active { color: var(--sh-accent); background: color-mix(in srgb, var(--sh-accent) 12%, transparent); }
.sh-tb-sep { width: 1px; background: var(--sh-border); margin: 4px 4px; }
.sh-bubble { display: flex; gap: 2px; background: var(--sh-bg); border: 1px solid var(--sh-border); border-radius: var(--sh-radius); padding: 2px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.12); }
.sh-bubble button { border: 0; background: none; min-width: 26px; height: 26px; border-radius: 4px; cursor: pointer; color: var(--sh-text); }
.sh-bubble button:hover { background: var(--sh-bg-raised); }
.sh-bubble-input { border: 0; outline: none; padding: 0 6px; min-width: 220px; background: transparent; color: var(--sh-text); }
.sh-gutter { display: flex; gap: 2px; }
.sh-gutter-btn { width: 20px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 0; background: none; color: var(--sh-muted); border-radius: 4px; cursor: pointer; }
.sh-gutter-btn:hover { background: var(--sh-bg-raised); color: var(--sh-text); }
.sh-gutter-grip { cursor: grab; }

/* ── Popups and menus ───────────────────────────────────────────────────── */
.sh-popup-anchor { position: fixed; z-index: 9999; }
.sh-popup, .sh-menu, .sh-submenu, .sh-dialog, .sh-refpicker-panel, .sh-findbar {
  background: var(--sh-bg); border: 1px solid var(--sh-border); border-radius: 8px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.14); color: var(--sh-text);
}
.sh-popup { max-height: 260px; max-width: 280px; overflow-y: auto; padding: 4px; }
.sh-popup-header { font-size: 0.75em; color: var(--sh-muted); padding: 4px 8px; display: flex; justify-content: space-between; gap: 8px; }
.sh-popup-hint { font-family: monospace; }
.sh-popup-group { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sh-muted); padding: 6px 8px 2px; }
.sh-popup-item, .sh-menu-item, .sh-refpicker-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: 0; background: none; border-radius: 5px; text-align: left; cursor: pointer; color: inherit; font: inherit; font-size: 0.9em; }
.sh-popup-item.is-selected, .sh-popup-item:hover, .sh-menu-item:hover, .sh-refpicker-row:hover { background: var(--sh-bg-raised); }
.sh-popup-icon { color: var(--sh-muted); display: inline-flex; font-family: monospace; }
.sh-popup-empty, .sh-refpicker-empty { color: var(--sh-muted); padding: 8px; font-size: 0.85em; }
.sh-menu { position: fixed; z-index: 9999; min-width: 190px; padding: 4px; }
.sh-submenu { position: absolute; left: 100%; top: 0; margin-left: 4px; padding: 4px; min-width: 160px; }
.sh-menu-sep { height: 1px; background: var(--sh-border); margin: 4px 0; }
.sh-menu-item:disabled { opacity: 0.4; cursor: default; }
.sh-menu-item.is-danger { color: #e5484d; }
.sh-menu-chevron { margin-left: auto; }
.sh-refpicker { position: fixed; inset: 0; background: rgb(0 0 0 / 0.25); display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; z-index: 9998; }
.sh-refpicker-panel { width: min(480px, 92vw); max-height: 60vh; display: flex; flex-direction: column; }
.sh-refpicker-search, .sh-refpicker-head { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--sh-border); }
.sh-refpicker-search input { flex: 1; border: 0; outline: none; background: transparent; color: inherit; font: inherit; }
.sh-refpicker-back { display: inline-flex; gap: 4px; align-items: center; border: 0; background: none; color: var(--sh-muted); cursor: pointer; }
.sh-refpicker-list { overflow-y: auto; padding: 4px; }
.sh-refpicker-meta { margin-left: auto; color: var(--sh-muted); font-size: 0.8em; }
.sh-dialog { position: fixed; z-index: 9999; left: 50%; top: 20vh; transform: translateX(-50%); width: min(460px, 92vw); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.sh-math-input { min-height: 70px; font-family: monospace; resize: vertical; border: 1px solid var(--sh-border); border-radius: 5px; padding: 6px; background: var(--sh-bg-raised); color: inherit; }
.sh-math-preview { min-height: 32px; overflow-x: auto; }
.sh-dialog-actions { display: flex; justify-content: flex-end; gap: 6px; }
.sh-dialog-actions button { border: 1px solid var(--sh-border); background: none; border-radius: 5px; padding: 4px 10px; cursor: pointer; color: inherit; }
.sh-dialog-actions .is-primary { background: var(--sh-accent); border-color: var(--sh-accent); color: #fff; }
.sh-findbar { position: sticky; top: 0; z-index: 20; display: flex; gap: 4px; align-items: center; padding: 4px 6px; margin-bottom: 6px; }
.sh-findbar input { border: 1px solid var(--sh-border); border-radius: 4px; padding: 2px 6px; background: var(--sh-bg-raised); color: inherit; min-width: 0; }
.sh-findbar button { border: 0; background: none; cursor: pointer; color: var(--sh-muted); padding: 2px 6px; border-radius: 4px; }
.sh-findbar button:hover { background: var(--sh-bg-raised); color: var(--sh-text); }
.sh-findbar-count { font-size: 0.8em; color: var(--sh-muted); min-width: 36px; text-align: center; }
.sh-outline { position: absolute; right: -200px; top: 48px; width: 180px; display: flex; flex-direction: column; gap: 1px; }
.sh-outline-item { text-align: left; border: 0; background: none; color: var(--sh-muted); font-size: 0.8em; padding: 2px 6px; border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sh-outline-item.level-2 { padding-left: 16px; }
.sh-outline-item.level-3 { padding-left: 26px; }
.sh-outline-item.is-active { color: var(--sh-accent); }
.sh-outline-item:hover { background: var(--sh-bg-raised); color: var(--sh-text); }

@media (prefers-reduced-motion: no-preference) {
  .sh-popup, .sh-menu { animation: sh-pop 120ms cubic-bezier(0.16, 1, 0.3, 1); }
  /* The dialog is centred with a transform, so it only fades. */
  .sh-dialog { animation: sh-fade 120ms ease-out; }
}
@keyframes sh-pop { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
@keyframes sh-fade { from { opacity: 0; } to { opacity: 1; } }
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/shuttle.css
git commit -m "Add Shuttle's stylesheet with host-variable theming"
```

---

### Task 15: Public exports and the playground

**Files:**
- Modify: `src/index.ts`
- Create: `playground/index.html`, `playground/main.tsx`, `playground/vite.config.ts`
- Test: `test/exports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import * as shuttle from '../src';

describe('public API', () => {
  it('exports the editor, contract helpers and catalogue', () => {
    for (const name of [
      'ShuttleEditor', 'buildExtensions', 'createFakeHost', 'SHUTTLE_KEYBINDINGS', 'eventToAccel',
      'formatAccel', 'resolveBindings', 'BLOCK_TYPES', 'isValidDoc', 'EMPTY_DOC', 'topLevelAt', 'blockIdAt',
    ]) {
      expect(shuttle).toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test test/exports.test.ts`

- [ ] **Step 3: Write `src/index.ts`**

```ts
export { ShuttleEditor, type ShuttleEditorProps } from './ShuttleEditor';
export type {
  ShuttleHost, ShuttleMode, NoteRef, BlockSummary, ResolvedBlock, FragmentActionType, LogLevel,
} from './host';
export type { ShuttleContext, ShuttleContextRef, ShuttleUiEvents, MathEditRequest } from './context';
export { buildExtensions, type BuildOptions } from './extensions';
export { BLOCK_TYPES } from './extensions/blockTypes';
export {
  SHUTTLE_KEYBINDINGS, eventToAccel, formatAccel, resolveBindings,
  type KeybindingId, type KeybindingDef, type KeybindingMap,
} from './custom/keybindings/defs';
export { isValidDoc, EMPTY_DOC } from './doc/validate';
export { topLevelAt, blockIdAt } from './doc/topLevel';
export type { FragmentLinkAttrs } from './custom/links/fragmentLink';
export { createFakeHost, type FakeHost } from './testing/fakeHost';
export type { Editor, JSONContent } from '@tiptap/core';
```

- [ ] **Step 4: Write the playground**

`playground/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5199 },
});
```

`playground/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Shuttle playground</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #fafafa; }
      main { max-width: 760px; margin: 0 auto; padding: 24px 16px; }
      header { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
      .stats { margin-left: auto; color: #888; font-size: 13px; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`playground/main.tsx`:
```tsx
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { JSONContent } from '@tiptap/core';
import { ShuttleEditor, createFakeHost, type ShuttleMode } from '../src';
import '../src/styles/shuttle.css';

const NOTES = [
  { id: 'n-alpha', title: 'Alpha' },
  { id: 'n-beta', title: 'Beta' },
  { id: 'n-gamma', title: 'Gamma Ray' },
];

function App() {
  const [mode, setMode] = useState<ShuttleMode>('notepad');
  const [docKey, setDocKey] = useState('n-alpha');
  const [docs, setDocs] = useState<Record<string, JSONContent>>({});
  const [stats, setStats] = useState({ words: 0, characters: 0 });
  const host = useMemo(() => createFakeHost({
    notes: NOTES,
    blocks: [{ id: 'b-beta-1', noteId: 'n-beta', type: 'paragraph', text: 'A block that lives in Beta', level: null }],
    resolved: [{
      blockId: 'b-beta-1', noteId: 'n-beta', noteTitle: 'Beta',
      content: { type: 'paragraph', content: [{ type: 'text', text: 'A block that lives in Beta' }] },
    }],
  }), []);

  return (
    <main>
      <header>
        {NOTES.map((n) => (
          <button key={n.id} onClick={() => setDocKey(n.id)} disabled={n.id === docKey}>{n.title}</button>
        ))}
        <button onClick={() => setMode(mode === 'note' ? 'notepad' : 'note')}>mode: {mode}</button>
        <span className="stats">{stats.words} words · {stats.characters} chars</span>
      </header>
      <ShuttleEditor
        docKey={docKey}
        doc={docs[docKey] ?? null}
        mode={mode}
        host={host}
        outline
        onChange={(key, doc) => setDocs((d) => ({ ...d, [key]: doc }))}
        onStats={setStats}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 5: Run tests, typecheck, and the playground**

Run: `bun test` → all pass. Run: `pnpm typecheck` → clean.
Run: `pnpm playground`, open `http://localhost:5199`, and check by hand:
1. Typing, `/` menu (every item including templates, Table, Toggle, Math), `[[` autocomplete, typed `[[Beta|b]]`.
2. Notepad mode: gutter appears on hover, drag reorders, grip opens the block menu, `+` opens the slash menu.
3. Paste a YouTube URL and a Twitch URL → embeds. Paste a markdown table → table. Copy a selection → markdown in the clipboard.
4. Drop or paste an image → preview, then `https://fake.local/up1` src.
5. Ctrl+F → find bar highlights; Esc closes.
6. Switch notes: edits persist per note (onChange state).
Record any failures as fixes in this task before committing.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts playground test/exports.test.ts
git commit -m "Export the public API and add a playground with a fake host"
```

---

### Task 16: README and final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# Shuttle

Cord's editor, as a standalone React package: official [Tiptap 3](https://tiptap.dev) extensions plus the few
pieces Tiptap has no equivalent for.

## Use

```tsx
import { ShuttleEditor } from '@cord/shuttle';
import '@cord/shuttle/styles.css';

<ShuttleEditor
  docKey={note.id}
  doc={note.bodyJson}
  mode={note.kind}           // 'note' | 'notepad'
  host={host}                // implements ShuttleHost
  onChange={(id, doc) => save(id, doc)}
/>
```

Everything Shuttle needs from the embedding app goes through `ShuttleHost` (`src/host.ts`). Shuttle never imports
the host's stores, IPC or platform APIs.

## What is official, what is custom

**Official Tiptap 3 (MIT):** StarterKit (incl. Link, Underline, ListKeymap, TrailingNode, UndoRedo),
CodeBlockLowlight, TaskList/TaskItem, Mathematics, Mention, Image, Youtube, Twitch, FileHandler, UniqueID,
DragHandleReact, Placeholder, CharacterCount, BubbleMenu, Selection, Focus, TableKit, Details, Highlight,
Subscript, Superscript, FindAndReplace, TableOfContents, Markdown.

**Custom:**

| Piece | Built on |
|---|---|
| `[[wiki links]]` | `Mention.extend` — alias, typed-link input rules, React view, markdown |
| `fragmentLink` | small inline node, inserted by the host |
| `blockRef` | read-only transclusion atom; stores ids only |
| Notepad mode | block commands over top-level nodes + Drag Handle gutter and block menu |
| Slash menu | official Suggestion |
| Keybindings | rebindable, host supplies overrides |
| Unlinked mentions | decoration plugin |
| Markdown glue | `:::details`, `![[note#block]]`, `[[…]]` tokens; markdown clipboard |
| Images | Image attrs for upload state; `src` resolved through the host |

**Deliberately not used:** TextStyle kit, colours, font family/size, line height, text align, Typography,
FloatingMenu, Emoji, Ruby text, InvisibleCharacters, Collaboration (later), all paid extensions.

## Develop

```bash
pnpm install
bun test
pnpm typecheck
pnpm playground   # http://localhost:5199, fake host
```

Stored documents are Tiptap JSON. Every block-level node carries a `blockId` (UniqueID). A document that does
not fit the schema opens read-only and is never saved over.
````

- [ ] **Step 2: Full verification**

Run: `bun test` → all pass, 0 fail. Run: `pnpm typecheck` → no errors.
Paste both outputs into the task report.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document Shuttle's API and its official/custom split"
```

Do not push. Plan B (Cord cutover) starts from this branch.
