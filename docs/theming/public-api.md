# Theming public API

What a Cord augment is allowed to touch. An augment is a CSS file a user links
into Cord to change how it looks. It is **CSS only** — there is no JavaScript
augment API — and it may only use what this page lists. Everything else is
internal and may change in any release without notice.

`apps/desktop/src/renderer/styles/__tests__/publicApi.test.ts` keeps this page
and the code in sync: every class and token below must exist, and every
`cord-*` class or token in the code must be listed here. Adding one means
documenting it; removing one breaks that test on purpose.

## Rules

An augment may:

1. **Override tokens** — set any token below on `:root`, or on
   `[data-scheme="dark"]` / `[data-scheme="light"]` to change one scheme only.
   Tokens are the preferred way to theme: one override restyles every surface
   that uses it.
2. **Style public classes** — any class in the tables below, alone or combined
   with its modifiers and with other public classes
   (`.cord-note-list__item--active .cord-note-list__item-title`).
3. **Style note content** — plain element selectors inside
   `.cord-editor__body`: `h1`–`h6`, `p`, `a`, `strong`, `em`, `u`, `s`, `code`,
   `pre`, `blockquote`, `ul`, `ol`, `li`, `hr`, `table`, `th`, `td`, `mark`,
   `img`. The editor's node set changes rarely and deliberately, so these are
   stable.

An augment may not rely on:

- CSS-module classes (`_item_x7f2a` and similar) — they are hashed per build.
- Shuttle's own classes (`sh-*`, `ProseMirror`) — the editor is a separate
  package with its own internals.
- Element structure or nesting outside note content — markup is rearranged
  freely as long as the public classes stay on the same surfaces.
- `data-*` attributes other than `data-theme` and `data-scheme`.

The augment loader (not built yet) will enforce these: rules whose selectors
reach outside this API are dropped, `@import` is stripped, and the content
security policy blocks remote `url()` loads, so fonts and images must ship
beside the CSS file.

## Stability

Class and token names are a versioned API. A rename or removal is first marked
deprecated here for at least one minor release, with the replacement named,
before the old name goes.

## Tokens

### Colour

Redefined by every built-in theme, per scheme.

| Token | Used for |
|---|---|
| `--bg` | App background, editor surface |
| `--bg-sidebar` | Vault sidebar |
| `--bg-panel` | Note list, cards, menus |
| `--bg-hover` | Hovered rows and controls |
| `--bg-active` | Selected rows, pressed controls |
| `--bg-input` | Text fields, the command palette dropdown |
| `--bg-elevated` | Raised surfaces above a panel |
| `--border` | Default dividers and outlines |
| `--border-strong` | Emphasised outlines, scrollbar thumb |
| `--border-muted` | Hairlines, popup edges |
| `--text-primary` | Body text |
| `--text-secondary` | Supporting text |
| `--text-muted` | Hints, timestamps, placeholders |
| `--accent` | Primary accent |
| `--accent-hover` | Accent in hover state |
| `--accent-fg` | Text on an accent background |
| `--link-color` | Wiki links and links |
| `--link-underline` | Link underline |
| `--danger` | Destructive actions and errors |
| `--danger-hover-bg` | Background of a hovered destructive control |
| `--danger-border` | Outline of error messages |
| `--close-hover-bg` | Window close button, hovered |
| `--close-hover-fg` | Window close icon, hovered |

### Dither

The generated textures on the lock screen and other large empty surfaces are
drawn on a canvas, so CSS cannot reach their pixels; these tokens are what the
canvas reads. They default to the text and accent colours, so every theme gets
matching dither without defining them.

| Token | Used for |
|---|---|
| `--dither-ink` | Mid-tone marks |
| `--dither-ink-strong` | Dense, bright marks — cloud tops, the thick of a field |
| `--dither-accent` | Occasional patches of accent colour |

### Type

| Token | Value |
|---|---|
| `--font-ui` | System UI stack |
| `--font-mono` | JetBrains Mono, Fira Code, Cascadia Code |
| `--text-2xs` | 10px |
| `--text-xs` | 11px |
| `--text-sm` | 12px |
| `--text-md` | 13px |
| `--text-base` | 14px — body text |
| `--text-lg` | 17px |
| `--text-xl` | 20px |
| `--text-2xl` | 28px — note title |

### Spacing

The suffix is the step in 4px units.

| Token | Value |
|---|---|
| `--space-0-5` | 2px |
| `--space-1` | 4px |
| `--space-1-5` | 6px |
| `--space-2` | 8px |
| `--space-2-5` | 10px |
| `--space-3` | 12px |
| `--space-3-5` | 14px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-7` | 28px |
| `--space-8` | 32px |
| `--space-9` | 36px |
| `--space-10` | 40px |
| `--space-12` | 48px |

### Shape and elevation

| Token | Value |
|---|---|
| `--radius-xs` | 4px |
| `--radius-sm` | 6px |
| `--radius-md` | 8px |
| `--radius` | 10px |
| `--radius-lg` | 14px |
| `--radius-full` | Pills |
| `--shadow-sm` | Thumbs, small raised controls |
| `--shadow-md` | Small popovers |
| `--shadow-lg` | Menus and dropdowns |
| `--shadow-xl` | Floating cards |

Shadows have lighter values under `[data-scheme="light"]`.

### Motion

| Token | Value |
|---|---|
| `--duration-fast` | 0.1s — hovers, small state changes |
| `--duration-base` | 0.15s |
| `--duration-slow` | 0.24s — menus, panels |
| `--ease-out` | Entrances |

All three durations become `0s` when the OS asks for reduced motion. An
augment that lengthens them should keep that behaviour.

### Layout and stacking

| Token | Used for |
|---|---|
| `--sidebar-width` | Collapsed vault sidebar |
| `--note-list-width` | Note list column |
| `--z-raised` | Controls lifted above neighbours |
| `--z-popover` | Small popovers |
| `--z-titlebar` | Title bar |
| `--z-menu` | Menus and the command palette |

### Set by the user's settings

Readable, but an augment should not override these — they carry the user's own
choices from Settings.

| Token | Set from |
|---|---|
| `--editor-font-size` | Settings → Editor → Font size |
| `--editor-line-width` | Settings → Editor → Line width |

These are defined with neutral defaults and overridden only when the user
changes the matching setting, so an augment may set them — its value holds
until the user picks something else.

| Token | Set from |
|---|---|
| `--text-scale` | Settings → Appearance → Interface text size (multiplies every `--text-*`) |
| `--space-scale` | Settings → Appearance → Density (multiplies every `--space-*`) |
| `--radius-scale` | Settings → Appearance → Corner roundness (multiplies the `--radius-*` steps) |
| `--editor-font` | Settings → Editor → Font (defaults to `--font-ui`) |

## Classes

A modifier class (one ending in a double-dash suffix, like
`cord-menu__item--active`) is always added alongside its base class, never
instead of it.

### App shell

| Class | Surface |
|---|---|
| `cord-app` | Root of the window |
| `cord-layout` | Sidebar, note list and main area row |
| `cord-main` | Main area (editor, settings, trash) |

### Title bar

| Class | Surface |
|---|---|
| `cord-titlebar` | The title bar |
| `cord-titlebar__search` | Search / command pill |
| `cord-titlebar__search--open` | Pill while the command palette is open |
| `cord-titlebar__controls` | Window controls |

### Menus

The command palette dropdown, the new-note menu and the editor context menu.

| Class | Surface |
|---|---|
| `cord-menu` | Menu container |
| `cord-menu__section` | Group heading |
| `cord-menu__item` | Item |
| `cord-menu__item--active` | Keyboard-highlighted item |
| `cord-menu__divider` | Separator |

### Vault sidebar

| Class | Surface |
|---|---|
| `cord-sidebar` | The sidebar |
| `cord-sidebar--expanded` | Sidebar while expanded |
| `cord-sidebar__item` | Vault, Trash or Settings entry |
| `cord-sidebar__item--active` | Current vault or view |

### Note list

| Class | Surface |
|---|---|
| `cord-note-list` | The note list column |
| `cord-note-list__header` | Header with vault name and new-note button |
| `cord-note-list__search` | Search field |
| `cord-note-list__item` | A note row |
| `cord-note-list__item--active` | The open note |
| `cord-note-list__item--pinned` | A pinned note |
| `cord-note-list__item--notepad` | A notepad (block page) rather than a note |
| `cord-note-list__item-title` | Row title |
| `cord-note-list__item-meta` | Row date and excerpt line |
| `cord-note-list__item-excerpt` | Row excerpt |

### Editor

| Class | Surface |
|---|---|
| `cord-editor` | The editor column |
| `cord-editor__title` | Note title field |
| `cord-editor__tags` | Tag row under the title |
| `cord-editor__body` | Note content — see rule 3 for styling inside it |
| `cord-editor__status-bar` | Word count and backlinks bar |

### Chips

| Class | Surface |
|---|---|
| `cord-chip` | Any chip |
| `cord-chip--tag` | A tag — in the editor, the note list, or beside a block |
| `cord-chip--backlink` | A note linking here |
| `cord-chip--unlinked` | An unlinked mention |
| `cord-chip--link` | A block's outgoing link, beside the block |

### Dither

| Class | Surface |
|---|---|
| `cord-dither` | A generated dither texture (a canvas). Hide it, fade it or blend it; its colours come from the dither tokens |

### Keyboard shortcuts

| Class | Surface |
|---|---|
| `cord-kbd` | One key of a shortcut, drawn as a keycap (Settings, command palette) |

### Settings, trash, sign-in

| Class | Surface |
|---|---|
| `cord-settings` | Settings page |
| `cord-settings__nav` | Chapter navigation |
| `cord-settings__nav-item` | Chapter link |
| `cord-settings__nav-item--active` | Current chapter |
| `cord-settings__section` | A chapter |
| `cord-settings__section-title` | Chapter heading |
| `cord-settings__field` | One setting |
| `cord-settings__field--modified` | A setting changed from its default |
| `cord-settings__search` | Settings search field |
| `cord-settings__json` | The settings.json editor |
| `cord-trash` | Trash view |
| `cord-trash__item` | A trashed note |
| `cord-login` | Sign-in screen |
| `cord-login__card` | Sign-in card |
| `cord-login__pin` | PIN field |
| `cord-login__user-picker` | User dropdown on the lock screen |
| `cord-login__links` | Row of secondary actions under a lock-screen form |
| `cord-login__recovery-key` | The recovery key shown once during setup |
