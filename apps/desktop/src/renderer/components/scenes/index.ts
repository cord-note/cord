import { useMemo } from 'react';
import type { LoginScene } from '@shared/types';
import { useThemeLibrary } from '../../store/themeLibrary';
import { useThemeStore } from '../../store/theme';
import { bridge } from './bridge';
import { clouds } from './clouds';
import { flower } from './flower';

/** Built-in lock-screen scenes. Adding one is adding it here. */
export const BUILTIN_SCENES: readonly LoginScene[] = [clouds, bridge, flower];

export const BUILTIN_SCENE_IDS: ReadonlySet<string> = new Set(BUILTIN_SCENES.map((s) => s.id));

/** The scenes on offer: the built-ins plus any the active theme brings. */
export function useLoginScenes(): readonly LoginScene[] {
  const active = useThemeStore((s) => s.activeTheme);
  const themes = useThemeLibrary((s) => s.themes);
  const cached = useThemeLibrary((s) => s.cachedScenes);
  return useMemo(() => {
    const own = themes.find((t) => t.id === active)?.scenes ?? (cached.themeId === active ? cached.scenes : []);
    return [...BUILTIN_SCENES, ...own];
  }, [active, themes, cached]);
}
