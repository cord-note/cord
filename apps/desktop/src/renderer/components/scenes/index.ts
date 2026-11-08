import { useMemo } from 'react';
import type { LoginScene } from '@shared/types';
import { useSetting } from '../../settings';
import { useThemeLibrary } from '../../store/themeLibrary';
import { bridge } from './bridge';
import { chooseScenes } from './choose';
import { clouds } from './clouds';
import { flower } from './flower';

/** Built-in lock-screen scenes. Adding one is adding it here. */
export const BUILTIN_SCENES: readonly LoginScene[] = [clouds, bridge, flower];

export const BUILTIN_SCENE_IDS: ReadonlySet<string> = new Set(BUILTIN_SCENES.map((s) => s.id));

/** Scenes grouped by where they come from: built-in first, then each library theme. */
export interface SceneGroup {
  id: string;
  label: string;
  scenes: readonly LoginScene[];
}

/** Every installed scene, from the built-ins and every library theme, active or not. */
export function useSceneGroups(): SceneGroup[] {
  const library = useThemeLibrary((s) => s.sceneGroups);
  return useMemo(() => [
    { id: 'builtin', label: 'Built-in', scenes: BUILTIN_SCENES },
    ...library.map((g) => ({ id: g.themeId, label: g.label, scenes: g.scenes })),
  ], [library]);
}

/** The scenes the lock screen picks from, as the scene setting asks. */
export function useLoginScenes(): readonly LoginScene[] {
  const groups = useSceneGroups();
  const mode = useSetting('appearance.loginScene');
  const pool = useSetting('appearance.loginScenePool');
  return useMemo(() => chooseScenes(groups.flatMap((g) => g.scenes), mode, pool), [groups, mode, pool]);
}
