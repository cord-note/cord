import { getSetting } from '../settings';

/**
 * How many digits a user's PIN has, remembered on this device so the lock
 * screen can unlock the moment the last one is typed (Settings → Security →
 * Unlock without Enter). Without it, a four-digit attempt at a six-digit PIN
 * would be sent — and counted as a wrong PIN.
 *
 * Machine-local, like the rest of auth state, and kept only while the setting
 * is on: it narrows the PIN down, so it is not stored for anyone who does not
 * use it.
 */

const key = (userId: string): string => `cord-pin-length:${userId}`;

/** Record (or, with the setting off, forget) the length of a PIN just used successfully. */
export function rememberPinLength(userId: string, length: number): void {
  try {
    if (getSetting('security.autoUnlock')) localStorage.setItem(key(userId), String(length));
    else localStorage.removeItem(key(userId));
  } catch {
    // Storage blocked: the lock screen falls back to pressing Enter.
  }
}

export function knownPinLength(userId: string | null): number | null {
  if (!userId) return null;
  try {
    const n = Number(localStorage.getItem(key(userId)));
    return Number.isInteger(n) && n >= 4 && n <= 6 ? n : null;
  } catch {
    return null;
  }
}
