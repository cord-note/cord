# Shuttle Phase 1 — Plan B: Cord cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cord's built-in Tiptap 2 editor with the published `shuttle-editor` package, with Cord supplying a `ShuttleHost` over its IPC, links derived from saved content, and image attachments stored beside the database.

**Architecture:** Part 1 ships Shuttle 0.2.0 with three things Cord needs (a Twitch switch plus external controls, a React-free `shuttle-editor/doc` entry for the sidecar, code-highlighting styles). Part 2 swaps the editor in Cord: the sidecar reads documents through `shuttle-editor/doc`, derives `note_links` on save, stores attachments; Rust serves attachments through a `cord-attachment` URI scheme; the renderer implements `ShuttleHost`, keeps its title/tags/status bar and its fragment overlays, and deletes `components/editor/`.

**Tech Stack:** shuttle-editor (Tiptap 3), React 18, Zustand, Bun sidecar + Drizzle/bun:sqlite, Tauri 2 (Rust), tsup (Shuttle build).

**Decisions (user, 2026-09-27):** Cord depends on `shuttle-editor` from npm (no submodule). `note_links` is rebuilt from saved content on every save. Twitch is turned off in Cord. Old notes are expendable: documents that don't fit the new schema open read-only (Shuttle's legacy preview) and are never rewritten.

**Repos:**
- Part 1 — `C:\Users\Olek\Downloads\evrything-cord\shuttle` (public `cord-note/shuttle`, branch `main`).
- Part 2 — `C:\Users\Olek\Downloads\evrything-cord\cord` (`cord-note/cord`), branch `feature/shuttle-editor` (already created from `origin/main`).

**Rules for every task:** foreground commands only; never search outside the repo being worked on (plus reading the sibling repo when a task says so); commit messages carry NO Co-Authored-By/Claude attribution; git identity is already the noreply address in both repos — never change it; do not push unless the task says so; no dev servers.

**Test commands:**
- Shuttle: `bun test`, `pnpm typecheck`, `pnpm build`.
- Cord: `pnpm --filter @cord/desktop test` (runs `CORD_DB_PATH=:memory: bun test src` — NEVER run `bun test` in `apps/desktop` without `CORD_DB_PATH=:memory:`, it would write to the real `~/.cord/cord.db`), `pnpm --filter @cord/desktop typecheck`, `pnpm --filter @cord/desktop build:renderer`, and in `apps/desktop/src-tauri`: `cargo test`.

---

# Part 1 — Shuttle 0.2.0

### Task S1: Twitch switch and external controls

**Files:** Modify `src/extensions/index.ts`, `src/ShuttleEditor.tsx`, `src/index.ts`; Test `test/ShuttleEditor.test.tsx`, `test/schema.test.ts`

- [ ] **Step 1: Failing tests.**
  - `test/schema.test.ts`: build with `buildExtensions('note', ctx, { reactViews: false, twitchParent: 'localhost', twitch: false })` (extend `makeEditor` with an optional `build` override) → the schema still has `twitch` (old documents with Twitch embeds must load) and `view.pasteText('https://www.twitch.tv/videos/1234567890')` produces NO `twitch` node; with the default (`twitch` omitted) the same paste produces a `twitch` node.
  - `test/ShuttleEditor.test.tsx`: `onReady` receives a second argument `controls` with `openRefPicker`, `openFind`, `pickImage`; calling `controls.openFind()` inside `act` renders the find bar (`input[placeholder="Find"]`); `controls.openRefPicker()` renders `.sh-refpicker`; `onReady(null, null)` on unmount.
- [ ] **Step 2: Implement.**
  - `BuildOptions` gains `twitch?: boolean` (default `true`). When `false`: `Twitch.configure({ parent: options.twitchParent, addPasteHandler: false })`; when true, as now.
  - `ShuttleEditorProps` gains `twitch?: boolean` (default `true`, passed to `buildExtensions`, part of the `useMemo` deps) and `onReady?: (editor: Editor | null, controls: ShuttleControls | null) => void`.
  - Export `interface ShuttleControls { openRefPicker(): void; openFind(): void; pickImage(): void }` from `src/ShuttleEditor.tsx` and from `src/index.ts`. The controls object is the same `events` memo the component already builds (stable identity).
  - Keep `onReady(editor)` callers working: the second argument is extra.
- [ ] **Step 3:** `bun test`, `pnpm typecheck` pass. Commit: `Let hosts switch off Twitch and open Shuttle's dialogs`.

### Task S2: React-free `shuttle-editor/doc` entry

The Cord sidecar (Bun, no DOM, no React) must read Shuttle documents: block text for search, wiki-link targets for `note_links`, top-level blocks for the index, a block by id for transclusion. This module is pure TypeScript over plain JSON.

**Files:** Create `src/doc-core/index.ts`; Modify `tsup.config.ts`, `package.json`, `src/extensions/blockTypes.ts` (no change in content; `doc-core` re-exports from it); Test `test/docCore.test.ts`

- [ ] **Step 1: Failing test `test/docCore.test.ts`** (imports from `../src/doc-core`):
  - `nodeText` of a paragraph `[text 'bo', text 'ld' (bold), mention {label:'Alpha', displayText:null}, text ' and ', inlineMath {latex:'x^2'}]` is `'bold Alpha and x^2'` — inline pieces concatenate (no space inserted between `bo` and `ld`), atoms contribute their label/latex; a mention with `displayText: 'alias'` contributes `'alias'`; `image` contributes its `alt`; `fragmentLink` its `label`; `hardBreak` a space; nested blocks (list items, table cells, details) are separated by a single space; whitespace collapsed and trimmed.
  - `topLevelBlocks(doc)` returns `[{ index, type, blockId, node }]` for each top-level node (`blockId` = `attrs.blockId` if a non-empty string, else `null`).
  - `wikiLinkTargets(doc)` returns unique `mention` `attrs.id` strings anywhere in the tree, in document order.
  - `fragmentLinkIds(doc)` returns unique `fragmentLink` `attrs.linkId` strings.
  - `findTopLevelBlock(doc, id)` returns the top-level node with that blockId or `null`.
  - All functions tolerate malformed input (`null`, non-objects, missing `content`) without throwing.
  - Importing `../src/doc-core` must not load React or Tiptap: assert with `const src = readFileSync('src/doc-core/index.ts','utf8')` that it has no import other than `../extensions/blockTypes`.
- [ ] **Step 2: Write `src/doc-core/index.ts`:**

```ts
/**
 * Pure helpers over a stored Shuttle document (Tiptap JSON). No React, no
 * Tiptap, no DOM — safe to import from servers and workers via
 * `shuttle-editor/doc`.
 */
export { BLOCK_TYPES, BLOCK_ID_ATTRIBUTE } from '../extensions/blockTypes';

export interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface TopLevelBlock {
  index: number;
  type: string;
  blockId: string | null;
  node: DocNode;
}

const isNode = (v: unknown): v is DocNode => typeof v === 'object' && v !== null && !Array.isArray(v);
const children = (n: DocNode): DocNode[] => (Array.isArray(n.content) ? n.content.filter(isNode) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Text an atom contributes to search/excerpts. */
function atomText(n: DocNode): string {
  const a = n.attrs ?? {};
  switch (n.type) {
    case 'mention': return str(a['displayText']) || str(a['label']);
    case 'inlineMath':
    case 'blockMath': return str(a['latex']);
    case 'image': return str(a['alt']);
    case 'fragmentLink': return str(a['label']);
    case 'hardBreak': return ' ';
    default: return '';
  }
}

function collect(n: DocNode, out: string[]): void {
  if (typeof n.text === 'string') { out.push(n.text); return; }
  const own = atomText(n);
  if (own) out.push(own);
  const kids = children(n);
  if (kids.length === 0) return;
  // Inline children concatenate; block children are separated by a space.
  const inline = kids.every((k) => typeof k.text === 'string' || ['mention', 'inlineMath', 'fragmentLink', 'hardBreak'].includes(k.type ?? ''));
  for (const k of kids) {
    if (!inline) out.push(' ');
    collect(k, out);
  }
}

/** Plain text of a node and its descendants, whitespace collapsed. */
export function nodeText(node: unknown): string {
  if (!isNode(node)) return '';
  const out: string[] = [];
  collect(node, out);
  return out.join('').replace(/\s+/g, ' ').trim();
}

export function topLevelBlocks(doc: unknown): TopLevelBlock[] {
  if (!isNode(doc)) return [];
  return children(doc).map((node, index) => {
    const id = node.attrs?.['blockId'];
    return { index, type: node.type ?? 'paragraph', blockId: typeof id === 'string' && id ? id : null, node };
  });
}

function walk(n: DocNode, visit: (n: DocNode) => void): void {
  visit(n);
  for (const k of children(n)) walk(k, visit);
}

function uniqueAttr(doc: unknown, type: string, attr: string): string[] {
  if (!isNode(doc)) return [];
  const seen = new Set<string>();
  walk(doc, (n) => {
    const v = n.attrs?.[attr];
    if (n.type === type && typeof v === 'string' && v) seen.add(v);
  });
  return [...seen];
}

/** Note ids targeted by `[[wiki links]]` anywhere in the document. */
export const wikiLinkTargets = (doc: unknown): string[] => uniqueAttr(doc, 'mention', 'id');

/** Link ids of fragment link nodes anywhere in the document. */
export const fragmentLinkIds = (doc: unknown): string[] => uniqueAttr(doc, 'fragmentLink', 'linkId');

export function findTopLevelBlock(doc: unknown, blockId: string): DocNode | null {
  return topLevelBlocks(doc).find((b) => b.blockId === blockId)?.node ?? null;
}
```

(Adjust `nodeText`'s inline/block spacing until the tests pass exactly; keep it dependency-free.)

- [ ] **Step 3: Package wiring.**
  - `tsup.config.ts`: `entry: { index: 'src/index.ts', doc: 'src/doc-core/index.ts' }` → emits `dist/doc.js` + `dist/doc.d.ts`.
  - `package.json` `exports` (source, for local use): add `"./doc": "./src/doc-core/index.ts"`. `publishConfig.exports`: add `"./doc": { "types": "./dist/doc.d.ts", "import": "./dist/doc.js" }`.
  - Verify `pnpm build`, then `pnpm pack --pack-destination .tmp` and check the packed package.json has `./doc`, and `node --input-type=module -e "const m = await import('./dist/doc.js'); console.log(Object.keys(m).sort().join(','))"` prints the helpers without loading React (check `dist/doc.js` imports nothing: `grep -c "^import" dist/doc.js` → 0). Delete `.tmp`.
  - README: add a short "Reading documents on a server" section showing `import { nodeText, wikiLinkTargets } from 'shuttle-editor/doc'`.
- [ ] **Step 4:** `bun test`, `pnpm typecheck`, `pnpm build`. Commit: `Add a React-free shuttle-editor/doc entry for servers`.

### Task S3: Code highlighting and monospace styles

**Files:** Modify `src/styles/shuttle.css`; Test `test/styles.test.ts`

- [ ] **Step 1: Failing test** in `test/styles.test.ts`: the CSS contains rules for `.hljs-keyword`, `.hljs-string`, `.hljs-comment`, `.hljs-number`, `.hljs-title`, `.hljs-built_in`, `.hljs-type`, `.hljs-attr`, `.hljs-variable`, `.hljs-meta`, `.hljs-tag`, `.hljs-operator` inside `.sh-prose pre`, each using a `var(--syntax-…, <fallback>)`; and code uses `var(--font-mono, …)`.
- [ ] **Step 2: Implement.** Add to `.sh-root, .sh-popup-anchor` variables: `--sh-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);` and `--sh-code: var(--code-color, inherit);`. Use `font-family: var(--sh-mono)` for `.sh-prose code, .sh-prose pre`, `color: var(--sh-code)` for inline code. Token colours (fallbacks = GitHub light palette, readable on white):

```css
.sh-prose pre .hljs-keyword, .sh-prose pre .hljs-literal, .sh-prose pre .hljs-selector-tag { color: var(--syntax-keyword, #cf222e); }
.sh-prose pre .hljs-string, .sh-prose pre .hljs-regexp { color: var(--syntax-string, #0a3069); }
.sh-prose pre .hljs-comment, .sh-prose pre .hljs-quote { color: var(--syntax-comment, #6e7781); font-style: italic; }
.sh-prose pre .hljs-number { color: var(--syntax-number, #0550ae); }
.sh-prose pre .hljs-title, .sh-prose pre .hljs-title.function_ { color: var(--syntax-function, #8250df); }
.sh-prose pre .hljs-built_in { color: var(--syntax-builtin, #953800); }
.sh-prose pre .hljs-type, .sh-prose pre .hljs-title.class_ { color: var(--syntax-type, #953800); }
.sh-prose pre .hljs-attr, .sh-prose pre .hljs-attribute, .sh-prose pre .hljs-property { color: var(--syntax-attr, #0550ae); }
.sh-prose pre .hljs-variable, .sh-prose pre .hljs-params { color: var(--syntax-variable, #24292f); }
.sh-prose pre .hljs-meta { color: var(--syntax-meta, #6e7781); }
.sh-prose pre .hljs-tag, .sh-prose pre .hljs-name { color: var(--syntax-tag, #116329); }
.sh-prose pre .hljs-operator, .sh-prose pre .hljs-punctuation { color: var(--syntax-operator, #24292f); }
```
  README theming table: add `--font-mono`, `--code-color`, `--syntax-*`.
- [ ] **Step 3:** `bun test`, `pnpm typecheck`. Commit: `Colour highlighted code from the host's syntax palette`.

### Task S4: Release 0.2.0

**Files:** Modify `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `package.json`, `CHANGELOG.md`

- [ ] **Step 1:** Upgrade `actions/checkout@v4` → `@v5` and `actions/setup-node@v4` → `@v5` in both workflows (Node 20 deprecation). Leave `pnpm/action-setup@v4` and `oven-sh/setup-bun@v2`.
- [ ] **Step 2:** `package.json` version `0.2.0`. `CHANGELOG.md` `## 0.2.0`: Twitch switch (`twitch` prop), `ShuttleControls` via `onReady`, `shuttle-editor/doc` entry, syntax-highlighting colours and monospace font variables.
- [ ] **Step 3:** `bun test`, `pnpm typecheck`, `pnpm build`, playground build. Commit: `Release 0.2.0`. Push `main` (`git push origin main`) and wait for CI (one `gh run watch` on the new run, `--exit-status`).
- [ ] **Step 4: Publishing is outward-facing — the coordinator asks the user before this step.** On approval: `git tag v0.2.0 && git push origin v0.2.0`, watch the release run once, then verify `npm view shuttle-editor version` → `0.2.0` and that the Release exists.

---

# Part 2 — Cord cutover (`cord`, branch `feature/shuttle-editor`)

### Task C0: Bring the planning docs over

- [ ] The coordinator already copied `docs/specs/2026-09-25-shuttle-v3-rebuild-design.md`, `docs/plans/2026-09-25-shuttle-phase1-package.md`, `docs/plans/2026-09-25-shuttle-cutover-notes.md` and this plan into `cord/docs/`. In `2026-09-25-shuttle-cutover-notes.md`, add a line under the title: "Resolved by `2026-09-27-shuttle-cutover.md` (decisions: npm dependency, links derived on save, Twitch off; CSP is null in Cord so items 4 and 10's CSP parts need no change)". Commit: `Move the Shuttle planning docs into Cord`.

### Task C1: Depend on `shuttle-editor`

**Files:** Modify `apps/desktop/package.json`, `pnpm-lock.yaml`

- [ ] `pnpm --filter @cord/desktop add shuttle-editor@^0.2.0`. Do NOT remove the Tiptap 2 packages yet (the old editor still compiles until C10). Verify `pnpm --filter @cord/desktop typecheck` and the test suite still pass. Commit: `Add shuttle-editor as a dependency`.

### Task C2: Sidecar reads the new document format

**Files:** Rewrite `apps/desktop/src/shared/blockDoc.ts`; Modify `apps/desktop/src/shared/constants/index.ts`, `apps/desktop/src/sidecar/services/NoteService.ts`, `apps/desktop/src/sidecar/services/BlockIndexService.ts`; Tests `apps/desktop/src/shared/__tests__/blockDoc.test.ts`, `apps/desktop/src/sidecar/services/__tests__/BlockIndexService.test.ts`, `apps/desktop/src/sidecar/services/__tests__/NoteService.test.ts`, `apps/desktop/src/sidecar/db/__tests__/blocksFts.test.ts`

Context: `blockDoc.ts` today knows only `notepadBlock` wrappers (see its header). Shuttle documents have no wrapper; every block node carries `attrs.blockId`; atoms carry text in attrs (mention labels, math latex, image alt). The `blocks` index (one row per top-level node, id = blockId, synthetic `${noteId}:${sort}` fallback, text for FTS) must keep working; search (`search.rs`) and unlinked mentions read `blocks.text`.

- [ ] **Step 1: Rewrite tests first.**
  - `blockDoc.test.ts`: replace the `notepadBlock` fixtures with Shuttle-shaped docs (top-level paragraph/heading/bulletList/blockMath/blockRef with `attrs.blockId`); cover `parseDoc` (valid doc; `'{}'`, invalid JSON, non-doc → empty doc), `extractBlocks` (real ids, duplicate ids → second becomes synthetic, missing id → synthetic, heading level, blockRef `refBlockId`, text includes mention labels/math latex via `nodeText`), `findBlockContent`, and a **legacy** case: a top-level `notepadBlock` wrapper `{type:'notepadBlock', attrs:{blockId:'L1'}, content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Old'}]}]}` is indexed with id `L1`, type `heading`, level 2, text `Old` (old notes stay searchable). Delete the `wrapInBlocks`/`unwrapBlocks` tests.
  - Update `BlockIndexService.test.ts` and `blocksFts.test.ts` fixtures to the new shape (keep one legacy-wrapper fixture in `BlockIndexService.test.ts` to prove backfill tolerates old docs); remove `conversionImpact` tests (removed in C4 — delete them here already and mark the describe as removed).
  - `NoteService.test.ts`: the default `bodyJson` of a created note is `EMPTY_DOC_JSON` (`'{"type":"doc","content":[{"type":"paragraph"}]}'`) for both kinds.
- [ ] **Step 2: Rewrite `shared/blockDoc.ts`:**

```ts
// Pure helpers over a stored Shuttle document (Tiptap JSON), built on
// shuttle-editor/doc so the sidecar reads exactly what the editor writes.
import { nodeText, topLevelBlocks, type DocNode } from 'shuttle-editor/doc';

export type { DocNode };

/** What an empty note stores. */
export const EMPTY_DOC_JSON = '{"type":"doc","content":[{"type":"paragraph"}]}';
const emptyDoc = (): DocNode => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** Old notepads wrapped every block in `notepadBlock`; read through it. */
const LEGACY_WRAPPER = 'notepadBlock';

export interface ExtractedBlock {
  id: string;
  synthetic: boolean;
  type: string;
  sort: number;
  level: number | null;
  text: string;
  refBlockId: string | null;
  node: DocNode;
}

export function parseDoc(bodyJson: string): DocNode {
  try {
    const parsed: unknown = JSON.parse(bodyJson);
    if (typeof parsed === 'object' && parsed !== null && (parsed as DocNode).type === 'doc'
      && Array.isArray((parsed as DocNode).content) && (parsed as DocNode).content!.length > 0) {
      return parsed as DocNode;
    }
  } catch { /* fall through */ }
  return emptyDoc();
}

export function extractBlocks(doc: DocNode, noteId: string): ExtractedBlock[] {
  const seen = new Set<string>();
  return topLevelBlocks(doc).map(({ index, blockId, node }) => {
    const inner = node.type === LEGACY_WRAPPER ? (node.content?.[0] ?? node) : node;
    const real = blockId && !seen.has(blockId) ? blockId : null;
    if (real) seen.add(real);
    const type = inner.type ?? 'paragraph';
    const level = type === 'heading' ? Number(inner.attrs?.['level'] ?? 1) : null;
    const ref = type === 'blockRef' ? inner.attrs?.['refBlockId'] : null;
    return {
      id: real ?? `${noteId}:${index}`,
      synthetic: real === null,
      type,
      sort: index,
      level,
      text: nodeText(inner),
      refBlockId: typeof ref === 'string' ? ref : null,
      node: inner,
    };
  });
}

/** The stored content of a real (non-synthetic) top-level block. */
export function findBlockContent(doc: DocNode, blockId: string): DocNode | null {
  return extractBlocks(doc, '').find((b) => !b.synthetic && b.id === blockId)?.node ?? null;
}
```
  Verify the sidecar can import `shuttle-editor/doc` under Bun (it resolves via package `exports`; in the installed package that's `dist/doc.js`). If `bun build --compile` (the sidecar binary, see `.github/workflows/ci.yml`) fails to resolve it, report it.
- [ ] **Step 3: Constants and callers.** Remove `ANNOTATABLE_TYPES`, `BLOCK_NODE_NAME`, `BLOCK_CONTENT_TYPES` from `shared/constants/index.ts` **only after** C10 deletes the editor files that import them — for now leave them; remove the `blockDoc.ts` re-export of `BLOCK_NODE`. Update `BlockIndexService` and `NoteService` to the new `parseDoc(bodyJson)` signature (no `kind` argument). `NoteService.create`: `const bodyJson = input.bodyJson ?? EMPTY_DOC_JSON;` (both kinds). Delete `emptyNotepadDoc`/`wrapInBlocks`/`unwrapBlocks` imports; `convert` is simplified in C4 — for now make it set `kind` only (drop the wrap/unwrap) so it compiles.
- [ ] **Step 4:** Cord test suite + typecheck pass. Commit: `Read Shuttle documents in the sidecar`.

### Task C3: Derive `note_links` from saved content

**Files:** Modify `apps/desktop/src/sidecar/services/LinkService.ts`, `apps/desktop/src/sidecar/services/NoteService.ts`, `apps/desktop/src/sidecar/index.ts` (construction order if needed); Test `apps/desktop/src/sidecar/services/__tests__/LinkSync.test.ts`

- [ ] **Step 1: Failing tests (`LinkSync.test.ts`, using `freshDb`, `seedUser`, `seedVault`):**
  - Creating note A whose body contains mentions of B and C (both existing notes in the same vault) creates `note_links` A→B and A→C, each with an `operation_log` row `('link', …, 'create')`.
  - Updating A's body to mention only C deletes A→B (op-log `'delete'`) and keeps A→C (no new op-log row for it).
  - A mention of A itself, of a note id that doesn't exist, or of a note in another vault creates no link.
  - Updating only the title leaves links untouched.
  - Restoring a deleted note re-syncs its links from its body.
- [ ] **Step 2: Implement.** In `LinkService` add

```ts
/**
 * Make the links from `noteId` match the wiki links in its saved document.
 * `note_links` is derived data now: body_json is the source of truth.
 */
syncFromDocument(tx: Tx, noteId: string, vaultId: string, targetIds: readonly string[]): void {
  const wanted = new Set(targetIds.filter((id) => id !== noteId));
  const valid = wanted.size === 0 ? new Set<string>() : new Set(
    tx.select({ id: notes.id }).from(notes)
      .where(and(inArray(notes.id, [...wanted]), eq(notes.vaultId, vaultId))).all().map((r) => r.id),
  );
  const existing = tx.select().from(noteLinks).where(eq(noteLinks.fromNoteId, noteId)).all();
  const existingTo = new Set(existing.map((l) => l.toNoteId));
  for (const link of existing) {
    if (!valid.has(link.toNoteId)) {
      tx.delete(noteLinks).where(eq(noteLinks.id, link.id)).run();
      logOp(tx, vaultId, 'link', link.id, 'delete', link);
    }
  }
  for (const toNoteId of valid) {
    if (existingTo.has(toNoteId)) continue;
    const link = { id: nanoid(), fromNoteId: noteId, toNoteId, createdAt: Date.now() };
    tx.insert(noteLinks).values(link).run();
    logOp(tx, vaultId, 'link', link.id, 'create', link);
  }
}
```
  (Use the file's existing imports/`Tx` type conventions — read `LinkService.ts`, `NoteService.ts`, `oplog.ts` first.) `NoteService` gets the `LinkService` (constructor injection; update `sidecar/index.ts` construction order) and calls `syncFromDocument(tx, id, vaultId, wikiLinkTargets(parseDoc(bodyJson)))` inside the same transaction in `create`, in `update` when `input.bodyJson !== undefined`, and in `restore`.
- [ ] **Step 3:** tests + typecheck. Commit: `Derive note links from the saved document`.

### Task C4: Remove IPC that the new model makes obsolete

`links_create`/`links_delete` (links are derived) and `notes_conversion_impact` (switching kind is now lossless — same schema, ids kept) go away. `notes_convert` stays but only flips `kind`.

**Files:** `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/commands/links.rs` (delete if empty; update `commands/mod.rs`), `apps/desktop/src-tauri/src/commands/notes.rs`, `apps/desktop/src/sidecar/handlers/links.ts` (delete the two routes; delete file + registration if empty), `apps/desktop/src/sidecar/handlers/notes.ts`, `apps/desktop/src/sidecar/services/NoteService.ts`, `apps/desktop/src/sidecar/services/BlockIndexService.ts`, `apps/desktop/src/renderer/ipc/index.ts`, `apps/desktop/src/renderer/store/notes.ts`, `apps/desktop/src/renderer/components/TitleBar.tsx`, `apps/desktop/src/shared/types/index.ts`, `apps/desktop/src/shared/constants/index.ts` (`CMD` entries), tests `NoteConversion.test.ts`.

- [ ] **Step 1: Tests.** Rewrite `NoteConversion.test.ts` as "switching kind": converting note→notepad→note only changes `kind`, keeps `body_json` byte-identical and keeps block ids in the index; logs one `'update'` op per switch. Keep its "search and mentions over the block index" suite, with new-format fixtures (mentions of note titles in plain text still produce unlinked-mention results).
- [ ] **Step 2: Implement.** `NoteService.convert(id, kind)`: set `kind` + `updatedAt`, `logOp(…'update'…)`, no body change, no reproject needed (body unchanged). Remove `conversionImpact` from NoteService, BlockIndexService, the notes handler route, Rust `notes_conversion_impact`, `lib.rs`, `api.notes.conversionImpact`, `useNoteStore.conversionImpact`, `ConversionImpact` type, `CMD.NOTES.CONVERSION_IMPACT`. Remove `links_create`/`links_delete` Rust commands + `lib.rs` entries, the sidecar routes, `api.links`, `CMD.LINKS.*`. In `TitleBar.tsx` `case 'convert'`: drop the impact query and `confirm`; call `await convertNote(note.id, to); await setActiveNote(note.id);`.
  The old editor still calls `api.links.*` (in `components/editor/WikiLink.ts`, `useNoteDoc.ts`) — replace those calls with no-ops for now (they are deleted in C10): delete the lines calling `api.links.create/delete`.
- [ ] **Step 3:** Cord tests (the IPC parity test must pass), typecheck, `cargo test`. Commit: `Drop link and conversion-impact commands the new model no longer needs`.

### Task C5: Attachments in the sidecar

**Files:** Modify `apps/desktop/src/sidecar/db/schema.ts`, `apps/desktop/src/sidecar/db/migrations.ts`, `apps/desktop/src/sidecar/db/client.ts`, `apps/desktop/src/shared/types/index.ts`, `apps/desktop/src/sidecar/index.ts`; Create `apps/desktop/src/sidecar/services/AttachmentService.ts`, `apps/desktop/src/sidecar/handlers/attachments.ts`; Test `apps/desktop/src/sidecar/services/__tests__/AttachmentService.test.ts`

- [ ] **Step 1: Failing tests** (set `process.env.CORD_ATTACHMENTS_DIR` to a fresh dir under `os.tmpdir()` in `beforeEach`, remove it in `afterEach`):
  - `create({ vaultId, mime: 'image/png', dataBase64 })` writes `<dir>/<id>.png` with the decoded bytes, inserts an `attachments` row `{ id, vaultId, mime, size, sha256, createdAt, deletedAt: null }`, and logs `('attachment', id, 'create')` whose payload has no bytes.
  - The same bytes again in the same vault return the existing row (no second file, no second op-log row); in another vault they create a new row.
  - Unsupported mime (e.g. `text/html`) and payloads over 25 MB throw.
- [ ] **Step 2: Implement.**
  - Schema (Drizzle): `attachments` = `id text PK, vault_id text NOT NULL references vaults(id), mime text NOT NULL, size integer NOT NULL, sha256 text NOT NULL, created_at integer NOT NULL, deleted_at integer` + index `idx_attachments_vault_hash(vault_id, sha256)`. Migration: `CREATE TABLE IF NOT EXISTS attachments (...)` + `CREATE INDEX IF NOT EXISTS ...` in `runMigrations()` (additive; follow the file's existing style).
  - `db/client.ts`: `export function resolveAttachmentsDir(): string { return process.env['CORD_ATTACHMENTS_DIR'] ?? join(dirname(resolveDbPath() === ':memory:' ? join(tmpdir(), 'cord-memory.db') : resolveDbPath()), 'attachments'); }`.
  - `shared/types`: `Attachment` interface, `CreateAttachmentInput { vaultId: string; mime: string; dataBase64: string }`, `EntityType` gains `'attachment'`.
  - `AttachmentService.create`: allowed mimes `image/png|jpeg|gif|webp|svg+xml|avif` → extensions `png|jpg|gif|webp|svg|avif`; decode with `Buffer.from(dataBase64, 'base64')`; reject `> 25 * 1024 * 1024`; hash with `new Bun.CryptoHasher('sha256').update(bytes).digest('hex')`; dedupe by `(vaultId, sha256, deletedAt IS NULL)`; `mkdirSync(dir, { recursive: true })`; write the file BEFORE inserting the row (a failed write leaves no row); insert + `logOp` in one transaction.
  - Handler `POST /attachments` (thin: `auth.requireSession()`, parse JSON body, delegate, `json(attachment)`); register in `sidecar/index.ts`.
- [ ] **Step 3:** tests + typecheck. Commit: `Store image attachments beside the database`.

### Task C6: Attachments over IPC and the `cord-attachment` URI scheme

**Files:** Create `apps/desktop/src-tauri/src/commands/attachments.rs`, `apps/desktop/src-tauri/src/attachments.rs`; Modify `apps/desktop/src-tauri/src/commands/mod.rs`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src/renderer/ipc/index.ts`, `apps/desktop/src/shared/constants/index.ts` (`CMD.ATTACHMENTS.CREATE`)

- [ ] **Step 1: Rust tests first** (`#[cfg(test)]` in `attachments.rs`): `is_valid_id` accepts `A-Za-z0-9_-` up to 64 chars and rejects `..`, `/`, `\`, empty, 65 chars; `find_file` finds `<id>.png` in a temp dir (`std::env::temp_dir().join(unique)`), returns `None` for a missing id and never matches a different id sharing a prefix; `mime_for` maps extensions.
- [ ] **Step 2: Implement `attachments.rs`:**

```rust
use std::path::{Path, PathBuf};

/// `~/.cord/attachments`, next to the database the sidecar reported.
pub fn attachments_dir(db_path: &Path) -> PathBuf {
    db_path.parent().map(|p| p.join("attachments")).unwrap_or_else(|| PathBuf::from("attachments"))
}

pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn mime_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif",
        "webp" => "image/webp", "svg" => "image/svg+xml", "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

pub fn find_file(dir: &Path, id: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir).ok()?.filter_map(Result::ok).map(|e| e.path())
        .find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(id))
}
```
  In `lib.rs`, on the builder: `.register_asynchronous_uri_scheme_protocol("cord-attachment", |ctx, request, responder| { … })` — read the id from `request.uri().path().trim_start_matches('/')`; `404` unless `is_valid_id`; get the DB path from the managed `AppState` (`ctx.app_handle().try_state::<AppState>()` — read `state.rs` for the field holding the sidecar-reported DB path; if absent return `503`); `find_file(&attachments_dir(db_path), id)`; read the bytes on a blocking thread (`std::thread::spawn` or `tauri::async_runtime::spawn_blocking`) and respond `200` with `Content-Type: mime_for(ext)` and `Cache-Control: max-age=31536000, immutable`, or `404`. Keep it thin — no other logic.
  Command `attachments_create(data: serde_json::Value) -> Result<serde_json::Value, String>` forwarding `fwd_post("/attachments", data)` exactly like the other commands; register in `lib.rs`.
- [ ] **Step 3:** Renderer `api.attachments.create(input: CreateAttachmentInput): Promise<Attachment>` → `invoke('attachments_create', { data: input })` (match the other commands' argument naming — check `notes_create`). Parity test passes. `cargo test`, Cord tests, typecheck. Commit: `Serve attachments through a cord-attachment URI scheme`.

### Task C7: One keybinding catalogue, owned by Shuttle for the editor

**Files:** Modify `apps/desktop/src/renderer/store/keybindings.ts`; Test `apps/desktop/src/renderer/store/__tests__/keybindings.test.ts`

- [ ] **Step 1: Tests.** Update `keybindings.test.ts`: the catalogue contains every `SHUTTLE_KEYBINDINGS` id (incl. `editor.underline`, `editor.highlight`, `editor.find`) with Shuttle's defaults and `scope: 'editor'`, plus the existing `app.*` ids; `eventToAccel` returns `Mod+Shift+8` for Ctrl+Shift+`*` with `code: 'Digit8'` on Windows (physical-key fallback, from Shuttle); `matchesBinding` matches that event against `editor.bulletList`; `shuttleOverrides(bindings)` returns only Shuttle ids; persisted overrides for removed ids are dropped; the existing tests still pass.
- [ ] **Step 2: Implement.** Keep the `app.*` definitions and the store as they are. Replace the editor/block definitions with ones mapped from `SHUTTLE_KEYBINDINGS` (`import { SHUTTLE_KEYBINDINGS, eventToAccel as shuttleEventToAccel, eventToAccels, formatAccel as shuttleFormatAccel, type KeybindingId as ShuttleKeybindingId } from 'shuttle-editor'`): `type KeybindingId = AppKeybindingId | ShuttleKeybindingId`; `KEYBINDINGS = [...APP_KEYBINDINGS, ...SHUTTLE_KEYBINDINGS.map(d => ({ id: d.id, label: d.label, group: d.group, scope: 'editor' as const, defaultAccel: d.defaultAccel, ...(d.notepadOnly ? { notepadOnly: true } : {}), ...(d.hint ? { hint: d.hint } : {}) }))]`; `eventToAccel = (e) => shuttleEventToAccel(e, IS_MAC)`; `matchesBinding(e, id)` → `!!accel && eventToAccels(e, IS_MAC).includes(accel)`; `formatAccel = (a) => shuttleFormatAccel(a, IS_MAC)`; add `export function shuttleOverrides(bindings: KeybindingMap): Partial<Record<ShuttleKeybindingId, string>>`. Settings' recorder (`SettingsPage.tsx`) keeps calling `eventToAccel` — no change needed.
- [ ] **Step 3:** tests + typecheck. Commit: `Take the editor shortcut catalogue from Shuttle`.

### Task C8: The Cord `ShuttleHost`

**Files:** Create `apps/desktop/src/renderer/lib/log.ts`, `apps/desktop/src/renderer/shuttle/cordHost.ts`, `apps/desktop/src/renderer/shuttle/outboundMentions.ts`; Tests `apps/desktop/src/renderer/shuttle/__tests__/cordHost.test.ts`, `…/outboundMentions.test.ts`

- [ ] **Step 1: Tests** (pure; stub dependencies, no Tauri):
  - `createCordHost(deps)` where `deps = { getNotes, getActiveVaultId, api: { blocks, attachments, fragments }, openNote, onFragmentAction, reloadFragments, onLinksMaybeChanged, keybindingOverrides, log }` (all injected so tests don't touch stores/IPC):
    - `searchNotes('al')` → notes whose title contains 'al' (case-insensitive), excluding deleted, max 20; `findNoteByTitle(' alpha ')` exact case-insensitive trimmed; `listNoteTitles()` returns the SAME array instance on repeated calls while `getNotes()` returns the same array, and a new one when it changes.
    - `resolveFileSrc('attachment:abc')` → `convertFileSrc('abc', 'cord-attachment')` (inject `convertFileSrc` too); other srcs unchanged.
    - `uploadFile(file)` → base64-encodes, calls `api.attachments.create({ vaultId, mime: file.type, dataBase64 })`, returns `{ src: 'attachment:<id>' }`; rejects when no active vault.
    - `resolveBlock('b1')` maps `BlockRefTarget` → `{ blockId, noteId, noteTitle, content: JSON.parse(contentJson) }`, `null` passes through; `listBlocks` maps `Block` → `BlockSummary`.
    - `onFragmentLinksRemoved('n', ['l1','l2'])` deletes both links then reloads fragments once; `onFragmentAction` forwards; `onLinksChanged` calls `onLinksMaybeChanged(docKey)`; `openNote(id, blockId)` forwards.
  - `outboundMentions(doc, notes, currentNoteId)`: notes whose title (≥3 chars) appears as a whole word (Unicode-aware, `u` flag, `(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`) in the document text and are not already wiki-linked (mention ids), excluding the current note — port the logic from the old `components/editor/useNoteDoc.ts` `computeOutboundMentions`, walking JSON (text nodes only, skipping mention subtrees).
- [ ] **Step 2: Implement.** `lib/log.ts`: `export function log(level: 'debug'|'info'|'warn'|'error', scope: string, message: string, data?: unknown): void` writing `console[level === 'debug' ? 'debug' : level]` with a `[scope]` prefix (the renderer's single sanctioned console sink). `cordHost.ts` exports `createCordHost(deps): ShuttleHost` implementing every `ShuttleHost` method (`import type { ShuttleHost, NoteRef, BlockSummary } from 'shuttle-editor'`), with `listNoteTitles` memoised on the `getNotes()` array identity. `outboundMentions.ts` pure.
- [ ] **Step 3:** tests + typecheck. Commit: `Implement ShuttleHost over Cord's stores and IPC`.

### Task C9: Overlays move out of the old editor folder

**Files:** Move `apps/desktop/src/renderer/components/editor/{FragmentOverlay.tsx,FragmentOverlay.module.css,EditorContextMenu.tsx,EditorContextMenu.module.css,WikiLinkPills.tsx,WikiLinkPills.module.css}` → `apps/desktop/src/renderer/components/overlays/` (use `git mv`).

- [ ] Changes (read each file first; the exploration map in the session lists the exact lines):
  - `Editor` type from `'shuttle-editor'` (not `@tiptap/core`).
  - Every `[data-block-id]` selector/`getAttribute('data-block-id')` → `BLOCK_ID_ATTRIBUTE` from `shuttle-editor` (`data-blockid`); build selectors as `` `[${BLOCK_ID_ATTRIBUTE}="${id}"]` ``. Tables: if `closest(...)` finds nothing because the element is inside `.tableWrapper`, look for the attribute on `.tableWrapper > table` (the node view puts it on the table).
  - Node names: `fragmentLinkNode` → `fragmentLink`; `wikiLink` → `mention` (attrs `id`, `label`).
  - `EditorContextMenu` inserts fragment links with `editor.commands.insertFragmentLink({ linkId, toNoteId, toFragmentId, label })`; its "link to fragment" target-block list uses `api.blocks.listForNote(targetNoteId)` (excluding synthetic ids containing `:`) instead of parsing the target's `bodyJson` (which is `'{}'` for unopened notes — the old list was empty in practice).
  - `FragmentOverlay`'s remove-link finds `fragmentLink` nodes by `linkId`.
  - Highlight CSS rule moves with them: `[data-blockid].fragment-highlight`.
  - No test changes expected beyond typecheck; run the suite. Commit: `Move Cord's editor overlays onto Shuttle`.

### Task C10: Render `<ShuttleEditor>`; delete the old editor

**Files:** Rewrite `apps/desktop/src/renderer/components/Editor.tsx`; Modify `apps/desktop/src/renderer/components/Editor.module.css`, `apps/desktop/src/renderer/styles/global.css`, `apps/desktop/src/renderer/main.tsx`, `apps/desktop/src/renderer/pages/NotesPage.tsx` (only if needed); Create `apps/desktop/src/renderer/styles/shuttle-theme.css`; Delete `apps/desktop/src/renderer/components/editor/` (whole folder incl. `__tests__`); Modify `apps/desktop/package.json` (remove `@tiptap/*`, `prosemirror-view`, `turndown`, `@types/turndown`, `lowlight`, `marked`, `@types/katex` if unused, `@happy-dom/global-registrator`/`happy-dom` if no test uses them), `apps/desktop/src/shared/constants/index.ts` (remove `ANNOTATABLE_TYPES`, `BLOCK_NODE_NAME`, `BLOCK_CONTENT_TYPES`), root `pnpm-workspace.yaml` (remove the `linkify-it` override if `linkify-it` no longer resolves in the lockfile)

- [ ] **Step 1: Editor.tsx.** Keep, unchanged, the title row + tag panel JSX and handlers, and the status bar (backlinks, unlinked mentions, outbound mentions, counts). Replace everything editor-specific:
  - Remove `useNoteDoc`, the toolbar, `BlockChrome`, `BlockRefPicker`, `OPEN_REF_PICKER_EVENT`.
  - `const [editor, setEditor] = useState<Editor | null>(null); const controls = useRef<ShuttleControls | null>(null);`
  - `const doc = useMemo(() => parseStoredDoc(note.bodyJson), [note.id])` where `parseStoredDoc` returns the parsed object if it is an object with `type === 'doc'`, else `null` (so `'{}'` → Shuttle's empty doc; a legacy notepad doc passes through and Shuttle opens it read-only).
  - Host: `const notes = useNoteStore((s) => s.notes)`; `const host = useMemo(() => createCordHost({...}), [notes, keybindingOverridesFromStore, activeVaultId])` — a new host object when notes change (Shuttle refreshes unlinked-mention highlighting on host identity change). `openNote` → `setView('notes'); setActiveNote(id); loadLinks(id); if (blockId) setPendingScroll(blockId)`; `onFragmentAction` → `window.dispatchEvent(new CustomEvent('corddb:fragment-action', { detail: { type, blockId } }))` (EditorContextMenu listens); `onLinksMaybeChanged` → sets a ref flag; `reloadFragments` → `loadFragments(note.id)`; `log` → `lib/log`.
  - Save: `onChange={(id, json) => { void updateNote(id, { bodyJson: JSON.stringify(json) }).then(() => { if (linksDirty.current) { linksDirty.current = false; void loadLinks(id); } }); setOutbound(outboundMentions(json, notes, id)); }}` (links are derived by the sidecar on save, so reload them after the save resolves).
  - Counts: `onStats={setStats}`.
  - `<ShuttleEditor docKey={note.id} doc={doc} mode={note.kind} host={host} twitch={false} onChange={…} onStats={…} onReady={(e, c) => { setEditor(e); controls.current = c; }}>` with children `{editor && <FragmentOverlay editor={editor} noteId={note.id} contentEl={contentRef.current} />}{editor && <WikiLinkPills editor={editor} contentEl={contentRef.current} />}` inside the existing `contentRef` div; `{editor && <EditorContextMenu editor={editor} noteId={note.id} />}` after it.
  - `corddb:editor-command` listener: same `cmd` names as today, implemented on `editor` — `bold/italic` toggles, `h1..h3` → `toggleHeading`, `codeBlock` → `toggleCodeBlock`, `taskList` → `toggleTaskList`, `hr` → `setHorizontalRule`, `block:moveUp/moveDown/duplicate/delete` → `moveBlock(sel.from, ∓1)` / `duplicateBlock` / `deleteBlock` (notepad only), `block:insertRef` → `controls.current?.openRefPicker()`.
  - `pendingScroll` effect: query `` editor.view.dom.querySelector(`[${BLOCK_ID_ATTRIBUTE}="${pendingScroll}"]`) ``.
- [ ] **Step 2: Styles.**
  - `main.tsx`: replace `import 'katex/dist/katex.min.css'` with `import 'shuttle-editor/styles.css'; import './styles/shuttle-theme.css';`.
  - `styles/shuttle-theme.css` bridges Cord's theme to Shuttle's variable names:
    ```css
    /* Shuttle reads --bg-primary/--bg-secondary/--on-accent; Cord names them differently. */
    .sh-root, .sh-popup-anchor {
      --bg-primary: var(--bg);
      --bg-secondary: var(--bg-elevated);
      --on-accent: var(--accent-fg);
    }
    ```
    (Shuttle already reads `--accent`, `--border`, `--text-primary`, `--text-muted`, `--link-color`, `--editor-font-size`, `--font-mono`, `--code-color`, `--syntax-*` under those names.)
  - `Editor.module.css`: delete the `.ProseMirror` global rules, notepad `[data-block]` rules, `.wiki-link*`, `.math-*`, `.unlinked-mention`, hljs colours and toolbar classes; keep title/tag/status-bar/content-layout classes (content max width via `--editor-line-width`).
  - `global.css`: delete the `.ProseMirror` taskList/taskItem rules (≈436–510).
- [ ] **Step 3: Delete** `components/editor/` (whole folder, `git rm -r`), the now-unused constants, the dead dependencies; `pnpm install`; make sure nothing imports `@tiptap/*` except via `shuttle-editor` (`grep -rn "@tiptap" apps/desktop/src` → nothing).
- [ ] **Step 4:** Cord tests, typecheck, `build:renderer`, `cargo test`, and a sidecar binary build for the host platform to prove `shuttle-editor/doc` bundles: `bun build --compile src/sidecar/index.ts --outfile .tmp/cord-sidecar` in `apps/desktop` (delete `.tmp` after). Commit: `Render notes with shuttle-editor and delete the old editor`.

### Task C11: Docs

**Files:** `README.md`, `CONTRIBUTING.md` (cord), and — outside the repo, not committed — `C:\Users\Olek\Downloads\evrything-cord\.claude\CLAUDE.md`

- [ ] `README.md`: Stack row "Editor | [Shuttle](https://github.com/cord-note/shuttle) (`shuttle-editor` on npm, official Tiptap 3)"; "Note kinds" — both kinds share one document format, a notepad adds the block gutter and block menu; architecture principle #4 unchanged in spirit, mention `note_links` is derived from `body_json` on save; rewrite the "Shuttle" section: it is a separate public package, Cord depends on it from npm; attachments live in `~/.cord/attachments/`.
- [ ] `CONTRIBUTING.md`: update the settled decisions (Tiptap 3 via Shuttle; notepad = mode over one schema; no wrapper; links derived on save) and "Architecture, briefly" (editor is the `shuttle-editor` package).
- [ ] `CLAUDE.md` (outside repo; edit only, never commit): status line; stack row Editor; principle 4 and a new principle "note_links is derived from body_json on save (like blocks)"; schema block adds `attachments` and notes `note_links` is derived; replace "Note kinds" and "Shuttle editor — frozen node types v1" with the Shuttle-package reality (official Tiptap 3 extension list + custom list, node names `mention`, `inlineMath`/`blockMath`, `fragmentLink`, `blockRef`, no `notepadBlock`); frozen decisions 3/10/14/15 updated; monorepo structure (no `components/editor/`, `renderer/shuttle/` host adapter).
- [ ] Commit (cord repo only): `Document the move to shuttle-editor`.

### Task C12: Verification and hand-off

- [ ] Full: Cord tests, typecheck, `build:renderer`, `cargo check --all-targets`, `cargo test`.
- [ ] Push the branch (`git push -u origin feature/shuttle-editor`) and open a PR against `main` (`gh pr create` with a summary and a manual test checklist). CI must pass.
- [ ] Manual checklist for the user in the real app (`pnpm dev` from `cord/`):
  1. Open a note and a notepad; type, reload the app — content persists.
  2. `[[` link to another note → backlink appears on the target; delete the link → backlink disappears after the save.
  3. Notepad: gutter drag, block menu, Alt+↑/↓, turn into, duplicate.
  4. Tag a block and link a block (context menu) → fragment overlay chips; click a fragment link → jumps to the block in the other note.
  5. Block reference (`/block ref`) shows the source block and "open source" jumps there.
  6. Paste an image (and drop one) → it uploads and still shows after an app restart; the file exists in `~/.cord/attachments/`.
  7. Paste a YouTube link → embed; paste a Twitch link → stays a link (Twitch off).
  8. Command bar editor commands and rebinding a shortcut in Settings → Keyboard (incl. the new Underline/Highlight/Find).
  9. Switch note ↔ notepad → content and block tags unchanged.
  10. An old notepad from before the cutover opens read-only showing its text.
  11. Search finds text inside notes, including a wiki-link label and a formula.
  12. Theme: toolbar, menus, popups and code highlighting are readable in light and dark.
