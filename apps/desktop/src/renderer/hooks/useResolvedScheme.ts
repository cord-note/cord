import { useEffect, useState } from 'react';
import { useThemeStore, resolveScheme } from '../store/theme';

/** Cord's light/dark scheme, following the system when set to `system`. */
export function useResolvedScheme(): 'light' | 'dark' {
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const [resolved, setResolved] = useState(() => resolveScheme(colorScheme));
  useEffect(() => {
    setResolved(resolveScheme(colorScheme));
    if (colorScheme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setResolved(resolveScheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [colorScheme]);
  return resolved;
}
