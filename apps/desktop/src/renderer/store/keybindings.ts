import { create } from 'zustand';

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
 */

export const IS_MAC =
  typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

const STORAGE_KEY = 'cord-keybindings';

export type KeybindingId =
  // Application
  | 'app.commandBar'
  | 'app.commandBarAlt'
  | 'app.newNote'
  | 'app.newNotepad'
  | 'app.toggleTrash'
  | 'app.settings'
  | 'app.toggleNotesPanel'
  | 'app.prevVault'
  | 'app.nextVault'
  // Editor
  | 'editor.bold'
  | 'editor.italic'
  | 'editor.inlineCode'
  | 'editor.strike'
  | 'editor.heading1'
  | 'editor.heading2'
  | 'editor.heading3'
  | 'editor.bulletList'
  | 'editor.orderedList'
  | 'editor.taskList'
  | 'editor.toggleTask'
  | 'editor.blockquote'
  | 'editor.codeBlock'
  | 'editor.divider'
  // Blocks (notepad only)
  | 'block.moveUp'
  | 'block.moveDown'
  | 'block.duplicate'
  | 'block.delete'
  | 'block.insertRef';

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

export const KEYBINDINGS: readonly KeybindingDef[] = [
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

  // ── Editor ────────────────────────────────────────────────────────────────
  { id: 'editor.bold',        label: 'Bold',            group: 'Editor', scope: 'editor', defaultAccel: 'Mod+B' },
  { id: 'editor.italic',      label: 'Italic',          group: 'Editor', scope: 'editor', defaultAccel: 'Mod+I' },
  { id: 'editor.inlineCode',  label: 'Inline code',     group: 'Editor', scope: 'editor', defaultAccel: 'Mod+E' },
  { id: 'editor.strike',      label: 'Strikethrough',   group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Shift+X' },
  { id: 'editor.heading1',    label: 'Heading 1',       group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Alt+1' },
  { id: 'editor.heading2',    label: 'Heading 2',       group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Alt+2' },
  { id: 'editor.heading3',    label: 'Heading 3',       group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Alt+3' },
  { id: 'editor.bulletList',  label: 'Bullet list',     group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Shift+8' },
  { id: 'editor.orderedList', label: 'Ordered list',    group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Shift+7' },
  { id: 'editor.taskList',    label: 'Task list',       group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Shift+9' },
  {
    id: 'editor.toggleTask', label: 'Check / uncheck task', group: 'Editor', scope: 'editor',
    defaultAccel: 'Mod+Enter', hint: 'Only while the caret is in a task item',
  },
  { id: 'editor.blockquote',  label: 'Blockquote',      group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Shift+B' },
  { id: 'editor.codeBlock',   label: 'Code block',      group: 'Editor', scope: 'editor', defaultAccel: 'Mod+Alt+C' },
  { id: 'editor.divider',     label: 'Insert divider',  group: 'Editor', scope: 'editor', defaultAccel: '' },

  // ── Blocks ────────────────────────────────────────────────────────────────
  { id: 'block.moveUp',    label: 'Move block up',        group: 'Blocks', scope: 'editor', defaultAccel: 'Alt+ArrowUp',        notepadOnly: true },
  { id: 'block.moveDown',  label: 'Move block down',      group: 'Blocks', scope: 'editor', defaultAccel: 'Alt+ArrowDown',      notepadOnly: true },
  { id: 'block.duplicate', label: 'Duplicate block',      group: 'Blocks', scope: 'editor', defaultAccel: 'Mod+Shift+D',        notepadOnly: true },
  { id: 'block.delete',    label: 'Delete block',         group: 'Blocks', scope: 'editor', defaultAccel: 'Mod+Shift+Backspace',notepadOnly: true },
  { id: 'block.insertRef', label: 'Insert block reference',group: 'Blocks',scope: 'editor', defaultAccel: '',                   notepadOnly: true },
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

/** Keys that are only modifiers — pressing one alone never forms a binding. */
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'Dead']);

function normalizeKey(key: string): string | null {
  if (MODIFIER_KEYS.has(key)) return null;
  if (key === ' ') return 'Space';
  // Single characters are stored uppercase so Shift+n and n agree on the key
  // and differ only in the Shift modifier.
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Canonical accelerator for a keyboard event, or null if the event is a bare
 * modifier press (which is never a binding on its own).
 */
export function eventToAccel(e: KeyboardEvent): string | null {
  const key = normalizeKey(e.key);
  if (key === null) return null;

  const parts: string[] = [];
  const primary = IS_MAC ? e.metaKey : e.ctrlKey;
  if (primary) parts.push('Mod');
  // The non-primary modifier still gets its own token so Ctrl on a Mac and the
  // Windows key on a PC remain bindable.
  if (IS_MAC && e.ctrlKey) parts.push('Ctrl');
  if (!IS_MAC && e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const DISPLAY_KEYS: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: '⏎', Backspace: '⌫', Escape: 'Esc', ' ': 'Space',
};

/** Human-readable form of an accelerator, for buttons and hints. */
export function formatAccel(accel: string): string {
  if (!accel) return '';
  const parts = accel.split('+').map((p) => {
    if (p === 'Mod')   return IS_MAC ? '⌘' : 'Ctrl';
    if (p === 'Alt')   return IS_MAC ? '⌥' : 'Alt';
    if (p === 'Shift') return IS_MAC ? '⇧' : 'Shift';
    if (p === 'Ctrl')  return IS_MAC ? '⌃' : 'Ctrl';
    if (p === 'Meta')  return IS_MAC ? '⌘' : 'Win';
    return DISPLAY_KEYS[p] ?? p;
  });
  return IS_MAC ? parts.join('') : parts.join('+');
}

// ── Store ───────────────────────────────────────────────────────────────────

interface KeybindingStore {
  bindings: KeybindingMap;
  /** Merge persisted overrides over the defaults. */
  load: () => void;
  setBinding: (id: KeybindingId, accel: string) => void;
  clearBinding: (id: KeybindingId) => void;
  resetBinding: (id: KeybindingId) => void;
  resetAll: () => void;
}

function persist(bindings: KeybindingMap): void {
  // Only overrides are written, so changing a default later reaches users who
  // never touched that binding.
  const overrides: Record<string, string> = {};
  for (const def of KEYBINDINGS) {
    const current = bindings[def.id];
    if (current !== def.defaultAccel) overrides[def.id] = current;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage blocked or full — bindings simply won't survive a restart.
  }
}

function readOverrides(): Partial<KeybindingMap> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Partial<KeybindingMap> = {};
    for (const [id, accel] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof accel === 'string' && BY_ID.has(id as KeybindingId)) {
        out[id as KeybindingId] = accel;
      }
    }
    return out;
  } catch {
    // Corrupt entry — fall back to defaults rather than breaking every shortcut.
    return {};
  }
}

export const useKeybindingStore = create<KeybindingStore>((set, get) => ({
  bindings: { ...defaultMap(), ...readOverrides() },

  load: () => set({ bindings: { ...defaultMap(), ...readOverrides() } }),

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
  if (!accel) return false;
  return eventToAccel(e) === accel;
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
