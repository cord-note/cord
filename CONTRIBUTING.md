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

- The stack. Tauri over Electron, Bun over Node, Tiptap OSS, React + Vite.
- The local database is the source of truth. Cloud would be a replication
  target, never the master.
- `body_json` is the only stored representation of a document. Markdown is input
  UX, via the clipboard.
- No hard deletes — `deleted_at` / `archived_at` only.
- Every write appends to `operation_log`.
- Two note kinds, `note` and `notepad`. A notepad is **one** ProseMirror
  instance, never one editor per block.
- Notepad blocks are flat and per-top-level-node. You cannot tag or link an
  individual bullet; that was an accepted cost, not an oversight.
- Transclusion is read-only and by reference — content is never copied.

The exceptions to the operation-log and no-hard-deletes rules, both concerning
the derived `blocks` index, are described in the README.

Bug fixes and small, obvious improvements need no ceremony. Send them.

## Getting set up

You need Node 22+, pnpm 10+, [Bun](https://bun.sh), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
pnpm install
pnpm dev          # tauri dev — Vite + Bun sidecar + Rust shell
pnpm test
pnpm typecheck
```

Cord keeps its database at `~/.cord/cord.db`. To work against a throwaway one,
set `CORD_DB_PATH`:

```bash
CORD_DB_PATH=/tmp/scratch.db pnpm dev
```

That is also how to reach the first-run register screen without touching your
real notes.

## House style

The codebase has a consistent voice; matching it matters more than any
individual rule here.

- **TypeScript, strict.** No `any` without a comment saying why.
- **Explicit types on function signatures.** Inference is fine inside a body.
- **Drizzle for all database access.** No raw SQL outside migration files.
- **Every domain service method that writes appends to `operation_log`.** The
  one exception is the derived `blocks` index, and that exception is documented
  where it lives.
- **No `console.log` in production paths.**
- **Tests go in `__tests__/` beside the file they test**, and run under
  `bun test`.
- **Comments explain why, not what.** A comment restating the code is noise; a
  comment recording the constraint that forced an odd shape is the reason the
  next person does not "simplify" it back into a bug. Several already in the
  tree exist for exactly that reason — read a few before writing your own.

## Architecture, briefly

Business logic lives in the Bun sidecar. The Tauri Rust layer stays thin —
receive, validate, forward — and only search and file watching are allowed to be
Rust-native, because those have a measured reason to be. Speculative Rust ports
will be declined.

The editor (Shuttle) lives under `apps/desktop/src/renderer/components/editor/`
and is being extracted into its own package. Changes there are welcome, but
expect them to move repositories eventually.

## Pull requests

- Branch from `main`. The repository rebases, so keep history linear.
- `pnpm typecheck` and `pnpm test` must pass. CI runs both plus a renderer build
  and `cargo check`.
- Say **why** in the description, not just what. The diff already says what.
- One concern per PR. A formatting sweep bundled with a bug fix makes the fix
  impossible to review.

## Licence

Cord is AGPL-3.0-or-later. By contributing you agree your work ships under it.
There is no CLA.
