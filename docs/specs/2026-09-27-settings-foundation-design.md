# Settings foundation — design

**Date:** 2026-09-27
**Status:** Approved approach (A), awaiting spec review
**Sub-project 1 of 3.** Followed by (2) appearance options and (3) a behaviour
sweep that turns hard-coded behaviour into settings. Both only add schema
entries on top of this foundation. The augment loader comes after and adds its
own settings (enabled augments, order).

## Goal

Every option in Cord is declared once — key, type, default, label,
description — and everything else is derived from that declaration: the
Settings UI, search, validation, defaults, and a hand-editable
`~/.cord/settings.json`. Adding an option becomes one schema entry.

## Decisions

| Question | Decision |
|---|---|
| Storage | `~/.cord/settings.json` and `~/.cord/keybindings.json`, read and written by the sidecar |
| Keybindings | Separate file, overrides only; the existing Keyboard editor stays |
| Raw editing | In-app JSON view, validated against the schema |
| Scope | Global only. Per-vault overrides can later be added as a `"vaults"` section without migration |
| Architecture | Renderer owns schema and store; sidecar only stores file text |
| Comments | Files are JSONC (comments and trailing commas allowed); UI edits preserve them |
| Operation log | Not logged. Settings are per-device preferences, not vault data, and are not synced |

## Architecture

```
schema declarations (renderer modules)
        │ registerSetting()
        ▼
SettingsRegistry ──► useSettings store ──► consumers (useSetting('editor.fontSize'))
                        │   ▲
            jsonc modify │   │ parse + validate
                        ▼   │
              settings text (in memory)
                        │   ▲
       invoke('settings_write') │ invoke('settings_read')
                        ▼   │
           Tauri command (thin forward)
                        ▼   │
         sidecar: SettingsFileService — atomic write / read
                        ▼
              ~/.cord/settings.json
```

### Units

**`renderer/settings/registry.ts` — SettingsRegistry.** Holds declarations.
`registerSetting(def)` validates the declaration (key format, default matches
type and constraints, no duplicate key) and throws on a bad one, so mistakes
fail at startup rather than at use. Built-in settings register from
`renderer/settings/builtin.ts`; modules register their own the same way.
Zustand-backed so the Settings page updates if a module registers late.

**`renderer/settings/schema.ts` — types and validation.** Pure, no React, no
store. Declaration types, `validateValue(def, value)`, `resolveValues(defs,
parsed)` → `{ values, problems }`. Unit-testable in isolation.

**`renderer/settings/store.ts` — useSettings.** Effective values (defaults
merged with valid file values), the current file text, load/save state, and
problems. API:

```ts
useSetting<K extends SettingKey>(key: K): SettingValues[K]
setSetting<K extends SettingKey>(key: K, value: SettingValues[K]): void
resetSetting(key: SettingKey): void
```

Keys are typed through declaration merging: each module that declares settings
also augments `interface SettingValues { 'editor.fontSize': number }`, so a
typo in a key or a wrong value type is a compile error.

**`renderer/components/settings/`** — the generated page's parts (rows,
controls, JSON view, problems banner, custom pages), used by a rewritten
`components/SettingsPage.tsx`.

**Existing stores, adapted.**
- `store/settings.ts` is removed; its consumers (Editor, SettingsPage,
  VaultSidebar, App) switch to `useSetting`. The CSS variables it set
  (`--editor-font-size`, `--editor-line-width`) are set by a subscriber in
  `renderer/settings/builtin.ts`.
- `store/theme.ts` keeps `activeTheme` resolution and applying `data-theme` /
  `data-scheme`, but reads `appearance.theme` and `appearance.colorScheme` from
  the settings store instead of localStorage; `setTheme` / `setColorScheme`
  become `setSetting` calls.
- `store/keybindings.ts` keeps its catalogue, matching and `parseOverrides`;
  only persistence changes, from localStorage to `keybindings.json` through the
  same read/write path. The same syntax-error and write-failure rules apply to
  that file, reported in the same banner.

**`sidecar/services/SettingsFileService.ts`** — reads and writes a named file
(`settings` | `keybindings`) in the config directory. Knows nothing about
individual settings.

## Declarations

```ts
interface SettingDefinitionBase<T> {
  key: string;          // 'section.name', lowercase camelCase segments: 'editor.fontSize'
  title: string;        // 'Font size'
  description: string;  // one sentence, shown under the title and searched
  section: string;      // nav section: 'Editor', 'Appearance', 'Vaults'
  default: T;
  order?: number;       // within the section, lower first
  keywords?: string[];  // extra search terms: ['zoom', 'text size']
}

type SettingDefinition = (
  | (SettingDefinitionBase<boolean> & { type: 'boolean' })
  | (SettingDefinitionBase<number>  & { type: 'number'; min: number; max: number; step: number; unit?: string })
  | (SettingDefinitionBase<string>  & { type: 'string'; maxLength?: number })
  | (SettingDefinitionBase<string>  & { type: 'enum'; options: { value: string; label: string }[] })
) & { control?: ComponentType<SettingControlProps> };  // custom control, e.g. the theme picker
```

The control is derived from the type unless overridden: boolean → toggle,
number → step slider, enum with ≤ 4 options → segmented buttons, larger enum →
select, string → text field. `appearance.theme` uses a custom control (the
existing theme card grid) whose options come from the ThemeRegistry.

### Settings moved in by this project

| Key | Type | Default | Was |
|---|---|---|---|
| `editor.fontSize` | number 12–20, step 1, px | 15 | `cord-font-size` |
| `editor.lineWidth` | number 480–1200, step 40, px | 720 | `cord-line-width` |
| `editor.spellCheck` | boolean | false | `cord-spell-check` |
| `editor.unlinkedMentions` | boolean | true | `cord-unlinked-mentions` |
| `vaults.distinctColors` | boolean | false | `cord-distinct-vault-colors` |
| `appearance.theme` | string (theme id) | `mono` | `cord-theme` |
| `appearance.colorScheme` | enum dark / light / system | `dark` | `cord-scheme` |

`appearance.theme` is a `string`, not an `enum`, because augment themes
register after startup; it is validated as a theme-id slug and resolved through
`resolveThemeId`, preserving the saved-preference behaviour from the theme
registry.

**Not settings:** vault order (`cord-vault-order`) is UI state, not a
preference, and stays in localStorage. Vault name/colour and tag management are
data, not preferences, and become custom Settings pages (below).

## The files

`settings.json` holds **only values that differ from their default**, so
changing a default later reaches everyone who never touched it:

```jsonc
{
  // Larger text for the laptop
  "editor.fontSize": 17,
  "appearance.theme": "midnight"
}
```

`keybindings.json` holds overrides in the existing format:
`{ "app.newNote": "Mod+Shift+N" }`. The keybinding store's `parseOverrides`
already drops unknown ids and non-strings; it now reads from the file text
instead of localStorage.

Unknown keys (from a newer Cord, or an augment that is not loaded) are kept in
the file untouched and reported as warnings, never deleted.

## Data flow

**Startup.**
1. Synchronously in `main.tsx`, before React renders: read the boot cache
   (localStorage key `cord-settings-cache`, the last effective overrides) and
   apply it, so the theme and editor size are right in the first frame.
   Keybindings are not cached: defaults apply for the few milliseconds until
   `keybindings.json` loads, and no shortcut is used before first paint.
2. Asynchronously: `settings_read` for both files via the sidecar.
   Parse, validate, replace the in-memory values, refresh the boot cache.
3. If a file does not exist, run the one-time migration (below), then continue.

The boot cache is never the source of truth — only the file is. A stale cache
costs at most one frame of old values.

**Changing a setting from the UI.** `setSetting` applies the value in memory
immediately, then edits the in-memory file text with `jsonc-parser`'s
`modify` + `applyEdits` (setting a value equal to its default removes the key).
Writes are debounced 300 ms (sliders fire continuously) and serialised: at most
one in flight, the latest text wins.

**Editing the file outside Cord.** No filesystem watcher (M5 is hibernated). On
window focus, and when the Settings page opens, the store flushes any pending
write, then re-reads both files.

**JSON view.** Shows the full file text in a monospace editor. Validation runs
on every change (debounced): syntax errors with line and column, type and
range errors per key, unknown keys as warnings. Save with `Mod+S` or the Save
button; **syntax errors block saving**, value errors and unknown keys do not
(the invalid value simply falls back to its default and stays reported).
Revert discards unsaved edits.

## Settings page

- **Nav:** schema sections in a fixed order (Editor, Appearance, Vaults, then
  module sections alphabetically), followed by custom pages registered on the
  UI registry's `settings` surface: Keyboard, Vault (name/colour), Tags. This
  puts the registry to real use — the page stops hard-coding chapters.
- **Search** at the top filters as you type across title, description, key and
  keywords; matching rows keep their section headings. `@modified` shows only
  changed settings, and can be combined with text. Custom pages match by label.
- **Row:** title, description, control. A changed setting shows a modified
  marker and a reset button; the key is shown on hover and copyable.
- **Header:** "Edit as JSON" toggles the JSON view of `settings.json`.
- **Problems banner** at the top when the file has errors or unknown keys, with
  a link to the JSON view.

Public classes added (and documented in `docs/theming/public-api.md`):
`cord-settings__search`, `cord-settings__field--modified`,
`cord-settings__json`.

## Migration (one-time)

When `settings.json` does not exist:
1. Read the old localStorage keys listed in the table above.
2. Keep only valid, non-default values.
3. Write them as the new file. If the write fails, keep using the old values in
   memory and retry next launch; never delete the old keys before a successful
   write.
4. After a successful write, remove the old keys.

Same for `keybindings.json` from `cord-keybindings`. An existing file is never
overwritten by migration.

## Sidecar and IPC

Commands (thin, following the existing snake_case command names such as
`notes_search`):

| Command | Payload | Returns |
|---|---|---|
| `settings_read` | `{ file: 'settings' \| 'keybindings' }` | `{ text: string \| null }` — `null` if the file does not exist |
| `settings_write` | `{ file, text }` | `{ ok: true }` |

`SettingsFileService`:
- Config directory = the directory of `resolveDbPath()` (`~/.cord`), overridable
  by `CORD_CONFIG_DIR` for tests. Created if missing.
- Only the two known file names; anything else is rejected.
- Writes are atomic: write `<name>.json.tmp`, then rename over the target.
- Rejects text over 1 MB. It does not parse the text — validation is the
  renderer's job — so a hand-edited file with comments round-trips exactly.

## Error handling

| Situation | Behaviour |
|---|---|
| File has a syntax error | Keep the last good values in memory; problems banner; the file is not overwritten by UI changes until it parses again (UI edits are held in memory and a banner says they are not saved) |
| A value fails validation | That key uses its default; reported in problems; file left as-is |
| Unknown key | Kept in the file; reported as a warning |
| Sidecar unreachable at startup | Boot cache values; retry the read on the next focus |
| Write fails | Value stays applied in memory; banner "Couldn't save settings"; retried with the next write or focus |
| Invalid declaration from a module | `registerSetting` throws at startup |

## Testing

- `schema.ts`: validation per type, range, enum; `resolveValues` with valid,
  invalid, missing and unknown keys.
- Registry: rejects bad keys, duplicates, defaults that fail their own type.
- Store: set → text edit preserves comments and other keys; set to default
  removes the key; debounced writes coalesce; syntax-error file blocks writes.
- Migration: old keys → file with only non-default values; existing file never
  overwritten; old keys removed only after a successful write.
- Sidecar service: read of a missing file returns `null`; atomic write; unknown
  file names and oversized text rejected (using a temp `CORD_CONFIG_DIR`).
- Search filter: text, `@modified`, both combined.
- IPC parity test already covers new commands; `publicApi.test.ts` covers the
  new classes.

## Out of scope

- New options (sub-projects 2 and 3).
- Per-vault overrides.
- Opening the files in an external editor.
- Syncing settings to the cloud.
- A filesystem watcher.

## New dependency

`jsonc-parser` (MIT, Microsoft, used by VS Code): comment-preserving edits and
JSONC parsing with error positions. Renderer only.
