import { api } from '../ipc';
import type { ConfigFileIO } from './configFile';

/** Config files through the sidecar. */
export const ipcConfigIO: ConfigFileIO = {
  read: async (file) => (await api.settings.read(file)).text,
  write: async (file, text) => { await api.settings.write(file, text); },
};
