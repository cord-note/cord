import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Who is allowed to replace Cord's files. On a .deb, .rpm or AUR install that
// is the system package manager and nothing else, so the update check must not
// even run there — see app_updater_supported in src-tauri/src/commands/app.rs.
// An unwanted prompt is the mild failure; downloadAndInstall writing over
// package-manager-owned files is the other one.

const calls: string[] = [];
let supported: boolean;
let available: { version: string; currentVersion: string } | null;
let confirmAnswer: boolean;

mock.module('@renderer/ipc', () => ({
  api: {
    app: {
      updaterSupported: async () => { calls.push('updaterSupported'); return supported; },
    },
  },
}));

mock.module('@tauri-apps/plugin-updater', () => ({
  check: async () => {
    calls.push('check');
    if (!available) return null;
    return {
      ...available,
      downloadAndInstall: async () => { calls.push('downloadAndInstall'); },
    };
  },
}));

const { checkForUpdate } = await import('../updater');

beforeEach(() => {
  calls.length = 0;
  supported = true;
  available = null;
  confirmAnswer = true;
  globalThis.window = {
    confirm: () => { calls.push('confirm'); return confirmAnswer; },
  } as unknown as Window & typeof globalThis;
});

describe('checkForUpdate', () => {
  it('never contacts the update server when this install cannot update itself', async () => {
    supported = false;
    available = { version: '2.0.0', currentVersion: '1.7.0' };

    await checkForUpdate();

    expect(calls).toEqual(['updaterSupported']);
  });

  it('checks, but stays quiet when there is no newer release', async () => {
    await checkForUpdate();

    expect(calls).toEqual(['updaterSupported', 'check']);
  });

  it('installs only after the user agrees', async () => {
    available = { version: '2.0.0', currentVersion: '1.7.0' };

    await checkForUpdate();

    expect(calls).toEqual(['updaterSupported', 'check', 'confirm', 'downloadAndInstall']);
  });

  it('does nothing further when the user declines', async () => {
    available = { version: '2.0.0', currentVersion: '1.7.0' };
    confirmAnswer = false;

    await checkForUpdate();

    expect(calls).toEqual(['updaterSupported', 'check', 'confirm']);
  });

  it('swallows a failed check rather than keeping anyone out of their notes', async () => {
    supported = true;
    mock.module('@renderer/ipc', () => ({
      api: { app: { updaterSupported: async () => { throw new Error('offline'); } } },
    }));

    await expect(checkForUpdate()).resolves.toBeUndefined();
  });
});
