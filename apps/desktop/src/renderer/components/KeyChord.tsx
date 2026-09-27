import { accelKeys } from '../store/keybindings';
import styles from './KeyChord.module.css';

interface KeyChordProps {
  accel: string;
  /** `sm` for dense lists like the command palette. */
  size?: 'sm' | 'md';
}

/**
 * A shortcut drawn as keycaps — one per key, in the UI font — rather than as a
 * monospace `Ctrl+Shift+X` string, which read as code and depended on which
 * monospace fonts happened to be installed.
 */
export function KeyChord({ accel, size = 'md' }: KeyChordProps) {
  const keys = accelKeys(accel);
  if (keys.length === 0) return null;
  return (
    <span className={`${styles.chord} ${size === 'sm' ? styles.sm : ''}`} aria-label={keys.join(' ')}>
      {keys.map((key, i) => (
        <kbd key={i} className={`${styles.key} cord-kbd`}>{key}</kbd>
      ))}
    </span>
  );
}
