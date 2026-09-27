import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Each user has their own settings files and boot cache. A user switch must
// never write one user's pending edit into another user's file, and the lock
// screen paints the chosen user's look from their cache without reading files.

const cache = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => cache.get(k) ?? null,
    setItem: (k: string, v: string) => { cache.set(k, v); },
    removeItem: (k: string) => { cache.delete(k); },
  },
});

/** The sidecar's side: one set of files per signed-in user. */
const files = new Map<string, string>();
let signedIn = 'u1';
mock.module('@renderer/ipc', () => ({
  api: {
    settings: {
      read: async (file: string) => ({ text: files.get(`${signedIn}/${file}`) ?? null }),
      write: async (file: string, text: string) => { files.set(`${signedIn}/${file}`, text); return { ok: true }; },
    },
  },
}));

const { registerSetting, settingDefinition, setSetting, getSetting } = await import('../index');
const { loadUserSettings, previewUserSettings, flushUserSettings, hasActiveSettingsUser } = await import('../session');

// Test files share one module registry, and theme.test.ts may have registered it already.
if (!settingDefinition('appearance.theme')) {
  registerSetting({
    key: 'appearance.theme', type: 'string', title: '', description: '', section: 'Appearance',
    default: 'mono', pattern: /^[a-z0-9-]+$/,
  });
}

beforeEach(async () => {
  await previewUserSettings(null);
  cache.clear();
  files.clear();
});

describe('per-user settings', () => {
  it('loads the signed-in user’s own file', async () => {
    files.set('u1/settings', '{"appearance.theme": "teal"}');
    files.set('u2/settings', '{"appearance.theme": "olive"}');
    signedIn = 'u2';
    await loadUserSettings('u2');
    expect(getSetting('appearance.theme')).toBe('olive');
    expect(hasActiveSettingsUser()).toBe(true);
  });

  it('writes a pending edit to the user who made it', async () => {
    signedIn = 'u1';
    await loadUserSettings('u1');
    setSetting('appearance.theme', 'teal');
    await flushUserSettings(); // what lock() does before the session ends
    expect(files.get('u1/settings')).toContain('teal');
    expect(hasActiveSettingsUser()).toBe(false);
  });

  it('refreshes the user’s boot cache from their file', async () => {
    files.set('u1/settings', '{"appearance.theme": "teal"}');
    signedIn = 'u1';
    await loadUserSettings('u1');
    expect(cache.get('cord-settings-cache:u1')).toContain('teal');
  });

  it('previews a user from their boot cache, defaults when there is none', async () => {
    cache.set('cord-settings-cache:u2', '{"appearance.theme":"olive"}');
    await previewUserSettings('u2');
    expect(getSetting('appearance.theme')).toBe('olive');
    await previewUserSettings('u3');
    expect(getSetting('appearance.theme')).toBe('mono');
  });
});
