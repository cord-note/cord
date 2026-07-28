import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseHoldActionOptions {
  /** How long the pointer must stay down before the action fires. */
  durationMs: number;
  /** Fired once, when the hold completes. Never fired on an early release. */
  onComplete: () => void;
  disabled?: boolean;
}

export interface UseHoldActionResult {
  /** True from press until release or completion. */
  holding: boolean;
  /** 0 → 1, driven by requestAnimationFrame so it stays smooth. */
  progress: number;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onKeyUp: () => void;
    onClick: (e: React.MouseEvent) => void;
  };
}

/**
 * Press-and-hold to confirm a destructive action.
 *
 * Replaces the native `confirm()` dialogs the app used for deletes and
 * archives. The caller is responsible for rendering the progress feedback —
 * `HoldButton` does this, and should be preferred over calling the hook
 * directly unless you need custom chrome.
 */
export function useHoldAction({
  durationMs,
  onComplete,
  disabled = false,
}: UseHoldActionOptions): UseHoldActionResult {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);

  const frameRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  // Kept in a ref so a re-rendered parent passing a fresh closure doesn't
  // restart an in-flight hold.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const cancel = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setHolding(false);
    setProgress(0);
  }, []);

  // Release any in-flight frame if the button unmounts mid-hold — deleting the
  // last note in a list unmounts the row that owns the hold.
  useEffect(() => cancel, [cancel]);

  const start = useCallback(() => {
    if (disabled || frameRef.current !== null) return;

    startedAtRef.current = performance.now();
    setHolding(true);
    setProgress(0);

    const tick = (now: number) => {
      const elapsed = now - startedAtRef.current;
      const next = Math.min(elapsed / durationMs, 1);
      setProgress(next);

      if (next >= 1) {
        frameRef.current = null;
        setHolding(false);
        setProgress(0);
        onCompleteRef.current();
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [disabled, durationMs]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      // Rows underneath these buttons select a note on click; never let a
      // press-to-delete double as a press-to-open.
      e.stopPropagation();
      if (e.button !== 0) return;
      e.preventDefault();
      start();
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      cancel();
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // Held keys autorepeat; ignore everything after the first event.
      if (e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      start();
    },
    onKeyUp: cancel,
    onClick: (e: React.MouseEvent) => {
      // The hold is the whole interaction — a plain click must do nothing.
      e.stopPropagation();
      e.preventDefault();
    },
  };

  return { holding, progress, handlers };
}
