# Notes for Plan B (Cord cutover)

> Resolved by `2026-09-27-shuttle-cutover.md` (decisions: npm dependency, links derived on save, Twitch off). Cord has no CSP (`csp: null`), so the CSP parts of items 4 and 10 need no change.

Questions and constraints raised while building Plan A that must be settled when Plan B is written.

1. **Where `note_links` comes from.** `ShuttleHost.onLinksChanged(docKey, diff)` fires on every edit, before the
   debounced save. If Cord writes `note_links` from it, the table can disagree with `body_json` after a crash,
   a failed save, or an undo inside the debounce window. Alternative: derive `note_links` in the sidecar from
   `body_json` on `notes:update`, like the `blocks` index. Then `onLinksChanged` becomes a UI hint only.
   Same question for `onFragmentLinksRemoved`.
2. **Refreshing host data.** `ShuttleEditor` refreshes derived views (unlinked-mention decorations) when the
   `host` prop's identity changes. Cord's host object must therefore be rebuilt when the notes list changes,
   not memoised once.
3. **Transclusions resolve on mount.** A `blockRef` shows its source as of when it rendered, as in v1.6. Live
   updates of transcluded content would need a host subscription; not planned for Phase 1.
4. **Tauri CSP must allow `img-src blob:`** so image previews show while an upload is in flight.
5. **Uploads across a note switch.** An upload still in flight when the user switches notes is lost (logged
   as a warning; the attachment row may be orphaned). Options: keep the switch waiting for pending uploads, or
   let the host patch the stored document when the upload completes. Decide with the attachments service.
6. **Block ids in the DOM are `data-blockid`** (UniqueID's rendering, exported as `BLOCK_ID_ATTRIBUTE`), not
   v1.6's `data-block-id`. Cord's `FragmentOverlay`, `WikiLinkPills` and scroll-to-block code must query the new
   attribute. Tables render inside a `.tableWrapper` that does not carry it — overlays must look one level down.
7. **Dev-only React warning** "flushSync was called from inside a lifecycle method" appears when a note loads
   (Tiptap's React node views render synchronously during `setContent` inside ShuttleEditor's effect). Harmless;
   revisit if it shows up in production builds or if Tiptap offers a deferred mode.
8. **Single `@tiptap/core`.** Cord imports `Editor`/`JSONContent` only from `@cord/shuttle` and drops its own
   `@tiptap/*` deps (or dedupes them); otherwise Shuttle's command augmentations don't apply to Cord's `Editor`
   type.
9. **The sidecar must not import the React entry.** `BLOCK_TYPES` and future text-extraction helpers for
   `blocks.text` (mention labels, math latex, image alt) need a pure subpath export such as `@cord/shuttle/doc`.
10. **Tauri CSP `frame-src`** needs `https://www.youtube-nocookie.com` and `https://player.twitch.tv`. Twitch's
    `parent` must match the page host — on Windows Tauri serves `http://tauri.localhost`, so Twitch embeds may
    refuse to play; decide whether to pass `twitchParent` or hide Twitch.
11. **`onChange` failures are logged, never retried.** Cord must surface a failed `notes:update` itself.
12. **`doc` is read only when `docKey` changes.** External rewrites of an open note (sync receiver, sidecar
    edits) need a remount or a new key.
13. **A mode switch (note↔notepad) also drops in-flight uploads** (same class as 5).
14. **Scroll-to-block after `openNote(noteId, blockId)` is Cord's job**, via `[data-blockid]` after `onReady`
    (optionally add a `scrollToBlock` helper to Shuttle).
15. **`body_json` is TEXT.** Cord `JSON.parse`s it before passing `doc` and stores `onChange` output as-is
    (stringified).
