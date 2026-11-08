import { useEffect, useMemo, useState } from 'react';
import { Check, CheckSquare, Square } from 'lucide-react';
import type { LoginScene } from '@shared/types';
import { setSetting, useSetting } from '../../settings';
import type { SettingControlProps } from '../../settings/schema';
import { useThemeStore } from '../../store/theme';
import { POOL, RANDOM, chooseScenes, formatPool, parsePool } from '../scenes/choose';
import { useSceneGroups } from '../scenes';
import { sceneKey } from '../scenes/pick';
import { readTones, renderPreview } from '../scenes/renderer';
import styles from '../SettingsPage.module.css';

type Mode = 'random' | 'pool' | 'one';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'random', label: 'Random' },
  { mode: 'pool', label: 'From pool' },
  { mode: 'one', label: 'One scene' },
];

/**
 * The lock-screen scene: every installed scene with a preview, grouped by
 * built-in and by theme. Pick one to always show it, let Cord pick at random,
 * or tick scenes into a pool to pick from. The pool lives in its own setting,
 * `appearance.loginScenePool`, which has no row of its own.
 */
export function LoginSceneControl({ value, onChange }: SettingControlProps<string>) {
  const groups = useSceneGroups();
  const poolText = useSetting('appearance.loginScenePool');
  const all = useMemo(() => groups.flatMap((g) => g.scenes), [groups]);
  const pool = useMemo(() => new Set(parsePool(poolText)), [poolText]);
  const previews = usePreviews(all);

  const mode: Mode = value === RANDOM ? 'random' : value === POOL ? 'pool' : 'one';
  const shown = chooseScenes(all, value, poolText);
  const missing = mode === 'one' && !all.some((s) => s.id === value);

  function setMode(next: Mode): void {
    if (next === 'random') onChange(RANDOM);
    else if (next === 'pool') onChange(POOL);
    // One scene: keep the one shown last time if there is one, else the first.
    else onChange(mode === 'one' ? value : (all[0]?.id ?? RANDOM));
  }

  function setPool(ids: readonly string[]): void {
    setSetting('appearance.loginScenePool', formatPool(ids));
  }

  function choose(scene: LoginScene): void {
    if (mode === 'pool') {
      const next = new Set(pool);
      if (next.has(scene.id)) next.delete(scene.id); else next.add(scene.id);
      setPool(all.filter((s) => next.has(s.id)).map((s) => s.id));
    } else {
      onChange(scene.id);
    }
  }

  const inPool = all.filter((s) => pool.has(s.id)).length;
  // Built-in scenes, then every theme's scenes in one grid, each card naming its theme.
  const sections = [
    { label: 'Built-in', scenes: groups[0]?.scenes ?? [], from: new Map<string, string>() },
    {
      label: 'From themes',
      scenes: groups.slice(1).flatMap((g) => g.scenes),
      from: new Map(groups.slice(1).flatMap((g) => g.scenes.map((s) => [s.id, g.label] as const))),
    },
  ];
  const summary =
    mode === 'random' ? `A random scene each time, from all ${all.length}. Click one to always show it.`
    : mode === 'pool' ? (inPool === 0
      ? 'The pool is empty, so every scene is used. Click scenes to add them.'
      : `A random scene each time, from the ${inPool} in your pool. Click a scene to add or remove it.`)
    : missing ? 'The chosen scene is not installed any more, so a random one is shown.'
    : `Always ${shown[0]?.name ?? 'the same scene'}.`;

  return (
    <div className={styles.gallery}>
      <div className={styles.galleryBar}>
        <div className={styles.sceneModes} role="radiogroup" aria-label="How the scene is picked">
          {MODES.map((m) => (
            <button
              key={m.mode}
              role="radio"
              aria-checked={mode === m.mode}
              className={`${styles.sceneModeBtn} ${mode === m.mode ? styles.sceneModeOn : ''}`}
              onClick={() => setMode(m.mode)}
            >{m.label}</button>
          ))}
        </div>
        {mode === 'pool' && (
          <>
            <button className={styles.secondaryBtn} onClick={() => setPool(all.map((s) => s.id))}>All</button>
            <button className={styles.secondaryBtn} onClick={() => setPool([])} disabled={inPool === 0}>None</button>
          </>
        )}
      </div>

      <div className={styles.sceneSummary}>{summary}</div>

      {sections.filter((sec) => sec.scenes.length > 0).map((sec) => (
        <div key={sec.label} className={styles.galleryGroup}>
          <div className={styles.galleryGroupLabel}>{sec.label}</div>
          <div className={styles.themeGrid}>
            {sec.scenes.map((s) => {
              const on = mode === 'pool' ? pool.has(s.id) : mode === 'one' && value === s.id;
              const theme = sec.from.get(s.id);
              return (
                <button
                  key={s.id}
                  className={`${styles.themeCard} ${on ? styles.sceneCardOn : ''} ${mode === 'pool' && inPool > 0 && !on ? styles.sceneCardOut : ''}`}
                  onClick={() => choose(s)}
                  aria-pressed={on}
                  title={theme ? `${s.name}, from ${theme}` : s.name}
                >
                  <div className={styles.scenePreview}>
                    {previews.get(sceneKey(s)) && <img src={previews.get(sceneKey(s))} alt="" draggable={false} />}
                  </div>
                  <div className={styles.themeCardFoot}>
                    <span className={styles.themeCardLabel}>
                      {s.name}
                      {theme && <span className={styles.sceneCardTheme}>{theme}</span>}
                    </span>
                    {mode === 'pool'
                      ? (on ? <CheckSquare size={13} strokeWidth={2} className={styles.themeCardCheck} /> : <Square size={13} strokeWidth={1.75} className={styles.sceneCardBox} />)
                      : on && <Check size={13} strokeWidth={2.5} className={styles.themeCardCheck} />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {groups.length === 1 && (
        <div className={styles.galleryEmpty}>
          Themes can bring their own scenes. Import one from the theme gallery and its scenes appear here.
        </div>
      )}
    </div>
  );
}

/** Still previews of `scenes` in the current theme's colours, drawn one at a time. */
function usePreviews(scenes: readonly LoginScene[]): ReadonlyMap<string, string> {
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const done = new Map<string, string>();
    setPreviews(new Map());
    // Wait a frame so the new theme's tokens have applied.
    let i = 0;
    let handle = requestAnimationFrame(function next() {
      if (cancelled || i >= scenes.length) return;
      const scene = scenes[i++]!;
      const tones = readTones(document.documentElement);
      // Drawn larger than the card and scaled down, so a preview shows the
      // same number of cells as a good part of the lock screen.
      const url = renderPreview(scene, 400, 250, tones);
      if (url) {
        done.set(sceneKey(scene), url);
        setPreviews(new Map(done));
      }
      handle = requestAnimationFrame(next);
    });
    return () => { cancelled = true; cancelAnimationFrame(handle); };
  }, [scenes, activeTheme, colorScheme]);

  return previews;
}
