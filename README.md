# Cord

Local-first desktop note-taking app. Vaults → Notes → Links → Tags — a knowledge graph, not a filing cabinet.

**Status:** v1.6 — migrating from Electron + Next.js (see the older `CordDB` repo) to Tauri + a Bun sidecar, carrying the existing React frontend across.

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri (Rust) |
| Frontend | React + Vite + TypeScript |
| Editor | [Shuttle](https://github.com/alexander-288/shuttle) — Tiptap OSS + ghost-markdown layer (its own repo) |
| Backend | Bun sidecar (local socket) |
| Database | SQLite via `bun:sqlite` |
| ORM | Drizzle |
| State | Zustand |
| Graph | Cytoscape.js |
| Tests | `bun test` |

## Note kinds

| Kind | Document schema | What it is for |
|---|---|---|
| `note` | `doc → (paragraph \| heading \| list \| …)+` | Quick, simple capture. |
| `notepad` | `doc → notepadBlock+` | A page of addressable, transcludable blocks. |

A notepad is one ProseMirror instance — blocks are fields inside a single view,
never one editor per block. Blocks are flat, and a whole list is one block.

## Architecture principles

1. Local DB is the source of truth. Cloud is a replication target.
2. Every write appends to `operation_log`, with one documented exception: the
   `blocks` table is a derived index, so reprojecting it logs nothing. The
   `body_json` it is derived from is logged, and a sync receiver reprojects
   locally from that.
3. No hard deletes — `deleted_at` / `archived_at` only. Same exception: `blocks`
   rows are replaced wholesale on save, because that table holds no authored
   data. Authored per-block data lives in `fragments` and is never reprojected.
4. `body_json` is the source of truth, and the only stored representation of a
   document. `body_markdown` was removed in v1.6; markdown is input UX only, via
   the clipboard. Searchable text comes from `blocks.text`.
5. The Tauri Rust layer stays thin by default. Business logic lives in the Bun sidecar; logic moves to Rust only for approved, measurable hot paths (FTS5 search, fs-watch).
6. Plugin-driven UI registry — no hardcoded UI for module surfaces.

## Layout

```
cord/
  apps/
    desktop/
      src-tauri/          Rust shell + approved Rust hot paths (search, fs-watch)
      src/
        renderer/         React + Vite frontend (components, pages, hooks, store)
        sidecar/          Bun backend — domain services, Drizzle schema, adapters
        shared/           DTOs and constants shared across the IPC boundary
  packages/               core / sync / notebook / export (phased)
```

The editor (**Shuttle**) is being extracted into its own repository for a significant rework; the copy under `renderer/components/editor/` is the current in-tree version.

## Develop

Requires Node 20+, pnpm 9+, [Bun](https://bun.sh), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
pnpm install
pnpm dev          # tauri dev — Vite + Bun sidecar + Rust shell
pnpm test         # bun test
pnpm typecheck
pnpm build        # renderer + sidecar binaries for all three targets
```

The Rust shell embeds the Bun sidecar as an `externalBin`, so `pnpm build` must
run before `tauri build` — the build script fails if no sidecar exists for the
host triple.

## IPC flow

```
React → invoke('entity:action', payload)
  → Tauri command (thin: receive, validate, forward)
  → HTTP POST to Bun sidecar (local socket)
  → domain service → SQLite write + operation_log append
  → response → React re-render
```

Rust-native hot paths (search, fs-watch) skip the sidecar hop and talk to SQLite FTS5 directly.

## License

Copyright (C) 2026 Cord contributors.

Licensed under the **GNU Affero General Public License v3.0 or later**. The full
text is in [LICENSE](LICENSE).

In short: you may use, study, modify and redistribute Cord, but anything you
distribute — or **run as a network service** — must be offered under the same
licence, with source. That network clause (AGPL §13) is the reason for choosing
AGPL over GPL: it covers a hosted sync backend, which a plain GPL would not.

Cord depends on MIT- and Apache-licensed work, including Tiptap OSS, React,
Tauri and Drizzle; those licences continue to govern those components.
