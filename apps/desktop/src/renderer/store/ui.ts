import { create } from 'zustand';

export type AppView = 'notes' | 'trash' | 'settings' | 'tag';
export type SettingsTab = 'appearance' | 'app' | 'vault' | 'tags';

interface UIStore {
  view: AppView;
  commandsOpen: boolean;
  settingsTab: SettingsTab;
  /** The tag whose page is open when `view` is 'tag'. */
  tagPageId: string | null;
  setView:        (v: AppView) => void;
  openTag:        (tagId: string) => void;
  openSettings:   (tab?: SettingsTab) => void;
  openCommands:   () => void;
  toggleCommands: () => void;
  closeCommands:  () => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  view: 'notes',
  commandsOpen: false,
  settingsTab: 'appearance',
  tagPageId: null,

  setView: (v) => set({ view: v }),
  openTag: (tagId) => set({ view: 'tag', tagPageId: tagId }),

  openSettings: (tab = 'app') => set({ view: 'settings', settingsTab: tab }),

  openCommands:   () => set({ commandsOpen: true }),
  toggleCommands: () => set({ commandsOpen: !get().commandsOpen }),
  closeCommands:  () => set({ commandsOpen: false }),
}));
