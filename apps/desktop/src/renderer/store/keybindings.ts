import { create } from 'zustand';
import {
  SHUTTLE_KEYBINDINGS,
  eventToAccel as shuttleEventToAccel,
  eventToAccels,
  formatAccel as shuttleFormatAccel,
  type KeybindingId as ShuttleKeybindingId,
} from 'shuttle-editor';
import { ConfigFileWriter } from '../settings/configFile';
import { ipcConfigIO } from '../settings/ipcConfigIO';
import { parseJsoncObject, setKeyInText } from '../settings/jsonText';
import { LEGACY_KEYBINDINGS_KEY } from '../settings/migration';

/**
 * Every keyboard shortcut in the app, in one place, editable from Settings.
 *
 * Shortcuts used to be spelled out at each call site — a string comparison in
 * NotesPage, another in NoteList, a Tiptap keymap in extensions.ts. Nothing
 * could enumerate them, so nothing could rebind them. This module owns the
 * catalogue; call sites ask it whether an event matches an action.
 *
 * Accelerators are stored as canonical strings: modifiers in a fixed order,
 * joined with '+', e.g. `Mod+Shift+D`. `Mod` is the platform's primary
 * modifier — Cmd on macOS, Ctrl everywhere else — so a binding means the same
 * thing on both without storing two of them.
 *
 * The editor's shortcuts belong to Shuttle: their ids, labels and defaults come
 * from `SHUTTLE_KEYBINDINGS`, and the user's overrides go back to it through
 * the host. Cord adds only its application shortcuts.
 */

export const IS_MAC =
  typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

type AppKeybindingId =
  | 'app.commandBar'
  | 'app.commandBarAlt'
  | 'app.newNote'
  | 'app.newNotepad'
  | 'app.toggleTrash'
  | 'app.settings'
  | 'app.toggleNotesPanel'
  | 'app.prevVault'
  | 'app.nextVault';

export type KeybindingId = AppKeybindingId | ShuttleKeybindingId;

export type KeybindingGroup = 'Application' | 'Editor' | 'Blocks';

export interface KeybindingDef {
  id: KeybindingId;
  label: string;
  group: KeybindingGroup;
  /**
   * `'global'` bindings are matched against a window listener and work
   * anywhere; `'editor'` bindings are matched inside ProseMirror, so they can
   * take precedence over Tiptap's own keymaps.
   */
  scope: 'global' | 'editor';
  /** Empty string means "no default binding". */
  defaultAccel: string;
  /** Editor actions that only mean something in a notepad. */
  notepadOnly?: boolean;
  hint?: string;
}

const APP_KEYBINDINGS: readonly KeybindingDef[] = [
  // ── Application ───────────────────────────────────────────────────────────
  {
    id: 'app.commandBar', label: 'Open command bar', group: 'Application',
    scope: 'global',
    // Cmd+Tab is the macOS app switcher and never reaches the webview.
    defaultAccel: IS_MAC ? 'Mod+K' : 'Mod+Tab',
  },
  { id: 'app.commandBarAlt', label: 'Open command bar (alternate)', group: 'Application', scope: 'global', defaultAccel: 'F1' },
  { id: 'app.newNote',    label: 'New note',            group: 'Application', scope: 'global', defaultAccel: 'Mod+N' },
  { id: 'app.newNotepad', label: 'New notepad',         group: 'Application', scope: 'global', defaultAccel: '' },
  { id: 'app.toggleTrash',label: 'Toggle trash',        group: 'Application', scope: 'global', defaultAccel: 'Mod+T' },
  { id: 'app.settings',   label: 'Open settings',       group: 'Application', scope: 'global', defaultAccel: 'Mod+,' },
  { id: 'app.toggleNotesPanel', label: 'Toggle notes panel', group: 'Application', scope: 'global', defaultAccel: 'Mod+\\' },
  { id: 'app.prevVault',  label: 'Previous vault',      group: 'Application', scope: 'global', defaultAccel: 'Mod+ArrowUp' },
  { id: 'app.nextVault',  label: 'Next vault',          group: 'Application', scope: 'global', defaultAccel: 'Mod+ArrowDown' },
];

export const KEYBINDINGS: readonly KeybindingDef[] = [
  ...APP_KEYBINDINGS,
  ...SHUTTLE_KEYBINDINGS.map((d): KeybindingDef => ({
    id: d.id,
    label: d.label,
    group: d.group,
    scope: 'editor',
    defaultAccel: d.defaultAccel,
    ...(d.notepadOnly ? { notepadOnly: true } : {}),
    ...(d.hint ? { hint: d.hint } : {}),
  })),
];

export const KEYBINDING_GROUPS: readonly KeybindingGroup[] = ['Application', 'Editor', 'Blocks'];

const BY_ID = new Map<KeybindingId, KeybindingDef>(KEYBINDINGS.map((k) => [k.id, k]));

export function keybindingDef(id: KeybindingId): KeybindingDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown keybinding: ${id}`);
  return def;
}

export type KeybindingMap = Record<KeybindingId, string>;

function defaultMap(): KeybindingMap {
  const out = {} as KeybindingMap;
  for (const def of KEYBINDINGS) out[def.id] = def.defaultAccel;
  return out;
}

// ── Accelerator encoding ────────────────────────────────────────────────────

/**
 * Canonical accelerator for a keyboard event, or null for a bare modifier
 * press. Shuttle's encoding, so a recorded shortcut matches its catalogue —
 * including the physical-key fallback (Ctrl+Shift+8 records as `Mod+Shift+8`
 * even though the key typed `*`).
 */
export function eventToAccel(e: KeyboardEvent): string | null {
  return shuttleEventToAccel(e, IS_MAC);
}

/** Human-readable form of an accelerator, for buttons and hints. */
export function formatAccel(accel: string): string {
  return shuttleFormatAccel(accel, IS_MAC);
}

// ── Store ───────────────────────────────────────────────────────────────────

interface KeybindingStore {
  bindings: KeybindingMap;
  /** Why keybindings.json could not be used, or null. Writes are held while set. */
  fileError: string | null;
  /** Merge the overrides in keybindings.json over the defaults. */
  load: () => Promise<void>;
  /** Write anything pending, then read the file again. */
  reload: () => Promise<void>;
  setBinding: (id: KeybindingId, accel: string) => void;
  clearBinding: (id: KeybindingId) => void;
  resetBinding: (id: KeybindingId) => void;
  resetAll: () => void;
}

const writer = new ConfigFileWriter('keybindings', ipcConfigIO);
/** keybindings.json as last read or written; edits are applied to this text. */
let fileText = '';

/** Overrides from parsed file data. Unknown ids and non-strings are dropped. */
function overridesFrom(data: Record<string, unknown>): Partial<KeybindingMap> {
  const out: Partial<KeybindingMap> = {};
  for (const [id, accel] of Object.entries(data)) {
    if (typeof accel === 'string' && BY_ID.has(id as KeybindingId)) out[id as KeybindingId] = accel;
  }
  return out;
}

/**
 * Overrides from stored text. Anything unparseable yields none, so a corrupt
 * or outdated entry never breaks the shortcuts that are still valid.
 */
export function parseOverrides(raw: string | null): Partial<KeybindingMap> {
  if (!raw) return {};
  const { data } = parseJsoncObject(raw);
  return data ? overridesFrom(data) : {};
}

function persist(bindings: KeybindingMap): void {
  // Never overwrite a file the user broke; Settings shows the error.
  if (useKeybindingStore.getState().fileError) return;
  // Only overrides are written, so changing a default later reaches users who
  // never touched that binding. Each key is edited in place, so comments and
  // ids this version does not know survive.
  let text = fileText;
  for (const def of KEYBINDINGS) {
    const current = bindings[def.id];
    text = setKeyInText(text, def.id, current !== def.defaultAccel ? current : undefined);
  }
  fileText = text;
  writer.schedule(text);
}

/** Write any pending keybinding change now. */
export function flushKeybindings(): Promise<void> {
  return writer.flush();
}

function legacyOverrides(): Partial<KeybindingMap> {
  try {
    return parseOverrides(localStorage.getItem(LEGACY_KEYBINDINGS_KEY));
  } catch {
    return {};
  }
}

export const useKeybindingStore = create<KeybindingStore>((set, get) => ({
  bindings: defaultMap(),
  fileError: null,

  load: async () => {
    let text: string | null;
    try {
      text = await ipcConfigIO.read('keybindings');
    } catch (err) {
      set({ fileError: `Couldn't read keybindings.json (${err instanceof Error ? err.message : String(err)}). Shortcut changes are not saved until it can be read.` });
      return;
    }
    if (text === null) {
      const legacy = legacyOverrides();
      text = Object.entries(legacy).reduce((t, [id, accel]) => setKeyInText(t, id, accel), '');
      if (Object.keys(legacy).length > 0) {
        try {
          await ipcConfigIO.write('keybindings', text);
          localStorage.removeItem(LEGACY_KEYBINDINGS_KEY);
        } catch {
          // Keep the legacy key; the move is retried next launch.
        }
      }
    }
    fileText = text;
    const parsed = parseJsoncObject(text);
    if (!parsed.data) {
      set({ fileError: `keybindings.json: ${parsed.problems.map((p) => p.message).join('; ')}. Shortcut changes are not saved until it is fixed.` });
      return;
    }
    set({ bindings: { ...defaultMap(), ...overridesFrom(parsed.data) }, fileError: null });
  },

  reload: async () => {
    await writer.flush();
    await get().load();
  },

  setBinding: (id, accel) => {
    const next: KeybindingMap = { ...get().bindings, [id]: accel };
    persist(next);
    set({ bindings: next });
  },

  clearBinding: (id) => {
    const next: KeybindingMap = { ...get().bindings, [id]: '' };
    persist(next);
    set({ bindings: next });
  },

  resetBinding: (id) => {
    const next: KeybindingMap = { ...get().bindings, [id]: keybindingDef(id).defaultAccel };
    persist(next);
    set({ bindings: next });
  },

  resetAll: () => {
    const next = defaultMap();
    persist(next);
    set({ bindings: next });
  },
}));

// ── Matching helpers (usable outside React) ─────────────────────────────────

/** Current accelerator for an action. */
export function currentAccel(id: KeybindingId): string {
  return useKeybindingStore.getState().bindings[id];
}

/** True when `e` is the key combination currently bound to `id`. */
export function matchesBinding(e: KeyboardEvent, id: KeybindingId): boolean {
  const accel = currentAccel(id);
  return !!accel && eventToAccels(e, IS_MAC).includes(accel);
}

/** The editor's current bindings, for `ShuttleHost.keybindings`. */
export function shuttleOverrides(bindings: KeybindingMap): Partial<Record<ShuttleKeybindingId, string>> {
  const out: Partial<Record<ShuttleKeybindingId, string>> = {};
  for (const def of SHUTTLE_KEYBINDINGS) out[def.id] = bindings[def.id];
  return out;
}

/**
 * Action ids sharing a binding with `id`. Conflicts are surfaced rather than
 * prevented — two actions in different scopes can legitimately share a chord.
 */
export function conflictsFor(bindings: KeybindingMap, id: KeybindingId): KeybindingId[] {
  const accel = bindings[id];
  if (!accel) return [];
  return KEYBINDINGS
    .filter((d) => d.id !== id && bindings[d.id] === accel)
    .map((d) => d.id);
}
