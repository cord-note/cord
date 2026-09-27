import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { SHUTTLE_KEYBINDINGS } from 'shuttle-editor';
import {
  KEYBINDINGS,
  conflictsFor,
  eventToAccel,
  accelKeys,
  formatAccel,
  matchesBinding,
  flushKeybindings,
  parseOverrides,
  shuttleOverrides,
  useKeybindingStore,
  IS_MAC,
  type KeybindingId,
  type KeybindingMap,
} from '../keybindings';

const disk: { text: string | null; writes: string[] } = { text: null, writes: [] };
mock.module('@renderer/ipc', () => ({
  api: {
    settings: {
      read: async () => ({ text: disk.text }),
      write: async (_file: string, text: string) => { disk.text = text; disk.writes.push(text); return { ok: true }; },
    },
  },
}));

// The accel encoding is the contract between the settings recorder and every
// place that matches a key event. If the two ever disagree about how a chord
// is spelled, shortcuts silently stop firing with nothing to show in the UI.

interface FakeKeyInit {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Minimal stand-in — eventToAccel only reads these six fields. */
function keyEvent(init: FakeKeyInit): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? '',
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  } as KeyboardEvent;
}

/** The primary modifier, whichever one this platform uses. */
const primary = IS_MAC ? { metaKey: true } : { ctrlKey: true };

describe('eventToAccel', () => {
  it('returns null for a bare modifier press', () => {
    expect(eventToAccel(keyEvent({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(eventToAccel(keyEvent({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(eventToAccel(keyEvent({ key: 'Meta', metaKey: true }))).toBeNull();
  });

  it('encodes the primary modifier as Mod', () => {
    expect(eventToAccel(keyEvent({ key: 'n', ...primary }))).toBe('Mod+N');
  });

  it('uppercases letters so case never splits a binding in two', () => {
    expect(eventToAccel(keyEvent({ key: 'n' }))).toBe('N');
    expect(eventToAccel(keyEvent({ key: 'N', shiftKey: true }))).toBe('Shift+N');
  });

  it('orders modifiers consistently regardless of press order', () => {
    const accel = eventToAccel(keyEvent({ key: 'd', altKey: true, shiftKey: true, ...primary }));
    expect(accel).toBe('Mod+Alt+Shift+D');
  });

  it('keeps named keys verbatim', () => {
    expect(eventToAccel(keyEvent({ key: 'ArrowUp', altKey: true }))).toBe('Alt+ArrowUp');
    expect(eventToAccel(keyEvent({ key: 'F1' }))).toBe('F1');
    expect(eventToAccel(keyEvent({ key: 'Backspace', shiftKey: true, ...primary })))
      .toBe('Mod+Shift+Backspace');
  });

  it('round-trips every default binding it can produce', () => {
    // A default nobody can type is a default nobody can reset to.
    for (const def of KEYBINDINGS) {
      if (!def.defaultAccel) continue;
      const parts = def.defaultAccel.split('+');
      const key = parts[parts.length - 1]!;
      const accel = eventToAccel(keyEvent({
        key,
        ...(parts.includes('Mod') ? primary : {}),
        altKey: parts.includes('Alt'),
        shiftKey: parts.includes('Shift'),
      }));
      expect(accel).toBe(def.defaultAccel);
    }
  });
});

describe('formatAccel', () => {
  it('is empty for an unbound action', () => {
    expect(formatAccel('')).toBe('');
  });

  it('spells out arrows and modifiers', () => {
    const shown = formatAccel('Alt+ArrowUp');
    expect(shown).toContain('↑');
    expect(shown).toContain(IS_MAC ? '⌥' : 'Alt');
  });
});

describe('accelKeys', () => {
  // Each key is drawn as its own keycap, so the chord must split into keys
  // exactly as formatAccel spells them — including a literal "+" key.
  it('splits a chord into display keys', () => {
    expect(accelKeys('Mod+Shift+X')).toEqual(IS_MAC ? ['⌘', '⇧', 'X'] : ['Ctrl', 'Shift', 'X']);
    expect(accelKeys('Alt+ArrowUp')).toEqual([IS_MAC ? '⌥' : 'Alt', '↑']);
  });

  it('keeps a literal plus key', () => {
    expect(accelKeys('Mod++')).toEqual([IS_MAC ? '⌘' : 'Ctrl', '+']);
  });

  it('is empty for an unbound action', () => {
    expect(accelKeys('')).toEqual([]);
  });
});

describe('conflictsFor', () => {
  function mapWith(overrides: Partial<KeybindingMap>): KeybindingMap {
    const out = {} as KeybindingMap;
    for (const def of KEYBINDINGS) out[def.id] = def.defaultAccel;
    return { ...out, ...overrides };
  }

  it('reports nothing when the defaults are untouched', () => {
    const bindings = mapWith({});
    for (const def of KEYBINDINGS) {
      if (!def.defaultAccel) continue;
      expect(conflictsFor(bindings, def.id)).toEqual([]);
    }
  });

  it('reports both sides of a collision', () => {
    const bindings = mapWith({ 'app.newNote': 'Mod+T' });
    expect(conflictsFor(bindings, 'app.newNote')).toEqual(['app.toggleTrash']);
    expect(conflictsFor(bindings, 'app.toggleTrash')).toEqual(['app.newNote']);
  });

  it('does not treat two unbound actions as conflicting', () => {
    const bindings = mapWith({});
    const unbound = KEYBINDINGS.filter((d) => !bindings[d.id]).map((d) => d.id as KeybindingId);
    expect(unbound.length).toBeGreaterThan(1);
    for (const id of unbound) expect(conflictsFor(bindings, id)).toEqual([]);
  });
});

describe('catalogue', () => {
  it('takes every editor shortcut from Shuttle, with its defaults', () => {
    for (const d of SHUTTLE_KEYBINDINGS) {
      const def = KEYBINDINGS.find((k) => k.id === d.id);
      expect(def).toMatchObject({ scope: 'editor', defaultAccel: d.defaultAccel, label: d.label, group: d.group });
    }
    for (const id of ['editor.underline', 'editor.highlight', 'editor.find']) {
      expect(KEYBINDINGS.some((k) => k.id === id)).toBe(true);
    }
  });

  it('keeps the application shortcuts as global ones', () => {
    const app = KEYBINDINGS.filter((k) => k.id.startsWith('app.'));
    expect(app.length).toBeGreaterThan(0);
    expect(app.every((k) => k.scope === 'global')).toBe(true);
  });

  it('hands Shuttle only its own ids', () => {
    const passed = shuttleOverrides(useKeybindingStore.getState().bindings);
    expect(Object.keys(passed).sort()).toEqual(SHUTTLE_KEYBINDINGS.map((d) => d.id).sort());
  });

  it('drops persisted overrides for ids that no longer exist', () => {
    expect(parseOverrides(JSON.stringify({ 'editor.bold': 'Mod+J', 'editor.gone': 'Mod+Q', 'app.newNote': 7 })))
      .toEqual({ 'editor.bold': 'Mod+J' });
    expect(parseOverrides('{not json')).toEqual({});
    expect(parseOverrides(null)).toEqual({});
  });
});

describe('physical-key fallback', () => {
  // Ctrl+Shift+8 types '*', which would never match the Mod+Shift+8 default.
  const star = keyEvent({ key: '*', code: 'Digit8', shiftKey: true, ...primary });

  it('records Shift+digit shortcuts by the digit key', () => {
    expect(eventToAccel(star)).toBe('Mod+Shift+8');
  });

  it('matches them against the catalogue', () => {
    expect(matchesBinding(star, 'editor.bulletList')).toBe(true);
  });
});

describe('keybindings.json', () => {
  // Earlier tests leave debounced writes pending; land them before resetting
  // the fake disk so they cannot leak into these assertions.
  beforeEach(async () => { await flushKeybindings(); disk.text = null; disk.writes = []; });

  it('loads overrides from the file, comments allowed', async () => {
    disk.text = '{\n  // mine\n  "app.newNote": "Mod+J",\n}';
    await useKeybindingStore.getState().load();
    expect(useKeybindingStore.getState().bindings['app.newNote']).toBe('Mod+J');
  });

  it('edits the file in place, keeping comments and unknown keys', async () => {
    disk.text = '{\n  // mine\n  "app.newNote": "Mod+J",\n  "future.action": "Mod+Q"\n}';
    await useKeybindingStore.getState().load();
    useKeybindingStore.getState().setBinding('app.settings', 'Mod+Shift+K');
    await flushKeybindings();
    expect(disk.text).toContain('// mine');
    expect(disk.text).toContain('"future.action": "Mod+Q"');
    expect(disk.text).toContain('"app.settings": "Mod+Shift+K"');
  });

  it('never overwrites a file that does not parse', async () => {
    disk.text = '{ "app.newNote": ';
    await useKeybindingStore.getState().load();
    expect(useKeybindingStore.getState().fileError).toMatch(/line 1/);
    useKeybindingStore.getState().setBinding('app.settings', 'Mod+Shift+K');
    await flushKeybindings();
    expect(disk.writes).toEqual([]);
  });
});
