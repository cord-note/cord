# Notepad: block-based notes in Shuttle

**Date:** 2026-08-07
**Status:** implemented — see "Deviations from this design" at the end
**Owners:** Sajon (schema, services, IPC, editor nodes), CompressedDuck (block chrome UI)

> This is a dated design record, kept as written. It refers throughout to
> `CLAUDE.md`, an internal working document that is not published with this
> repository — the architecture rules it describes are summarised in the
> [README](../../README.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## 1. Summary

Cord gains a second note kind, the **notepad**: a Notion-style page whose content is a
flat sequence of addressable blocks. The existing note stays exactly as it is, for quick
and simple capture.

A notepad is rendered by a **single ProseMirror instance**. Blocks are simulated as
separate editor fields inside one view — there is deliberately no per-block editor
instance, because N ProseMirror instances per page is the performance trap this design
exists to avoid.

Three things make a notepad different from a note:

1. Its schema is `doc → block+`. Nothing can exist outside a block.
2. Every block is addressable: it has a stable id, a type, a position, and metadata.
3. A block can be transcluded into another notepad by reference.

Block **identity** is not new work. `BlockId.ts` already stamps `blockId` onto nodes, and
`fragments.id === blockId`, with `fragment_tags` giving per-block tags and `fragment_links`
giving block→note and block→block links. Those tables are reused unchanged. What this
design adds is block **type, order, text, and reference resolution**.

## 2. Scope

**In scope**

- `notes.kind` — `'note' | 'notepad'`
- `blocks` derived index table, covering **both** note kinds
- `block` and `blockRef` node types; notepad-only `Document` override
- `BlockNormalizer` — the invariant enforcer
- Block chrome: drag handle, add button, block menu, drag/keyboard reorder
- Transclusion, read-only, with jump-to-source
- Creation (split button) and two-way conversion
- Rewiring `/commands`, the command bar, markdown quicktype, and the markdown clipboard
- **Removal of `body_markdown`**, and rebuilding search and unlinked mentions on `blocks`

**Explicitly out of scope** (each a later phase)

- Per-block tags/links as first-class block chrome — the existing `corddb:fragment-action`
  path is reused as-is
- Block query views ("all unchecked tasks in vault")
- Editable transclusion — the node is shaped so this needs no schema change later
- Block nesting, and per-list-item blocks. A whole `bulletList` is one block.

## 3. Decisions and their rationale

| Decision | Chosen | Why |
|---|---|---|
| Editing model | One ProseMirror instance, `doc → block+` | Per-block editors cost a ProseMirror instance per block. One doc keeps one undo stack, one selection model, one save. |
| Block granularity | Flat, per top-level node; lists stay whole | Existing list extensions are untouched. Cost: cannot tag or link an individual bullet. Accepted. |
| Content source of truth | `notes.body_json` | Preserves the frozen decision. One write per save, one oplog entry. |
| Block metadata | `blocks` table, **derived** from `body_json` | Rebuildable and disposable, so a bad reproject can never destroy authored data. |
| Authored block data | Stays in `fragments` / `fragment_tags` / `fragment_links` | Already exists, already joins on the same id. Never touched by reprojection. |
| Transclusion | Read-only mirror now | No cross-note write path, no two-document undo, no open-in-both-tabs conflict. |
| Index coverage | All notes, both kinds | It is the single searchable text surface once `body_markdown` is gone. |
| `body_markdown` | Deleted | Never actually derived on save, so it has been dead weight; `blocks.text` supersedes it. |

## 4. Data model

### 4.1 `notes`

```sql
ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';   -- 'note' | 'notepad'
ALTER TABLE notes DROP COLUMN body_markdown;                       -- guarded; see 4.4
```

### 4.2 `blocks` — derived index

```sql
CREATE TABLE IF NOT EXISTS blocks (
  id           TEXT PRIMARY KEY NOT NULL,   -- === blockId in body_json === fragments.id
  note_id      TEXT NOT NULL,
  vault_id     TEXT NOT NULL,
  type         TEXT NOT NULL,               -- paragraph | heading | bulletList | orderedList
                                            -- | taskList | blockquote | codeBlock | mathBlock
                                            -- | horizontalRule | blockRef
  sort         INTEGER NOT NULL,            -- 0-based document order
  level        INTEGER,                     -- heading level, else NULL
  text         TEXT NOT NULL DEFAULT '',    -- flattened plaintext
  ref_block_id TEXT,                        -- only when type = 'blockRef'
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (note_id)  REFERENCES notes(id),
  FOREIGN KEY (vault_id) REFERENCES vaults(id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_note ON blocks (note_id, sort);
CREATE INDEX IF NOT EXISTS idx_blocks_type ON blocks (vault_id, type);
CREATE INDEX IF NOT EXISTS idx_blocks_ref  ON blocks (ref_block_id);
```

There is no `content_json` column. Transclusion resolves by reading the source note's
`body_json` and extracting the block by id. Notes are small, and keeping content in
exactly one place is what keeps this index disposable.

There is no `deleted_at`. Rows are replaced wholesale on every save.

**Row id rule.** Reprojection reuses a node's `blockId` when it has one. Nodes without one
— list nodes in plain notes, which `BlockId` does not stamp — get the deterministic
synthetic id `` `${noteId}:${sort}` ``. Deterministic ids mean reprojection never churns
primary keys. A `blockRef` may only target a row with a real `blockId`; synthetic-id rows
exist for search only and are not valid reference targets.

### 4.3 Stated exceptions to the architecture principles

Both are deliberate, and CLAUDE.md is updated in the same change to record them.

1. **`blocks` rows are hard-deleted on reproject**, against *"No hard deletes anywhere."*
   Justified: `blocks` is a derived index, not authored data. Authored per-block data lives
   in `fragments`, which is never touched by reprojection. Approved.
2. **Reprojection writes no `operation_log` entries**, against *"Every write appends to
   operation_log."* Justified: the rows are reconstructible from `body_json`, which is
   itself logged. Sync ships `body_json`; the receiver reprojects locally.

### 4.4 Retiring `body_markdown`

`body_markdown` is removed from `schema.ts`, from the `Note` / `CreateNoteInput` /
`UpdateNoteInput` DTOs, from `NoteService.create` / `update` / `toNote`, and from every
renderer call site. The migration then runs a guarded
`ALTER TABLE notes DROP COLUMN body_markdown` — guarded because the statement must be a
no-op on a database that has already dropped it. This knowingly breaks the additive-only
migration rule; CLAUDE.md's frozen schema block and frozen decision #4 are updated to match.

`marked` and `turndown` stay. Markdown remains input UX via `markdownClipboard.ts`; only
the stored derived column goes away.

### 4.5 Search and unlinked mentions, rebuilt on `blocks`

```sql
-- notes:search
SELECT DISTINCT b.note_id FROM blocks b
  JOIN notes n ON n.id = b.note_id
 WHERE b.vault_id = ? AND n.deleted_at IS NULL
   AND (n.title LIKE ? OR b.text LIKE ?);

-- findUnlinkedMentions — excerpt comes from blocks.text, and carries a block anchor
SELECT b.note_id, b.id AS block_id, b.text FROM blocks b
  JOIN notes n ON n.id = b.note_id
 WHERE b.vault_id = ? AND n.deleted_at IS NULL
   AND b.note_id != ? AND b.text LIKE ?;
```

Mention results gain a `blockId`, so clicking one can scroll to the exact block via the
existing `pendingScroll` path in `Editor.tsx`. This table is also the intended FTS5 target
for M4.

## 5. Editor schema — notepad mode

- **`block`** — `content: 'blockContent'`, attrs `{ blockId }`, renders
  `<div data-block-id="…">`. Not draggable via ProseMirror's own drag; the chrome owns that.
- **`blockContent`** group — `paragraph`, `heading`, `bulletList`, `orderedList`, `taskList`,
  `blockquote`, `codeBlock`, `mathBlock`, `horizontalRule`, `blockRef`.
- **Notepad `Document` override** — `content: 'block+'`. The "no content outside a block"
  invariant is enforced by the schema, not by application code.
- **`blockRef`** — atom, `blockContent` group, attrs `{ refBlockId, refNoteId }`. NodeView
  renders the resolved source content read-only, with a jump-to-source affordance and a
  visually distinct unresolved state. Attrs are already sufficient for write-through, so
  editable transclusion later needs no schema change.
- **`BlockNormalizer`** — an `appendTransaction` plugin, and the load-bearing piece of the
  whole design. On every doc change it:
  1. wraps any top-level node that is not a `block` into one,
  2. mints `blockId` for blocks that lack one,
  3. guarantees a trailing empty paragraph block so there is always somewhere to type,
  4. drops blocks whose content slot is empty of any valid node.

  Step 1 is why markdown quicktype, `---`, code fences, and paste need no special-casing:
  whatever produces a top-level node gets wrapped after the fact.

`BlockId.ts` is unchanged and still serves plain notes.

**Sign-off:** `block` and `blockRef` are new node types. CLAUDE.md requires agreement from
all three developers to add one. Approved.

## 6. Renderer structure

`Editor.tsx` is 21k and already doing too much; its core is being rewritten here, so it is
split as part of the work:

```
Editor.tsx              — switches on note.kind, nothing else
NoteEditor.tsx          — today's behavior, unchanged extension set
NotepadEditor.tsx       — notepad extension set + BlockChrome
editor/useNoteDoc.ts    — save debounce, link/fragment diffing, word+char counts (shared)
EditorTitleRow.tsx  EditorTagPanel.tsx  EditorToolbar.tsx  EditorStatusBar.tsx
```

Exactly one editor instance is mounted at a time.

## 7. Block chrome

`BlockChrome.tsx` is a **single overlay** positioned off `[data-block-id]` client rects,
following the existing `FragmentOverlay` pattern — not a React NodeView per block, which
would reintroduce the per-block cost this design avoids.

- Hover a block → `⠿` handle and `＋` appear in the left gutter.
- `⠿` drag → drop-indicator line between blocks; on drop, one ProseMirror transaction moves
  the block node.
- `⠿` click → block menu: **Turn into ▸** · Duplicate · Move up · Move down ·
  Copy block link · Tag · Link to note · Delete.
- `＋` → insert an empty paragraph block below and open the `/` menu in it.
- Keyboard: `Alt+↑` / `Alt+↓` move, `Mod+Shift+D` duplicate, `Mod+Shift+Backspace` delete.
- **Turn into** offers all frozen v1 types. Text is carried across where the target holds
  text; where it cannot be (→ `horizontalRule`, → `mathBlock`) the menu warns before
  discarding.
- **Tag** and **Link to note** dispatch the existing `corddb:fragment-action` event. No new
  tag UI is built in this phase.

`FragmentOverlay` and `WikiLinkPills` both position off block ids and must be verified to
still line up once content sits one level deeper inside a `block` wrapper.

## 8. Commands, command bar, quicktype, clipboard

**Slash menu.** `SlashCommand.configure({ mode: 'note' | 'notepad' })`. Every item routes
its insertion through one helper, `insertAt(editor, range, node)`, which wraps top-level
nodes in a `block` when in notepad mode. Toggle-style items (paragraph, h1–h3, the three
lists, blockquote, code block) are unchanged — they act on the textblock inside the block.
Templates insert N blocks, one per template node. A new notepad-only item, **Block
reference** (`/ref`), opens a block picker. A `/` menu inside a block never produces
content outside it.

**Command bar.** The existing `corddb:editor-command` event gains `block:moveUp`,
`block:moveDown`, `block:duplicate`, `block:delete`, `block:turnInto:<type>`,
`notepad:insertRef`, and **New notepad**. `TitleBar` reads the active note's kind and hides
the block commands for plain notes.

**Markdown quicktype.** StarterKit's input rules operate on textblocks and keep working
inside a `block`. The rules that produce a top-level node (`---`, ``` ``` ```) are caught by
the normalizer. Every rule gets a notepad-mode test.

**Clipboard.** `markdownClipboard.ts` paste path is unchanged — `marked` produces top-level
nodes, the normalizer wraps them. The copy path unwraps `block` containers, so blocks are
invisible in emitted markdown and a copied notepad selection pastes cleanly into a note.

## 9. Creation and conversion

The new-note button becomes a split button, Note / Notepad; the command bar gains
**New notepad**. `notes:create` takes `kind`, and a new notepad is seeded with
`{ type: 'doc', content: [{ type: 'block', content: [{ type: 'paragraph' }] }] }`.

`notes:convert(id, kind)`:

- **note → notepad** — wrap each top-level node in a `block`, mint ids, reproject.
- **notepad → note** — unwrap every block, behind a hold-to-confirm (reusing the existing
  `HoldButton` pattern) that states the cost concretely: *"12 block tags and 3 block links
  will stop being shown. 2 references from other notepads will break."* `fragments` rows are
  **not** deleted, so converting back restores them. Any `blockRef` pointing into this note
  renders as unresolved afterwards.

Conversion emits one `note:update` oplog entry.

## 10. Save path and services

Save shape is unchanged: a debounced `notes:update` carrying `bodyJson`.
`NoteService.create`, `update` and `restore` additionally call
`BlockIndexService.reproject(noteId)`, inside the same transaction. Soft delete leaves the
rows in place — every query joins `notes` and filters on `deleted_at`, and restore would only
have to rebuild them. `permanentDelete` deletes them.

`BlockIndexService`:

- `reproject(noteId)` — parse `body_json`, `DELETE FROM blocks WHERE note_id = ?`, insert one
  row per top-level node. Idempotent; runs for both note kinds.
- `listForNote(noteId)`
- `resolveRef(refBlockId)` → `{ noteId, noteTitle, type, contentJson } | null`, extracting the
  block from the source note's `body_json`.
- `rebuildAll(vaultId)` — maintenance, and the migration back-fill for existing notes.

Reprojection is a text-and-structure index build. It never reads or writes `fragments`.

## 11. IPC

| Command | Purpose |
|---|---|
| `notes:create` | gains `kind` |
| `notes:convert` | new — convert between kinds |
| `blocks:listForNote` | new |
| `blocks:resolveRef` | new — transclusion target |
| `blocks:reproject` | new — repair / maintenance |

Handlers stay thin: parse, delegate to `BlockIndexService` or `NoteService`, return.
`blocks:query` is deferred to the query-views phase.

## 12. Migration

1. Add `notes.kind` with default `'note'` — existing notes are unaffected.
2. Create `blocks` and its indexes.
3. Back-fill: `rebuildAll` over every vault, so search works from first launch after upgrade.
4. Guarded `ALTER TABLE notes DROP COLUMN body_markdown`.

## 13. Testing (Vitest, in `__tests__/` beside each file)

- **BlockNormalizer** — wraps stray top-level nodes; ids are stable across unrelated edits;
  a trailing empty block always exists; empty-content blocks are dropped.
- **Reprojection** — doc → rows with correct type, sort, heading level and flattened text;
  idempotent across repeated runs; synthetic ids are deterministic; `fragments` rows survive
  a reproject.
- **Conversion** — both directions; note → notepad → note round-trips content unchanged.
- **Markdown quicktype in notepad mode** — every input rule, asserting nothing lands outside
  a block.
- **Clipboard** — multi-block paste; multi-block copy round-trip; notepad copy → note paste.
- **`resolveRef`** — resolved, missing note, missing block, soft-deleted source note, and
  self-reference (rejected).
- **Slash items in notepad mode** — no item can create top-level content.
- **Search / mentions** — results over `blocks`, including the new block anchor on mentions.

## 14. Documentation to update in the same change

CLAUDE.md: the frozen schema block (`notes` row, new `blocks` row), frozen decision #4
(`body_json` is source of truth; the `body_markdown` clause goes), principle #3 (note the
`blocks` exception), principle "every write appends to operation_log" (note the derived-index
exception), the Shuttle frozen node type list (`block`, `blockRef`), and a note on the two
note kinds.

## 15. Ownership

| Developer | Work |
|---|---|
| Sajon | Schema + migration, `BlockIndexService`, IPC, `block` / `blockRef` nodes, `BlockNormalizer`, slash / quicktype / clipboard rewiring, `body_markdown` removal, search rebuild, all tests |
| CompressedDuck | `BlockChrome`, block menu, drag and drop UX, split new-note button, conversion confirm dialog, editor file split |
| Lotar | None. No Rust in this phase; search stays in the sidecar until M4. |

## 16. Deviations from this design, as built

1. **`body_markdown` was removed entirely**, not derived on save. Decided after the
   design was approved: the column had never actually been written, so `notes:search`
   and `findUnlinkedMentions` were running against empty text. Both now query
   `blocks.text`, which is why the index covers plain notes too (§4.5).
2. **`Editor.tsx` was not split into `NoteEditor` / `NotepadEditor`.** The shell —
   title row, tag panel, toolbar, status bar — is identical for both kinds, so a split
   would have duplicated it or required five new presentational files to avoid that.
   Instead the document logic moved to `editor/useNoteDoc.ts` and `Editor.tsx` renders
   notepad-only surfaces conditionally. Same reduction in file size, less indirection.
3. **`replaceBlockWith` was added** as the single path for inserting block-level content
   (templates, dividers, math, transclusions). Not in the original design; needed
   because `insertContent` from inside a nested paragraph leaves placement to
   ProseMirror's fitting algorithm.
4. **Enter and Backspace needed custom handling** inside `Block`. The defaults cannot
   work: splitting or joining wrappers would give one block two content nodes, which
   the content spec forbids, so ProseMirror refuses and the keys do nothing.
5. **A boot-time `backfillMissing`** replaced the migration-time `rebuildAll`, so
   startup cost is proportional to what is actually missing rather than to vault size.
6. **Pending saves now flush** when switching notes or unmounting. Pre-existing bug
   found while extracting the save cycle: edits made inside the 750 ms debounce window
   were dropped.
7. **The `＋` button types `/`** rather than opening the menu programmatically, so both
   entry points go through one code path.

8. **The wrapper node is `notepadBlock`, not `block`.** Naming it `block` collided with
   the built-in `block` *group*: a node-type name takes precedence over a group name in
   a content expression, so `blockquote` (`content: 'block+'`) and `listItem`
   (`'paragraph block*'`) silently stopped accepting paragraphs and accepted only
   wrappers. Caught by a test asserting "Turn into → Quote" works.
9. **Node construction uses `createChecked`.** `create` does not validate content, so
   an impossible conversion built an invalid document rather than failing.

### Bugs the DOM test suite caught

`happy-dom` was added and the gap closed — 54 tests now drive a real editor. It found
four defects, all of which would have shipped:

1. **`moveBlock` threw on every call.** It used `$pos.before(depth - 1)`, illegal when
   the parent is the document — which it always is for a top-level block. Drag reorder
   and `Alt+↑/↓` could never have worked.
2. **`moveBlock` downward silently did nothing.** Mapping a pre-deletion insertion point
   through the deletion returns the collapsed boundary, i.e. exactly where the block
   started. Now computed in post-deletion coordinates.
3. **Enter mid-text produced two blocks sharing one `blockId`.** ProseMirror's split
   copies attrs to both halves, so the index would have had a primary-key collision and
   fragment tags would have applied to both. The normalizer now re-mints duplicates,
   keeping the earliest occurrence — it holds the original position, so its annotations
   stay put.
4. **"Turn into → Quote" was a no-op.** `createAndFill` returns null for a `block+`
   content spec even with a valid child; and the underlying cause was the node-name
   collision in (8).

Remaining gap: `BlockChrome`'s pointer-driven drag and `BlockRefView`'s async resolution
are not covered — both need a rendered React tree with layout, which happy-dom does not
provide meaningfully (no real geometry for `getBoundingClientRect`). The commands they
call are covered.

## 17. Follow-up: `shuttle/`

Work happens in-tree in `cord/apps/desktop`, where it can be tested against the real sidecar
and database. Re-seeding the `shuttle/` repo from the result is a separate follow-up, as is
the decoupling work its README describes.

**Status:** the re-seed is done — `shuttle` now carries the v1.6 notepad editor. The
decoupling is not, and the repo stays private until it is. Shuttle becomes public once it
builds without Cord; see `PACKAGING.md` in that repo for the plan.
