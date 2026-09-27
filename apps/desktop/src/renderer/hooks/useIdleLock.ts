import { useEffect } from 'react';
import { useSetting } from '../settings';
import { useAuthStore } from '../store/auth';

const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;

/** Locks Cord after `security.idleLockMinutes` without input. 0 turns it off. */
export function useIdleLock(): void {
  const minutes = useSetting('security.idleLockMinutes');
  const signedIn = useAuthStore((s) => s.user !== null);

  useEffect(() => {
    if (!signedIn || minutes <= 0) return;
    const delay = minutes * 60_000;
    const fire = (): void => { void useAuthStore.getState().lock(); };
    let timer = setTimeout(fire, delay);
    const reset = (): void => {
      clearTimeout(timer);
      timer = setTimeout(fire, delay);
    };
    for (const e of ACTIVITY) window.addEventListener(e, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of ACTIVITY) window.removeEventListener(e, reset);
    };
  }, [signedIn, minutes]);
}
