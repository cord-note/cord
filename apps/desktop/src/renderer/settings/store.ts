import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { ConfigFileWriter, type ConfigFileIO } from './configFile';
import { parseJsoncObject, setKeyInText, type SettingsProblem } from './jsonText';
import { resolveValues, validateValue, type SettingDefinition } from './schema';

export interface SettingsDeps {
  io: ConfigFileIO;
  definitions: () => readonly SettingDefinition[];
  /** Last good file contents, for painting the first frame before the file loads. */
  cache: { read: () => string | null; write: (text: string) => void };
  /** Values to seed a missing settings.json with (the one-time migration). */
  migrate?: () => Record<string, unknown>;
  /** Called only after the seeded file was written successfully. */
  onMigrated?: () => void;
  writeDelayMs?: number;
}

export interface SettingsState {
  /** Effective value of every declared setting. */
  values: Record<string, unknown>;
  /** The last file contents that parsed. */
  data: Record<string, unknown>;
  /** The file text as last read or written. */
  text: string;
  problems: SettingsProblem[];
  /** The file does not parse: UI edits apply in memory but are not saved. */
  syntaxError: boolean;
  saveError: string | null;
  loaded: boolean;

  applyBootCache: () => void;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  set: (key: string, value: unknown) => void;
  reset: (key: string) => void;
  /** Save text from the JSON view. Returns the problems; syntax errors block the save. */
  saveText: (text: string) => Promise<SettingsProblem[]>;
  refreshDefinitions: () => void;
  flush: () => Promise<void>;
  /** Write anything pending, then return to defaults and not-loaded (a user switch). */
  unload: () => Promise<void>;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createSettingsStore(deps: SettingsDeps): UseBoundStore<StoreApi<SettingsState>> {
  const writer = new ConfigFileWriter('settings', deps.io, deps.writeDelayMs ?? 300);

  return create<SettingsState>((set, get) => {
    writer.onSaved = () => set({ saveError: null });
    writer.onError = (err) => set({ saveError: `Couldn't save settings: ${message(err)}` });

    function cacheData(data: Record<string, unknown>): void {
      try {
        deps.cache.write(JSON.stringify(data));
      } catch {
        // Storage blocked: the next launch paints defaults for one frame.
      }
    }

    function applyText(text: string): void {
      const parsed = parseJsoncObject(text);
      if (!parsed.data) {
        set({ text, problems: parsed.problems, syntaxError: true });
        return;
      }
      const { values, problems } = resolveValues(deps.definitions(), parsed.data);
      set({ text, data: parsed.data, values, problems, syntaxError: false });
      cacheData(parsed.data);
    }

    function definition(key: string): SettingDefinition {
      const def = deps.definitions().find((d) => d.key === key);
      if (!def) throw new Error(`Unknown setting "${key}"`);
      return def;
    }

    return {
      values: resolveValues(deps.definitions(), {}).values,
      data: {},
      text: '',
      problems: [],
      syntaxError: false,
      saveError: null,
      loaded: false,

      applyBootCache: () => {
        let cached: unknown = null;
        try {
          const raw = deps.cache.read();
          cached = raw ? JSON.parse(raw) : null;
        } catch {
          cached = null;
        }
        if (typeof cached !== 'object' || cached === null || Array.isArray(cached)) return;
        const data = cached as Record<string, unknown>;
        set({ data, values: resolveValues(deps.definitions(), data).values });
      },

      load: async () => {
        let text: string | null;
        try {
          text = await deps.io.read('settings');
        } catch (err) {
          set({ saveError: `Couldn't read settings.json (${message(err)}). Changes made here are not saved until it can be read.` });
          return;
        }
        set({ saveError: null });
        if (text === null) {
          const seed = deps.migrate?.() ?? {};
          text = Object.entries(seed).reduce((t, [k, v]) => setKeyInText(t, k, v), '');
          if (Object.keys(seed).length > 0) {
            try {
              await deps.io.write('settings', text);
              deps.onMigrated?.();
            } catch (err) {
              set({ saveError: `Couldn't save settings: ${message(err)}` });
            }
          }
        }
        applyText(text);
        set({ loaded: true });
      },

      reload: async () => {
        if (!get().loaded) return get().load();
        await writer.flush();
        let text: string | null;
        try {
          text = await deps.io.read('settings');
        } catch {
          return;
        }
        if (text !== null && text !== get().text) applyText(text);
      },

      set: (key, value) => {
        const def = definition(key);
        const error = validateValue(def, value);
        if (error) throw new Error(`Invalid value for ${key}: ${error}`);
        const previous = get().values[key];
        if (Object.is(previous, value)) return;
        const values = { ...get().values, [key]: value };

        if (get().syntaxError || !get().loaded) {
          // Never overwrite a file that is broken or has not been read yet —
          // writing from empty text would replace the user's settings. The
          // banner says the change is not saved.
          set({ values });
        } else {
          const stored = Object.is(value, def.default) ? undefined : value;
          const text = setKeyInText(get().text, key, stored);
          const data = { ...get().data };
          if (stored === undefined) delete data[key];
          else data[key] = stored;
          const { problems } = resolveValues(deps.definitions(), data);
          set({ values, text, data, problems });
          cacheData(data);
          writer.schedule(text);
        }
        (def.onUserChange as ((v: unknown, p: unknown) => void) | undefined)?.(value, previous);
      },

      reset: (key) => {
        get().set(key, definition(key).default);
      },

      saveText: async (text) => {
        if (!get().loaded) {
          return [{ key: null, severity: 'error', message: 'settings.json has not been read yet, so saving could overwrite it' }];
        }
        const parsed = parseJsoncObject(text);
        if (!parsed.data) return parsed.problems;
        applyText(text);
        writer.schedule(text);
        await writer.flush();
        return get().problems;
      },

      refreshDefinitions: () => {
        const { values, problems } = resolveValues(deps.definitions(), get().data);
        set(get().syntaxError ? { values } : { values, problems });
      },

      flush: () => writer.flush(),

      unload: async () => {
        await writer.flush();
        set({
          values: resolveValues(deps.definitions(), {}).values,
          data: {},
          text: '',
          problems: [],
          syntaxError: false,
          saveError: null,
          loaded: false,
        });
      },
    };
  });
}
