# Arch Linux (AUR)

Cord is on the AUR as [`cord-bin`](https://aur.archlinux.org/packages/cord-bin),
which repackages the `.deb` from the GitHub release. `cord-bin` installs in
seconds; building Cord from source would need Rust, Bun, pnpm and Node on the
user's machine for a ten-minute build.

This directory is the source of truth. The AUR repo is a copy, pushed by
`.github/workflows/aur.yml`. Edit the PKGBUILD here, never there.

## How publishing works

1. You push a `v*` tag. `release.yml` builds the installers and leaves a
   **draft** release.
2. You review the draft and publish it.
3. Publishing fires `aur.yml`, which downloads the `.deb` from the now-public
   release, hashes it, bumps `pkgver` and `sha256sums`, builds the package in an
   Arch container to prove it works, regenerates `.SRCINFO` and pushes to the
   AUR.

The order matters. A draft release's assets are not publicly downloadable, so a
PKGBUILD published at tag time would 404 for every user until you published the
draft.

Prereleases are skipped — a hyphen in the tag stops the workflow. The AUR
carries stable versions only.

`release.yml` also has a `verify_aur` job that builds this PKGBUILD against
every run's `.deb` and installs it, so a broken PKGBUILD is caught before a
release rather than by the first user who tries it.

## One-time setup

Two things only you can do.

### 1. An AUR account

Register at https://aur.archlinux.org/register. The name `cord-bin` is
unclaimed; the first push creates the package and makes you its maintainer.

### 2. An SSH key for CI

Generate a key used for nothing else:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/aur_cord -C "aur-cord-ci" -N ""
```

- Add the **public** half (`~/.ssh/aur_cord.pub`) to your AUR account under
  My Account → SSH Public Key.
- Add the **private** half (`~/.ssh/aur_cord`) to the GitHub repo as a secret
  named `AUR_SSH_KEY`, under Settings → Secrets and variables → Actions. Paste
  the whole file, `-----BEGIN` line included.

Without the secret, `aur.yml` stops with a clear error rather than half-pushing.

### 3. The first upload

The workflow can do it, but for the first one it is worth watching. Either run
the **Publish to the AUR** workflow by hand with a stable tag, or do it locally:

```bash
git clone ssh://aur@aur.archlinux.org/cord-bin.git
cd cord-bin
cp /path/to/cord/packaging/aur/{PKGBUILD,.SRCINFO} .
# set pkgver and the real sha256sum of the release .deb first
makepkg -si          # prove it builds and installs
makepkg --printsrcinfo > .SRCINFO
git add PKGBUILD .SRCINFO
git commit -m "Initial import"
git push
```

## Testing a change locally

On an Arch machine, from this directory:

```bash
makepkg -si --noconfirm
namcap PKGBUILD
namcap ./*.pkg.tar.zst
```

To test against a locally built `.deb` instead of the release, point `source` at
the file and pass `--skipchecksums`, which is what `verify_aur` does.

## Notes

- `package()` unpacks `data.tar.gz` from the `.deb` whole rather than naming
  individual paths. Tauri already lays the `.deb` out correctly, so this picks
  up new icon sizes or added files without the PKGBUILD needing a change.
- `options=('!strip')` — the Bun sidecar is a compiled binary with its bundle
  embedded, and the Rust binary is stripped by the release profile already.
- `provides`/`conflicts` name `cord`, so a from-source `cord` package could be
  added later without the two colliding.
- Updates are the package manager's job. Cord's built-in updater disables itself
  on any install that is not an AppImage, so `cord-bin` never prompts.
