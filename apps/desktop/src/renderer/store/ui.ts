import { create } from 'zustand';

export type AppView = 'notes' | 'trash' | 'settings';
export type SettingsTab = 'appearance' | 'app' | 'vault';

interface UIStore {
  view: AppView;
  commandsOpen: boolean;
  settingsTab: SettingsTab;
  setView:        (v: AppView) => void;
  openSettings:   (tab?: SettingsTab) => void;
  openCommands:   () => void;
  toggleCommands: () => void;
  closeCommands:  () => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  view: 'notes',
  commandsOpen: false,
  settingsTab: 'appearance',

  setView: (v) => set({ view: v }),

  openSettings: (tab = 'app') => set({ view: 'settings', settingsTab: tab }),

  openCommands:   () => set({ commandsOpen: true }),
  toggleCommands: () => set({ commandsOpen: !get().commandsOpen }),
  closeCommands:  () => set({ commandsOpen: false }),
}));
