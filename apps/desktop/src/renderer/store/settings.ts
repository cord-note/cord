import { create } from 'zustand';
import type { AppSettings } from '@shared/types';

const DEFAULTS: AppSettings = {
  editorFontSize:      15,
  editorLineWidth:     720,
  spellCheck:          false,
  unlinkedMentions:    true,
  distinctVaultColors: false,
};

interface SettingsStore extends AppSettings {
  loaded: boolean;
  load:   () => Promise<void>;
  update: (updates: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULTS,
  loaded: false,

  load: async () => {
    const s: AppSettings = {
      editorFontSize:      Number(localStorage.getItem('cord-font-size'))  || DEFAULTS.editorFontSize,
      editorLineWidth:     Number(localStorage.getItem('cord-line-width')) || DEFAULTS.editorLineWidth,
      spellCheck:          localStorage.getItem('cord-spell-check') === 'true',
      unlinkedMentions:    localStorage.getItem('cord-unlinked-mentions') !== 'false',
      distinctVaultColors: localStorage.getItem('cord-distinct-vault-colors') === 'true',
    };
    set({ ...s, loaded: true });
    applyCssVars(s);
  },

  update: async (updates) => {
    if (updates.editorFontSize  !== undefined) localStorage.setItem('cord-font-size',          String(updates.editorFontSize));
    if (updates.editorLineWidth !== undefined) localStorage.setItem('cord-line-width',         String(updates.editorLineWidth));
    if (updates.spellCheck      !== undefined) localStorage.setItem('cord-spell-check',        String(updates.spellCheck));
    if (updates.unlinkedMentions !== undefined) localStorage.setItem('cord-unlinked-mentions', String(updates.unlinkedMentions));
    if (updates.distinctVaultColors !== undefined) localStorage.setItem('cord-distinct-vault-colors', String(updates.distinctVaultColors));
    set((s) => {
      const next = { ...s, ...updates };
      applyCssVars(next);
      return next;
    });
  },
}));

function applyCssVars(s: AppSettings) {
  const root = document.documentElement;
  root.style.setProperty('--editor-font-size',  `${s.editorFontSize}px`);
  root.style.setProperty('--editor-line-width', `${s.editorLineWidth}px`);
}
