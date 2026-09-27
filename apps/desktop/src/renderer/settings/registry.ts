import { create } from 'zustand';
import { validateDefinition, type SettingDefinition } from './schema';

// Every declared setting. Built-ins register from builtin.ts; a module
// registers its own the same way. Reactive, so a late registration shows up
// in the Settings page and in effective values.

interface SettingsRegistryStore {
  definitions: SettingDefinition[];
  register: (def: SettingDefinition) => void;
}

export const useSettingsRegistry = create<SettingsRegistryStore>((set, get) => ({
  definitions: [],

  register: (def) => {
    validateDefinition(def);
    if (get().definitions.some((d) => d.key === def.key)) {
      throw new Error(`Setting "${def.key}" is already registered`);
    }
    set((s) => ({ definitions: [...s.definitions, def] }));
  },
}));

export function registerSetting(def: SettingDefinition): void {
  useSettingsRegistry.getState().register(def);
}

export function settingDefinition(key: string): SettingDefinition | undefined {
  return useSettingsRegistry.getState().definitions.find((d) => d.key === key);
}
