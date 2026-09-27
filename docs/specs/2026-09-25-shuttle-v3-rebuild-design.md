# Shuttle Phase 1 — rebuild on official Tiptap 3

**Date:** 2026-09-25 · **Status:** approved design, awaiting implementation plan
**Repos:** `Alexander-288/shuttle` (this repo), `Alexander-288/cord` (consumer)

## Goal

Rebuild Shuttle, Cord's editor, as a standalone React package built on **official
Tiptap 3 extensions**, with custom code only where Tiptap has no equivalent: links,
notepad mode, transclusion, the slash menu, rebindable keybindings, and unlinked-mention
highlighting. Cord consumes it as a git submodule and compiles it from source.

This is Shuttle Phase 1. Later phases (not in this spec):
Phase 2 graphs and datasets · Phase 3 canvases · Phase 4 speech-to-text ·
Collaboration last of all. Emoji and Ruby text only if needed later.

## Constraints and decisions

| Decision | Choice |
|---|---|
| Existing notes | Expendable. No in-app migration. v2 content that fails to parse opens read-only. |
| Consumption | Git submodule at `cord/packages/shuttle`, pnpm `workspace:` dependency, source entry (no build step). |
| Package scope | Complete editor: `<ShuttleEditor>` with its own UI, talking to the host only through `ShuttleHost`. |
| Images | New additive `attachments` table (metadata only); bytes as files in `~/.cord/attachments/`. |
| Notepad structure | No wrapper node. Notepad is a UI mode over the same schema; UniqueID gives top-level nodes ids. |
| Wiki links | `Mention.extend` — no functionality lost vs the v2 `wikiLink`. |
| Strategy | Fresh build in `shuttle/` with a playground, then one cutover branch in Cord. |
| Tiptap version | 3.x (all extensions below are MIT, 3.31.3 at time of writing). |

## Extension inventory

**Official, used:**
StarterKit (Document, Paragraph, Text, Heading, Blockquote, BulletList, OrderedList,
ListItem, ListKeymap, HorizontalRule, HardBreak, Bold, Italic, Code, Strike, Underline,
Link, Dropcursor, Gapcursor, UndoRedo, TrailingNode; its CodeBlock disabled) ·
CodeBlockLowlight · TaskList/TaskItem · Mathematics · Mention · Image · Youtube ·
Twitch · FileHandler · UniqueID · DragHandleReact · Placeholder · CharacterCount ·
BubbleMenu · Selection · Focus · TableKit · Details (+ summary, content) · Highlight ·
FindAndReplace · TableOfContents · Subscript · Superscript · `@tiptap/markdown`.

**Official, deliberately not used:** TextStyle kit, Color, BackgroundColor, FontFamily,
FontSize, LineHeight, TextAlign (presentational, do not survive markdown, fight theming) ·
Typography (rewrites typed text) · FloatingMenu (duplicates slash menu and gutter `+`) ·
Emoji, RubyText (later if needed) · InvisibleCharacters (a debug view would be custom) ·
Collaboration, CollaborationCaret (last phase; implies Yjs as sync model) ·
DragHandle vanilla/Vue · Audio · all paid features.

**Custom:**

| Piece | Built from |
|---|---|
| `wikiLink`, `fragmentLink` | `Mention.extend`: two triggers, `displayText` attr, `[[Title]]` / `[[Title\|alias]]` input rules, React node view (click opens, double-click edits alias) |
| `blockRef` | Custom atom node, attrs `refBlockId`, `refNoteId` only; React view resolves via host |
| Notepad mode | UniqueID + DragHandleReact + TrailingNode + commands `moveBlock`, `duplicateBlock`, `turnInto`, `deleteBlock`; block menu UI |
| Slash menu | Official `Suggestion` + item list (incl. templates) + React list |
| Keybindings | Priority-1000 plugin; defaults ship in Shuttle, overrides come from host |
| Unlinked mentions | Decoration plugin fed by `host.listNoteTitles()` |
| Markdown tokens | `@tiptap/markdown` custom tokenizers for `[[…]]`, `$…$` / `$$…$$`, `![[block]]` |
| Images | `Image.extend` node view resolving `src` through `host.resolveFileSrc` |

**Removed relative to v2:** `notepadBlock`, `NotepadDocument`, `BlockNormalizer`,
custom Enter/Backspace, `replaceBlockWith`, custom `mathInline`/`mathBlock`, the
marked + turndown clipboard, the hand-rolled word counter, `LinkPills`, `AltGrSupport`,
the unused Typography dependency.

## Package layout

```
shuttle/
  src/
    index.ts                public exports
    ShuttleEditor.tsx       <ShuttleEditor docKey doc mode host onChange />
    host.ts                 ShuttleHost interface + types (NoteRef, BlockRef, …)
    extensions/index.ts     buildExtensions(mode, host)
    custom/{links,blockRef,notepad,slash,keybindings,unlinkedMentions,markdown,image}/
    ui/                     Toolbar, BubbleMenu, SlashMenu, BlockMenu, ContextMenu,
                            RefPicker, MathEditor, FindBar, Outline
    styles/                 CSS modules + theme variables the host can override
  playground/               Vite page, fake host with in-memory notes
  __tests__/
```

Peer dependencies: `@tiptap/*`, `react`, `react-dom`, `katex`, `lowlight`.

## Host adapter

```ts
interface ShuttleHost {
  // lookups
  searchNotes(query: string): Promise<NoteRef[]>
  findNoteByTitle(title: string): NoteRef | null
  resolveBlock(noteId: string, blockId: string): Promise<JSONContent | null>
  searchBlocks(query: string): Promise<BlockRef[]>
  listNoteTitles(): NoteRef[]
  resolveFileSrc(src: string): string
  // side effects
  onLinksChanged(diff: { added: string[]; removed: string[] }): void
  onFragmentLinksRemoved(linkIds: string[]): void
  onFragmentAction(a: { type: 'tag' | 'noteLink' | 'fragmentLink'; blockId: string }): void
  openNote(noteId: string, blockId?: string): void
  uploadFile(file: File): Promise<{ src: string }>
  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: unknown): void
  // settings
  keybindings: Partial<Record<KeybindingId, string>>
}
```

Shuttle never imports Tauri, Zustand stores, or Cord IPC.

## Data flow

- `onChange(docKey, json)` is debounced 750 ms inside Shuttle. The pending edit is
  flushed immediately when `docKey` changes or the editor unmounts.
- Cord passes `docKey = note.id` and writes via `notes:update`; the sidecar reprojects
  `blocks` from `body_json`.
- UniqueID: `attributeName: 'blockId'`, in both modes, on every block-level type
  (paragraph, heading, lists, taskList, blockquote, codeBlock, blockMath,
  horizontalRule, image, youtube, twitch, table, details, blockRef). Only top-level ids
  are indexed; nested ids exist for future per-bullet addressing.
- Stored shapes: links `{type:'mention', attrs:{id, label, displayText, mentionSuggestionChar}}`;
  math `inlineMath` / `blockMath` with `latex`; images `src: "attachment:<id>"`.

## Cord-side changes

1. `shared/blockDoc.ts` and `BlockIndexService`: new shape (top-level nodes with
   `attrs.blockId`, no wrapper); searchable text includes mention labels, math latex,
   image alt. Synthetic `${noteId}:${sort}` fallback id retained.
2. `attachments` table (additive migration): `id, vault_id, mime, size, sha256,
   created_at, deleted_at`. `attachments:create` → sidecar writes
   `~/.cord/attachments/<id>.<ext>`, inserts the row, appends to `operation_log`;
   identical sha256 within a vault reuses the row.
3. Rust: one thin `cord-attachment` URI-scheme handler serving a file by validated id.
   `host.resolveFileSrc` maps `attachment:<id>` to it.
4. `note_links` unchanged, driven by `host.onLinksChanged`.
5. Note ↔ notepad conversion becomes a `kind` update only; sidecar document
   conversion is deleted.
6. `Editor.tsx` keeps title, tags, status bar; renders `<ShuttleEditor>`;
   `components/editor/` deleted; keybinding settings move to Shuttle's ids.
7. CI and release workflows check out submodules recursively.

## Error handling

- `enableContentCheck` + `onContentError`: banner "This note uses an older format",
  editor read-only, `onChange` never fires for it.
- Upload failure: placeholder shows an error with retry; nothing is written until an
  `src` exists.
- `resolveBlock` → null: "Block not found", ids kept.
- Host call throws: caught, editor keeps working, reported through `host.log`.

## Testing

`bun test` with happy-dom, fake host shared with the playground.

- Schema: both modes build; a document with every node type loads cleanly.
- Notepad commands: move, duplicate, turnInto, delete; ids unique after split, paste,
  duplicate.
- Links: `[[Title]]` and `[[Title|alias]]` input rules; suggestion pick calls
  `onLinksChanged`; deletion reports removal.
- Markdown round trip preserves links, math, tables, task lists, highlight, details.
- Save: pending edit flushed on `docKey` change and unmount.
- Content error: v2 document → read-only, no `onChange`.

Cord merge gate: `bun test`, `cargo test`, manual run on Windows, Linux build in CI.

## Documentation updates in Cord

- CLAUDE.md frozen decision 10 → "official Tiptap 3 extensions + the custom list in
  shuttle/README".
- Decisions 14–15 → "two note modes over one schema; notepad is a UI mode; top-level
  blocks addressable in both".
- Rewrite the "Note kinds" and editor schema sections; add `attachments` to the frozen
  schema; document the Shuttle boundary, adapter, and submodule workflow.
- Record the change in DECISIONS.md.

## Adjustments made during planning (2026-09-25)

1. Host: `searchBlocks` replaced by `listBlocks(noteId)`; `resolveBlock(blockId)` takes the block id only.
2. `fragmentLink` is a small custom inline node, not Mention — it has no typed trigger.
3. Tiptap packages are regular dependencies; only react, react-dom, katex are peers.
4. Cord's context menu, fragment overlay and wiki-link pills stay in Cord as overlays; Shuttle exposes the editor via `onReady` and exports `insertFragmentLink`.
5. `CustomTaskItem` dropped in favour of stock TaskItem + CSS.
6. YouTube/Twitch embed by pasting a URL (official paste handlers); no URL dialog in Phase 1.
7. Legacy content is detected by Shuttle's own `isValidDoc` before loading.
8. Shuttle's context carries `docKey` so unlinked-mention highlighting skips the note's own title.
9. Host side-effect callbacks carry the document key: `onLinksChanged(docKey, diff)`, `onFragmentLinksRemoved(docKey, ids)`, `onFragmentAction({ docKey, type, blockId })`.
10. Cord's context menu stays in Cord (see 4), so Shuttle's `ui/` has no ContextMenu.
11. `BlockIdGuard` keeps top-level/nested block ids unique (first or content-holding occurrence keeps the id); saved JSON drops TableOfContents' heading ids (`toStoredJson`).
12. Legacy notes are shown as read-only plain text (not blank).
13. Tests live in `test/`; styles are a single `src/styles/shuttle.css` (not CSS modules).
