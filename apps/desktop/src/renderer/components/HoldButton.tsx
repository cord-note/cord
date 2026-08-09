import type { ReactNode } from 'react';
import { useHoldAction } from '../hooks/useHoldAction';
import styles from './HoldButton.module.css';

export interface HoldButtonProps {
  /** Hold duration in ms. 300 for deletes, 400 for archive. */
  durationMs: number;
  onComplete: () => void;
  children: ReactNode;
  /**
   * `icon` wipes the icon itself with the danger colour, left to right
   * (note rows). `text` wipes the button background the same way
   * (danger-zone buttons). Both reveal rather than scale, so the button's
   * rounded corners stay square-on-true at every point in the hold.
   */
  variant?: 'icon' | 'text' | undefined;
  /** Replaces `children` while the hold is in progress. */
  holdingLabel?: ReactNode | undefined;
  /**
   * Square size in px for the `icon` variant. Set inline rather than in CSS so
   * it can't lose a specificity fight with the caller's own button styles.
   */
  size?: number | undefined;
  title?: string | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
}

/**
 * Destructive action that requires a press-and-hold rather than a click,
 * with the elapsed progress drawn on the button itself.
 */
export function HoldButton({
  durationMs,
  onComplete,
  children,
  variant = 'icon',
  holdingLabel,
  size,
  title,
  className,
  disabled = false,
}: HoldButtonProps): JSX.Element {
  const { holding, progress, handlers } = useHoldAction({ durationMs, onComplete, disabled });

  const classes = [styles.btn, styles[variant], holding ? styles.holding : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      title={title}
      disabled={disabled}
      aria-label={title}
      style={{
        ['--hold-progress' as string]: String(progress),
        ...(variant === 'icon' && size !== undefined ? { width: size, height: size } : {}),
      }}
      {...handlers}
    >
      {/* For `icon`, the wipe is a second copy of the icon in the danger
          colour, clipped to the elapsed fraction and stacked over the first.
          For `text` it is a plain background wipe and holds no content. */}
      <span className={styles.fill} aria-hidden="true">
        {variant === 'icon' ? children : null}
      </span>
      <span className={styles.label}>{holding && holdingLabel ? holdingLabel : children}</span>
    </button>
  );
}
