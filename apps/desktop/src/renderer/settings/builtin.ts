import { FontSizeControl } from '../components/settings/FontSizeControl';
import { ThemePickerControl } from '../components/settings/ThemePickerControl';
import { log } from '../lib/log';
import { useVaultStore } from '../store/vaults';
import { registerSetting, useSettings } from './index';
import { appearanceVars } from './derived';
import type { Density, FontChoice, HoldSpeed, ListDateFormat, Roundness } from './derived';
import type { SettingValues } from './schema';

declare module './schema' {
  interface SettingValues {
    'editor.fontSize': number;
    'editor.lineWidth': number;
    'editor.spellCheck': boolean;
    'editor.unlinkedMentions': boolean;
    'vaults.distinctColors': boolean;
    'appearance.theme': string;
    'appearance.colorScheme': 'dark' | 'light' | 'system';
    'appearance.textScale': number;
    'appearance.density': Density;
    'appearance.roundness': Roundness;
    'appearance.uiFont': FontChoice;
    'editor.fontFamily': FontChoice;
    'editor.autosaveDelay': number;
    'notes.defaultKind': 'note' | 'notepad';
    'notes.listDateFormat': ListDateFormat;
    'general.holdToConfirm': HoldSpeed;
    'security.idleLockMinutes': number;
    'security.autoUnlock': boolean;
  }
}

registerSetting({
  key: 'editor.fontSize', type: 'number', section: 'Editor', order: 10,
  title: 'Font size', description: 'Text size in the editor.',
  default: 15, min: 12, max: 20, step: 1, unit: 'px', keywords: ['zoom', 'text size'],
  control: FontSizeControl,
});

registerSetting({
  key: 'editor.lineWidth', type: 'number', section: 'Editor', order: 20,
  title: 'Line width', description: 'Maximum width of a line of text in the editor.',
  default: 720, min: 480, max: 1200, step: 40, notchStep: 120, unit: 'px', keywords: ['margin', 'column'],
});

registerSetting({
  key: 'editor.spellCheck', type: 'boolean', section: 'Editor', order: 30,
  title: 'Spell check', description: 'Underline misspelled words. Takes effect after a restart.',
  default: false,
});

registerSetting({
  key: 'editor.unlinkedMentions', type: 'boolean', section: 'Editor', order: 40,
  title: 'Unlinked mentions', description: 'Show notes that mention this note’s title without linking to it.',
  default: true, keywords: ['backlinks'],
});

registerSetting({
  key: 'appearance.colorScheme', type: 'enum', section: 'Appearance', order: 10,
  title: 'Color mode', description: 'Dark, light, or follow the system setting.',
  default: 'dark',
  options: [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ],
  keywords: ['dark mode', 'light mode', 'scheme'],
});

registerSetting({
  key: 'appearance.theme', type: 'string', section: 'Appearance', order: 20,
  title: 'Theme', description: 'Colour palette for the whole app.',
  default: 'mono', pattern: /^[a-z0-9][a-z0-9-]{0,63}$/, maxLength: 64, keywords: ['colors', 'palette'],
  control: ThemePickerControl,
});

registerSetting({
  key: 'vaults.distinctColors', type: 'boolean', section: 'Vaults', order: 10,
  title: 'Use distinct vault colors',
  description: 'Limit the palette to a curated set of high-contrast hues, and repaint existing vaults with their nearest match.',
  default: false,
  // Turning it on is not just a filter on the picker — it repaints the vaults
  // you already have. A rail where half the dots come from the curated set and
  // half don't defeats the point of the setting.
  onUserChange: (on) => {
    if (!on) return;
    useVaultStore.getState().applyDistinctColors().catch((err: unknown) => {
      log('error', 'settings', 'Failed to remap vault colors', err);
    });
  },
});

const FONT_OPTIONS = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
] as const;

registerSetting({
  key: 'editor.fontFamily', type: 'enum', section: 'Editor', order: 15,
  title: 'Font', description: 'Typeface for note text. Code blocks stay monospace.',
  default: 'sans', options: FONT_OPTIONS, keywords: ['typeface', 'serif', 'monospace'],
});

registerSetting({
  key: 'editor.autosaveDelay', type: 'number', section: 'Editor', order: 50,
  title: 'Autosave delay', description: 'How long to wait after you stop typing before saving.',
  default: 750, min: 250, max: 3000, step: 250, notchStep: 250, unit: 'ms', keywords: ['save', 'debounce'],
});

registerSetting({
  key: 'appearance.textScale', type: 'number', section: 'Appearance', order: 30,
  title: 'Interface text size', description: 'Scales text across the app. The editor has its own font size.',
  default: 100, min: 90, max: 125, step: 5, unit: '%', keywords: ['zoom', 'font size', 'ui scale'],
});

registerSetting({
  key: 'appearance.uiFont', type: 'enum', section: 'Appearance', order: 35,
  title: 'Interface font', description: 'Typeface for menus, lists and settings.',
  default: 'sans', options: FONT_OPTIONS, keywords: ['typeface'],
});

registerSetting({
  key: 'appearance.density', type: 'enum', section: 'Appearance', order: 40,
  title: 'Density', description: 'How much space surrounds lists, panels and controls.',
  default: 'comfortable',
  options: [
    { value: 'compact', label: 'Compact' },
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'spacious', label: 'Spacious' },
  ],
  keywords: ['spacing', 'padding', 'compact'],
});

registerSetting({
  key: 'appearance.roundness', type: 'enum', section: 'Appearance', order: 50,
  title: 'Corner roundness', description: 'How rounded buttons, cards and menus are.',
  default: 'standard',
  options: [
    { value: 'sharp', label: 'Sharp' },
    { value: 'subtle', label: 'Subtle' },
    { value: 'standard', label: 'Standard' },
    { value: 'round', label: 'Round' },
  ],
  keywords: ['radius', 'corners'],
});

registerSetting({
  key: 'notes.defaultKind', type: 'enum', section: 'Notes', order: 10,
  title: 'New note kind', description: 'What the New note button and its shortcut create.',
  default: 'note',
  options: [
    { value: 'note', label: 'Note' },
    { value: 'notepad', label: 'Notepad' },
  ],
  keywords: ['default', 'notepad', 'blocks'],
});

registerSetting({
  key: 'notes.listDateFormat', type: 'enum', section: 'Notes', order: 20,
  title: 'Dates in the note list',
  description: 'Relative shows a time today and a weekday this week; absolute always shows the full date.',
  default: 'relative',
  options: [
    { value: 'relative', label: 'Relative' },
    { value: 'absolute', label: 'Absolute' },
    { value: 'hidden', label: 'Hidden' },
  ],
  keywords: ['timestamp', 'modified'],
});

registerSetting({
  key: 'general.holdToConfirm', type: 'enum', section: 'General', order: 10,
  title: 'Hold to confirm', description: 'How long to hold delete and archive buttons before they act.',
  default: 'normal',
  options: [
    { value: 'quick', label: 'Quick' },
    { value: 'normal', label: 'Normal' },
    { value: 'deliberate', label: 'Deliberate' },
  ],
  keywords: ['delete', 'archive', 'hold'],
});

registerSetting({
  key: 'security.idleLockMinutes', type: 'number', section: 'Security', order: 10,
  title: 'Lock when idle',
  description: 'Return to the PIN screen after this many minutes without keyboard or mouse input. 0 turns it off.',
  default: 0, min: 0, max: 120, step: 5, unit: 'min', keywords: ['pin', 'lock', 'timeout', 'away'],
});

registerSetting({
  key: 'security.autoUnlock', type: 'boolean', section: 'Security', order: 20,
  title: 'Unlock without Enter',
  description: 'Unlock as soon as the last digit of your PIN is typed. Takes effect after your next unlock, when this device learns how many digits your PIN has.',
  default: false, keywords: ['pin', 'lock', 'enter', 'automatic', 'auto unlock'],
});

// ── Effects ──────────────────────────────────────────────────────────────────

function applyEditorVars(values: Record<string, unknown>): void {
  const root = document.documentElement;
  root.style.setProperty('--editor-font-size', `${values['editor.fontSize'] as SettingValues['editor.fontSize']}px`);
  root.style.setProperty('--editor-line-width', `${values['editor.lineWidth'] as SettingValues['editor.lineWidth']}px`);
  // Scales and fonts: removed at their defaults so a theme or augment that
  // sets them stays in charge until the user picks something else.
  for (const [name, value] of Object.entries(appearanceVars(values))) {
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
}

applyEditorVars(useSettings.getState().values);
useSettings.subscribe((s, prev) => {
  if (s.values !== prev.values) applyEditorVars(s.values);
});
