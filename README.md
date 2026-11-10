# Cord

[![CI](https://github.com/cord-note/cord/actions/workflows/ci.yml/badge.svg)](https://github.com/cord-note/cord/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cord-note/cord?include_prereleases&sort=semver)](https://github.com/cord-note/cord/releases/latest)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Local-first desktop note-taking app. Vaults → Notes → Links → Tags — a knowledge graph, not a filing cabinet.

**Status:** 3.0, in beta (first build `v3.0.0-beta.1`); 2.4.1 is the current
stable release. Notes are written in
[Shuttle](https://github.com/cord-note/shuttle), Cord's Tiptap 3 editor, and
local accounts unlock with a PIN. Since 3.0 everything runs in one process: a
Tauri shell over a Rust core (`crates/cord-core`), with notes stored in a
format built for sync between devices. Tags can carry fields and be shown as
tables or boards, and AI agents can reach your notes through the **Agents** tab
(see [cord-mcp](https://github.com/cord-note/cord-mcp)). Themes can be
imported from a folder, a zip or a Git repo; see
[cord-themes](https://github.com/cord-note/cord-themes) for 32 to start with.
What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## Install

Download from the [latest release](https://github.com/cord-note/cord/releases/latest).

| Platform | File |
|---|---|
| Windows | `Cord_<version>_x64-setup.exe` |
| macOS (Apple Silicon) | `Cord_<version>_aarch64.dmg` |
| Linux (Debian/Ubuntu) | `Cord_<version>_amd64.deb` |
| Linux (Fedora) | `Cord_<version>-1.x86_64.rpm` |
| Arch Linux | `cord-bin-<version>-1-x86_64.pkg.tar.zst` |
| Linux (anything else) | `Cord_<version>_amd64.AppImage` |

Cord is **not code-signed yet**, so Windows and macOS will both object the first
time. Nothing is wrong; there is simply no certificate behind the binary.

- **Windows** — SmartScreen calls it an unrecognised app. *More info* →
  *Run anyway*.
- **macOS** — Gatekeeper refuses to open it. Right-click the app, choose *Open*,
  then confirm. Double-clicking will not offer that option.
- **Linux** — no warning.

### Arch Linux

```bash
sudo pacman -U ./cord-bin-<version>-1-x86_64.pkg.tar.zst
```

`cord-bin` repackages the `.deb`, so it installs in seconds rather than building
Cord from source.

Cord is **not on the AUR yet** — Arch has closed new account registration, so
there is no account to publish it from. The PKGBUILD and the workflow that
publishes it are both ready and tested; the moment registration reopens,
`cord-bin` goes up and `paru -S cord-bin` starts working. Until then the
`.pkg.tar.zst` on each release is the same package, just installed by hand.

To build it yourself instead:

```bash
git clone https://github.com/cord-note/cord.git
cd cord/packaging/aur
makepkg -si
```

### Debian, Ubuntu, Fedora

```bash
sudo apt install ./Cord_<version>_amd64.deb      # Debian, Ubuntu
sudo dnf install ./Cord_<version>-1.x86_64.rpm   # Fedora
```

There is no apt or dnf repository yet, so these do not auto-update — download a
newer file and install it over the top.

### AppImage

```bash
chmod +x Cord_<version>_amd64.AppImage
./Cord_<version>_amd64.AppImage
```

AppImages need FUSE 2, which some distributions no longer install by default —
Arch among them. Either install it (`sudo pacman -S fuse2`) or skip it entirely
with `--appimage-extract-and-run`.

### Intel Macs

Not built. It needs a second macOS runner, and an unsigned
`.app` is awkward to open on any Mac until code signing exists, so the cost buys
little today. Build from source meanwhile — see [Develop](#develop).

### Your notes

Cord keeps everything in local SQLite databases in its data folder, with images
you paste into notes as files beside them. Nothing is uploaded anywhere: there is
no cloud account, no telemetry and no sync yet.

| Platform | Location |
|---|---|
| Linux | `$XDG_DATA_HOME/cord/`, or `~/.local/share/cord/` |
| macOS, Windows | `~/.cord/` |

Inside it, `machine.db` holds the local accounts, and each account has its own
folder under `users/<id>/` with its notes (`cord.db`), search index, attachments
and settings.

Linux follows the XDG base directory specification so that a package installed
by apt, dnf or pacman behaves the way its distribution expects. An existing
`~/.cord` is moved there once, on the first launch of a version that looks for
it — nothing is deleted.

**Upgrading from 2.x:** on first start, Cord 3.0 copies your notes, tags,
attachments and settings from the 2.x `cord.db` into the new format. The old
database is never changed, and a copy that was stopped halfway starts over
cleanly. Back up the data folder before trying a beta.

## Updating

Cord checks for a newer release on startup and offers to install it. Update
artifacts are signed with a key the app carries, so a build that was not signed
by that key is refused rather than installed.

This applies to the Windows installer, the macOS app and the AppImage. A `.deb`,
`.rpm` or AUR install is owned by your package manager, which is the only thing
that should be replacing files under `/usr` — those builds never check for
updates and never prompt. Use `apt`, `dnf` or your AUR helper instead.

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
| Editor | [Shuttle](https://github.com/cord-note/shuttle) (`shuttle-editor` on npm, official Tiptap 3) — [see below](#shuttle) |
| Core | `cord-core`, a Rust crate (no Tauri) |
| Database | SQLite via `rusqlite`, FTS5 for search |
| Note bodies | Yjs documents (`yrs` in Rust, `yjs` in the editor) |
| State | Zustand |
| Graph | Cytoscape.js |
| Tests | `bun test` (renderer), `cargo test` (core and shell) |

## Note kinds

| Kind | What it is for |
|---|---|
| `note` | Quick, simple capture. |
| `notepad` | A page of addressable, transcludable blocks. |

Both kinds share one document format: every top-level block carries a stable
`blockId`. A notepad is the same document with the block gutter and block menu
turned on, so switching kind changes nothing but the `kind` column. A notepad is
one ProseMirror instance, never one editor per block. Blocks are flat, and a
whole list is one block.

## Architecture principles

1. Local DB is the source of truth. Other devices and servers are replication
   targets.
2. Every synced write goes through one path in `cord-core` (`Session::write`),
   which stamps it with a hybrid logical clock and records it in the outbox
   (`changes`) in the same transaction. Machine-local data — accounts, PIN and
   recovery hashes, settings files — is never synced or recorded.
3. No hard deletes — `deleted_at` / `archived_at` only. The one exception is the
   derived index, which holds no authored data.
4. A note's body is a Yjs document; `body_json` is derived from it, and markdown
   is input UX only, via the clipboard. The block index, search and
   `note_links` are derived from the body on every save, in a separate
   `index.db` that can be rebuilt at any time.
5. The Tauri layer stays thin: commands are short calls into `cord-core`, which
   holds the domain logic and has no Tauri in it.
6. Plugin-driven UI registry — no hardcoded UI for module surfaces.

## Layout

```
cord/
  crates/
    cord-core/            Rust domain core: storage, clocks, outbox, services, import
  apps/
    desktop/
      src-tauri/          Tauri shell: thin commands, MCP server for agents
      src/
        renderer/         React + Vite frontend (components, pages, hooks, store)
        shared/           types and theming code shared across the IPC boundary
```

## Shuttle

Cord's editor is **Shuttle**, a separate, public package:
[cord-note/shuttle](https://github.com/cord-note/shuttle), published to npm as
`shuttle-editor`. It is built on official Tiptap 3 extensions, and markdown is
input UX only — syntax disappears as you type and storage is Tiptap JSON.

Cord depends on it from npm like any other package. Shuttle never imports Cord:
Cord supplies a `ShuttleHost` (`apps/desktop/src/renderer/shuttle/cordHost.ts`)
that answers note lookups, stores pasted images, resolves transclusions and
handles navigation over Cord's stores and IPC. The editor edits the note's Yjs
document directly (the `ydoc` prop), and Cord sends the updates to the core as
raw bytes. The core reads documents with its own port of `shuttle-editor/doc`
(`crates/cord-core/src/doc/`), checked against the same fixtures as the
TypeScript original.

Pasted and dropped images are stored as files in the account's `attachments/`
folder and referenced from the document as `attachment:<id>`; the Tauri shell serves them
to the editor through a `cord-attachment` URI scheme.

## Develop

Requires Node 22+, pnpm 10+, [Bun](https://bun.sh) (test runner and renderer
build), Rust, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/cord-note/cord.git
cd cord
pnpm install
pnpm dev          # tauri dev — Vite + Rust shell
pnpm test         # bun test (renderer)
pnpm typecheck
```

The Rust tests run with `cargo test`, in `crates/cord-core` and in
`apps/desktop/src-tauri`. The shell tests drive the real commands through
Tauri's mock IPC.

To keep a development build away from your real notes, point it at another data
folder with `CORD_DATA_DIR` (a copy of your data folder is fine):

```bash
CORD_DATA_DIR=/tmp/cord-dev pnpm dev
```

## Releasing

Tauri cannot cross-compile: every platform links against its own native webview
and system linker. So releases are built by one CI runner per operating system —
`windows-latest`, `macos-latest`, and `ubuntu-22.04` — each building the
renderer and the Rust app for its target and bundling its own installer.

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
React → invoke('entity_action', payload)
  → Tauri command (thin: receive, check, call cord-core)
  → domain service → SQLite write + outbox entry, one transaction
  → response → React re-render
```

Everything runs in the one Cord process; there is no sidecar since 3.0.

## License

Copyright (C) 2026 Aleksander Sprengel.

Licensed under the **GNU Affero General Public License v3.0 or later**. The full
text is in [LICENSE](LICENSE).

In short: you may use, study, modify and redistribute Cord, but anything you
distribute — or **run as a network service** — must be offered under the same
licence, with source. That network clause (AGPL §13) is the reason for choosing
AGPL over GPL: it covers a hosted sync backend, which a plain GPL would not.

Cord depends on MIT- and Apache-licensed work, including Tiptap OSS, React,
Tauri and Yjs; those licences continue to govern those components.
