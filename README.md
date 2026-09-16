# Cord

[![CI](https://github.com/cord-note/cord/actions/workflows/ci.yml/badge.svg)](https://github.com/cord-note/cord/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cord-note/cord?include_prereleases&sort=semver)](https://github.com/cord-note/cord/releases/latest)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Local-first desktop note-taking app. Vaults → Notes → Links → Tags — a knowledge graph, not a filing cabinet.

**Status:** v1.7.0-beta.1 — the move off Electron + Next.js (see the older
`CordDB` repo) has landed. Cord now runs on a Tauri shell with a Bun sidecar and
the React frontend carried across, and full-text search runs natively in Rust
against SQLite FTS5.

Beta because the installers are young, not because the app is half-built. Every
platform is built and signed by CI, but only Windows has had much real use.

## Install

Download from the [latest release](https://github.com/cord-note/cord/releases/latest).

| Platform | File |
|---|---|
| Windows | `Cord_<version>_x64-setup.exe` |
| macOS (Apple Silicon) | `Cord_<version>_aarch64.dmg` |
| Linux (Debian/Ubuntu) | `Cord_<version>_amd64.deb` |
| Linux (anything else) | `Cord_<version>_amd64.AppImage` |

Cord is **not code-signed yet**, so Windows and macOS will both object the first
time. Nothing is wrong; there is simply no certificate behind the binary.

- **Windows** — SmartScreen calls it an unrecognised app. *More info* →
  *Run anyway*.
- **macOS** — Gatekeeper refuses to open it. Right-click the app, choose *Open*,
  then confirm. Double-clicking will not offer that option.
- **Linux** — no warning.

### AppImage

```bash
chmod +x Cord_<version>_amd64.AppImage
./Cord_<version>_amd64.AppImage
```

AppImages need FUSE 2, which some distributions no longer install by default —
Arch among them. Either install it (`sudo pacman -S fuse2`) or skip it entirely
with `--appimage-extract-and-run`.

### Intel Macs

Not built. It needs a second runner and a fourth sidecar target, and an unsigned
`.app` is awkward to open on any Mac until code signing exists, so the cost buys
little today. Build from source meanwhile — see [Develop](#develop).

### Your notes

Cord keeps everything in a local SQLite database at `~/.cord/cord.db`. Nothing
is uploaded anywhere: there is no account, no telemetry and no sync yet.

## Updating

Cord checks for a newer release on startup and offers to install it. Update
artifacts are signed with a key the app carries, so a build that was not signed
by that key is refused rather than installed.

The update check reads
[`latest.json`](https://github.com/cord-note/cord/releases/latest/download/latest.json)
from the newest release. Note that GitHub's `releases/latest` deliberately skips
anything flagged as a pre-release, so a release marked that way is invisible to
installed copies — worth knowing before flagging one.

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri (Rust) |
| Frontend | React + Vite + TypeScript |
| Editor | Shuttle — Tiptap OSS + ghost-markdown layer ([see below](#shuttle)) |
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
5. The Tauri Rust layer stays thin by default. Business logic lives in the Bun sidecar; logic moves to Rust only for approved, measurable hot paths (currently just FTS5 search).
6. Plugin-driven UI registry — no hardcoded UI for module surfaces.

## Layout

```
cord/
  apps/
    desktop/
      src-tauri/          Rust shell + FTS5 search
      src/
        renderer/         React + Vite frontend (components, pages, hooks, store)
        sidecar/          Bun backend — domain services, Drizzle schema, adapters
        shared/           DTOs and constants shared across the IPC boundary
  packages/               core / sync / notebook / export (phased)
```

## Shuttle

Cord's editor is called **Shuttle** — Tiptap OSS plus a ghost-markdown layer,
where syntax disappears as you type and storage is Tiptap JSON.

It is being extracted into its own repository so that Cord depends on it as a
package rather than carrying its source. That repository is **not public yet**,
and deliberately so: the editor still imports Cord's Zustand stores and IPC
client in about a dozen places, so it does not build on its own. Publishing it
in that state would mean publishing something nobody could actually use.

**Shuttle will be made public once it is properly separated** — a narrow host
interface in place of those imports, its own types, and a build that stands up
without Cord. Until then the working copy lives here, under
`apps/desktop/src/renderer/components/editor/`, and that is the version Cord
actually runs.

## Develop

Requires Node 22+, pnpm 10+, [Bun](https://bun.sh), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/cord-note/cord.git
cd cord
pnpm install
pnpm dev          # tauri dev — Vite + Bun sidecar + Rust shell
pnpm test         # bun test
pnpm typecheck
pnpm build        # renderer + sidecar binaries for all three targets
```

The Rust shell embeds the Bun sidecar as an `externalBin`, so `pnpm build` must
run before `tauri build` — the build script fails if no sidecar exists for the
host triple.

## Releasing

Tauri cannot cross-compile: every platform links against its own native webview
and system linker. So releases are built by one CI runner per operating system —
`windows-latest`, `macos-latest`, and `ubuntu-22.04` — each compiling its own Bun
sidecar, building the Rust shell for its target, and bundling its own installer.

Linux is pinned to 22.04 rather than `ubuntu-latest` on purpose: an AppImage
links against the glibc of the machine that built it, so building on a newer
release produces one that refuses to start on older distributions.

Cutting a release is a tag. Bump the version in all three manifests first —
`apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json` and
`apps/desktop/src-tauri/Cargo.toml` — then:

```bash
git tag -a v1.7.1 -m "Cord 1.7.1"
git push origin v1.7.1
```

A guard job refuses to build when the tag disagrees with those manifests, so a
mislabelled installer cannot ship. Prerelease tags compare only the part before
the hyphen, so `v1.7.1-beta.1` is a build of `1.7.1` and the manifests stay at
plain `1.7.1`.

The workflow attaches installers to a **draft** release, which stays private
until published by hand. `workflow_dispatch` rehearses the whole matrix without
creating a tag or touching a release.

Signing the update artifacts needs `TAURI_SIGNING_PRIVATE_KEY` as a repository
secret. Without it the installers still build, but `latest.json` carries no valid
signature and every client refuses the update — which is the safe direction to
fail.

## IPC flow

```
React → invoke('entity:action', payload)
  → Tauri command (thin: receive, validate, forward)
  → HTTP POST to Bun sidecar (local socket)
  → domain service → SQLite write + operation_log append
  → response → React re-render
```

Rust-native search skips the sidecar hop and queries SQLite FTS5 directly.

## License

Copyright (C) 2026 Aleksander Sprengel.

Licensed under the **GNU Affero General Public License v3.0 or later**. The full
text is in [LICENSE](LICENSE).

In short: you may use, study, modify and redistribute Cord, but anything you
distribute — or **run as a network service** — must be offered under the same
licence, with source. That network clause (AGPL §13) is the reason for choosing
AGPL over GPL: it covers a hosted sync backend, which a plain GPL would not.

Cord depends on MIT- and Apache-licensed work, including Tiptap OSS, React,
Tauri and Drizzle; those licences continue to govern those components.
