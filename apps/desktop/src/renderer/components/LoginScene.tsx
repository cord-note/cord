import { useEffect, useMemo, useRef, useState } from 'react';
import type { LoginScene as Scene } from '@shared/types';
import Dither from './Dither';
import { loadBlocked, pickScene, saveBlocked, sceneKey } from './scenes/pick';
import { readTones, SceneRenderer } from './scenes/renderer';
import styles from './LoginScene.module.css';

/**
 * The animated dither picture on the lock screen. Picks one scene at random
 * from `scenes` each time it appears and keeps it while on screen; pass one
 * scene to always show it.
 *
 * Drawn by WebGL (see `scenes/renderer.ts`), so every scene has the same
 * dither look. Colours come from the `--dither-scene-*` tokens and follow
 * theme changes.
 *
 * Theme scenes are untrusted: one that fails to compile, draws too slowly or
 * loses the GPU context is skipped from then on. Without WebGL, or with no
 * scene left, it falls back to the plain canvas dither. Decorative only.
 */

interface LoginSceneProps {
  scenes: readonly Scene[];
  /** Ids of the built-in scenes; only theme scenes are remembered as broken. */
  builtinIds: ReadonlySet<string>;
  /** Ignored when the OS asks for reduced motion. */
  animate?: boolean;
  className?: string;
}

/** uTime wraps so scene maths stays precise. */
const TIME_WRAP_S = 4 * 60 * 60;

export default function LoginScene({ scenes, builtinIds, animate = true, className }: LoginSceneProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [noWebgl, setNoWebgl] = useState(false);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(loadBlocked);
  // Bumped when a lost GPU context comes back, to rebuild on a fresh canvas.
  const [generation, setGeneration] = useState(0);

  const available = useMemo(() => scenes.filter((s) => !blocked.has(sceneKey(s))), [scenes, blocked]);
  const [scene, setScene] = useState<Scene | null>(() => pickScene(available));

  // Keep the scene while it is still on offer, so it never swaps mid-PIN.
  useEffect(() => {
    if (!scene || !available.some((s) => s.id === scene.id)) setScene(pickScene(available));
  }, [available, scene]);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || !scene || noWebgl) return;
    const current = scene;

    /** Never show this scene again (theme scenes) or this session (built-ins). */
    function reject(): void {
      setBlocked((prev) => {
        const next = new Set(prev).add(sceneKey(current));
        if (!builtinIds.has(current.id)) saveBlocked(new Set([...loadBlocked(), sceneKey(current)]));
        return next;
      });
    }

    const created = SceneRenderer.create(canvas, current, 1 + Math.floor(Math.random() * 100));
    if (created === 'no-webgl') { setNoWebgl(true); return; }
    if (created === 'bad-scene') { reject(); return; }
    const renderer: SceneRenderer = created;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const started = performance.now();
    let timer = 0;
    let visible = true;
    let checked = false;

    const time = (): number => (animate && !motion.matches ? ((performance.now() - started) / 1000) % TIME_WRAP_S : 0);
    const draw = (): void => renderer.draw(time());

    function resize(): void {
      if (!box) return;
      const rect = box.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      if (!checked) {
        checked = true;
        if (renderer.tooSlow(time())) {
          reject();
          return;
        }
      }
      draw();
    }

    function tick(): void {
      if (visible && !document.hidden) draw();
    }

    function start(): void {
      clearInterval(timer);
      if (animate && !motion.matches) timer = window.setInterval(tick, 1000 / current.fps);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(box);

    // Pause while scrolled out of view or behind another surface.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    intersection.observe(canvas);

    // Theme and scheme changes arrive as attribute or inline-style changes on <html>.
    const themeObserver = new MutationObserver(() => {
      renderer.setTones(readTones(canvas));
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-scheme', 'style', 'class'],
    });

    // A lost context while a theme scene runs is blamed on the scene; either
    // way the canvas is rebuilt once the GPU is back.
    const onLost = (e: Event): void => {
      e.preventDefault();
      if (!builtinIds.has(current.id)) reject();
    };
    const onRestored = (): void => setGeneration((g) => g + 1);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    motion.addEventListener('change', start);
    renderer.setTones(readTones(canvas));
    resize();
    start();

    return () => {
      clearInterval(timer);
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      motion.removeEventListener('change', start);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
    };
  }, [scene, animate, noWebgl, generation, builtinIds]);

  if (noWebgl || !scene) {
    return <Dither seed={7} cell={4} from="right" reach={0.6} animate={animate} className={className ?? ''} />;
  }

  return (
    <div ref={boxRef} className={`${styles.box} ${className ?? ''}`}>
      {/* Keyed by scene: a canvas keeps its GL context, so a new scene gets a fresh one. */}
      <canvas key={`${scene.id}-${generation}`} ref={canvasRef} className={`${styles.canvas} cord-dither`} aria-hidden="true" />
    </div>
  );
}
