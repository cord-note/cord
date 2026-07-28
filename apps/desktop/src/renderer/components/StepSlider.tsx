import { useMemo } from 'react';
import styles from './StepSlider.module.css';

export interface StepSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  /**
   * Spacing between visible notches. Defaults to `step`; set it larger when
   * `step` is fine-grained enough that a notch per step would look like noise.
   */
  notchStep?: number | undefined;
  label: string;
}

/**
 * Range input with a slim track and discrete step notches.
 *
 * The native `input[type=range]` is kept for keyboard and accessibility
 * behaviour but rendered transparent; the visible track, fill and notches are
 * drawn underneath it.
 */
export function StepSlider({
  min,
  max,
  step,
  value,
  onChange,
  notchStep,
  label,
}: StepSliderProps): JSX.Element {
  const notches = useMemo(() => {
    const spacing = notchStep ?? step;
    const out: number[] = [];
    for (let v = min; v <= max; v += spacing) out.push(v);
    // Floating-point accumulation can stop just short of `max`.
    if (out[out.length - 1] !== max) out.push(max);
    return out;
  }, [min, max, step, notchStep]);

  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className={styles.wrap}>
      <div className={styles.track} aria-hidden="true">
        <div className={styles.fill} style={{ width: `${pct(value)}%` }} />
        {notches.map((n) => (
          <span
            key={n}
            className={`${styles.notch} ${n <= value ? styles.notchFilled : ''}`}
            style={{ left: `${pct(n)}%` }}
          />
        ))}
      </div>
      <input
        type="range"
        className={styles.input}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
