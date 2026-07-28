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

## Architecture principles

1. Local DB is the source of truth. Cloud is a replication target.
2. Every write appends to `operation_log`. No exceptions.
3. No hard deletes — `deleted_at` / `archived_at` only.
4. `body_json` is the source of truth; `body_markdown` is derived on save.
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

```bash
pnpm install
pnpm --filter ./apps/desktop dev       # tauri dev (Vite + sidecar + Rust shell)
pnpm --filter ./apps/desktop test      # bun test
pnpm --filter ./apps/desktop typecheck
```

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

Private / all rights reserved.
