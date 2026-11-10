# Contributing to Cord

Thanks for looking. Cord is written and maintained by one person, and it is
small and opinionated, so it is worth reading this before spending time on a
change. Reviews come from me alone — expect them to be considered rather than
instant.

## Before you start

**Open an issue first for anything non-trivial.** Some of Cord's design is
settled deliberately, and a PR that crosses one of those lines will be declined
however good the code is — that is a waste of your afternoon rather than a
judgement on the work. The settled parts:

- The stack. Tauri over Electron, a Rust core (`crates/cord-core`), official
  Tiptap 3 (through Shuttle), React + Vite.
- The local database is the source of truth. Cloud would be a replication
  target, never the master.
- A note's body is a Yjs document, and `body_json` is derived from it. Markdown
  is input UX, via the clipboard. `note_links` is derived from the body on save,
  never written directly.
- No hard deletes — `deleted_at` / `archived_at` only.
- Every synced write goes through `Session::write` in `cord-core`, which records
  it in the outbox for sync. Nothing else writes synced tables.
- Two note kinds, `note` and `notepad`, sharing one document format. A notepad
  is a mode over the same schema (no wrapper node), and **one** ProseMirror
  instance, never one editor per block.
- Notepad blocks are flat and per-top-level-node. You cannot tag or link an
  individual bullet; that was an accepted cost, not an oversight.
- Transclusion is read-only and by reference — content is never copied.

The exception to the no-hard-deletes rule, the derived index, is described in
the README.

Bug fixes and small, obvious improvements need no ceremony. Send them.

## Getting set up

You need Node 22+, pnpm 10+, [Bun](https://bun.sh), Rust, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
pnpm install
pnpm dev          # tauri dev — Vite + Rust shell
pnpm test         # renderer tests
pnpm typecheck
```

Run `cargo test` in `crates/cord-core` and in `apps/desktop/src-tauri` for the
Rust side. On Windows, run cargo from PowerShell rather than Git Bash.

Cord keeps its data in its data directory — `~/.local/share/cord/` on Linux,
`~/.cord/` on macOS and Windows. To work against a throwaway one, set
`CORD_DATA_DIR`:

```bash
CORD_DATA_DIR=/tmp/cord-scratch pnpm dev
```

That is also how to reach the first-run register screen without touching your
real notes.

## House style

The codebase has a consistent voice; matching it matters more than any
individual rule here.

- **TypeScript, strict.** No `any` without a comment saying why.
- **Explicit types on function signatures.** Inference is fine inside a body.
- **Rust core: schema SQL lives only in `crates/cord-core/src/store/sql.rs`**, as
  append-only migration steps. Entities and their fields are listed once, in
  `src/entity.rs`.
- **Every synced write goes through `Session::write`.** Derived index tables are
  the exception, and that is documented where they live.
- **No `console.log` in production paths.**
- **Tests:** TypeScript tests go in `__tests__/` beside the file they test and
  run under `bun test`; Rust tests are inline `#[cfg(test)]` modules.
- **Comments explain why, not what.** A comment restating the code is noise; a
  comment recording the constraint that forced an odd shape is the reason the
  next person does not "simplify" it back into a bug. Several already in the
  tree exist for exactly that reason — read a few before writing your own.

## Architecture, briefly

Business logic lives in `crates/cord-core`, which knows nothing about Tauri.
The Tauri layer stays thin — receive, check, call the core — and keeps the
renderer's JSON shapes in `src-tauri/src/dto.rs`. The MCP server for agents lives
in `src-tauri/src/mcp/`.

The editor is the [`shuttle-editor`](https://github.com/cord-note/shuttle)
package; changes to the editor itself belong in that repository. Cord's side of
it is the host adapter in `apps/desktop/src/renderer/shuttle/` and the overlays
(fragment chips, context menu, link pills) in
`apps/desktop/src/renderer/components/overlays/`.

## Pull requests

- Branch from `main`. The repository rebases, so keep history linear.
- `pnpm typecheck`, `pnpm test` and `cargo test` must pass. CI runs them plus a
  renderer build and `cargo check`.
- Say **why** in the description, not just what. The diff already says what.
- One concern per PR. A formatting sweep bundled with a bug fix makes the fix
  impossible to review.

## Licence

Cord is AGPL-3.0-or-later. By contributing you agree your work ships under it.
There is no CLA.
