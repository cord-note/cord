import { log } from '../lib/log';
import { useVaultStore } from '../store/vaults';
import { registerSetting, useSettings } from './index';
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
  }
}

registerSetting({
  key: 'editor.fontSize', type: 'number', section: 'Editor', order: 10,
  title: 'Font size', description: 'Text size in the editor.',
  default: 15, min: 12, max: 20, step: 1, unit: 'px', keywords: ['zoom', 'text size'],
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

// ── Effects ──────────────────────────────────────────────────────────────────

function applyEditorVars(values: Record<string, unknown>): void {
  const root = document.documentElement;
  root.style.setProperty('--editor-font-size', `${values['editor.fontSize'] as SettingValues['editor.fontSize']}px`);
  root.style.setProperty('--editor-line-width', `${values['editor.lineWidth'] as SettingValues['editor.lineWidth']}px`);
}

applyEditorVars(useSettings.getState().values);
useSettings.subscribe((s, prev) => {
  if (s.values !== prev.values) applyEditorVars(s.values);
});
