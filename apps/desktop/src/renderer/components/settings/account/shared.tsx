import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { log } from '../../../lib/log';
import styles from './AccountFlows.module.css';

/** Errors the user fixes on the step itself; anything else is a failure screen. */
const FIXABLE = /wrong password|pin must be|do not match|at least/i;

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
export const isFixable = (err: unknown): boolean => FIXABLE.test(message(err));
export const isPin = (s: string): boolean => /^\d{4,6}$/.test(s);

/** Transport failures mean the sidecar is gone; say that, not the URL it failed to reach. */
const UNREACHABLE = /error sending request|connection refused|failed to fetch|timed out/i;

/** A failure reason a person can read. The raw error goes to the log. */
export function failureReason(err: unknown): string {
  const raw = message(err);
  log('error', 'account', 'Account change failed', raw);
  if (UNREACHABLE.test(raw)) return 'Cord’s background service didn’t respond. Restart Cord and try again.';
  return /[.!?]$/.test(raw) ? raw : `${raw}.`;
}

/** Where a flow is: on a numbered step, finished, or failed unexpectedly. */
export type Phase =
  | { kind: 'step'; index: number }
  | { kind: 'done' }
  | { kind: 'failed'; message: string; retryStep: number };

/**
 * Runs a step's action. Fixable errors become the step's inline error;
 * anything else moves the flow to its failure screen.
 */
export function useStepAction(onFail: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(e: FormEvent, action: () => Promise<void>): Promise<void> {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (isFixable(err)) setError(message(err));
      else onFail(failureReason(err));
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}

export function StepDots({ index, count }: { index: number; count: number }) {
  return (
    <div className={`${styles.steps} cord-dialog__steps`} aria-label={`Step ${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${styles.dot} ${i <= index ? styles.dotOn : ''}`} />
      ))}
      <span className={styles.stepLabel}>Step {index + 1} of {count}</span>
    </div>
  );
}

export function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'password' | 'pin';
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const pin = props.type === 'pin';
  return (
    <label className={styles.field} htmlFor={props.id}>
      <span className={styles.label}>{props.label}</span>
      <input
        id={props.id}
        className={`${styles.input} ${pin ? styles.pinInput : ''}`}
        type="password"
        inputMode={pin ? 'numeric' : undefined}
        maxLength={pin ? 6 : undefined}
        autoComplete={props.autoComplete ?? 'off'}
        value={props.value}
        onChange={(e) => props.onChange(pin ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
      />
    </label>
  );
}

export function InlineError({ error }: { error: string }) {
  return error ? <div className={styles.error} role="alert">{error}</div> : null;
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  primary?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <button
      type={props.type ?? 'button'}
      className={`${styles.button} ${props.primary ? styles.primary : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
    >
      {props.children}
    </button>
  );
}

/** The last screen of a flow: an unmistakable yes or no. */
export function Result(props: {
  ok: boolean;
  title: string;
  detail: string;
  onDone: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className={`${styles.result} ${props.ok ? styles.resultOk : styles.resultFail} cord-dialog__result`} role="status">
      <div className={styles.badge} aria-hidden="true">
        {props.ok ? <Check size={30} strokeWidth={2.5} /> : <X size={30} strokeWidth={2.5} />}
      </div>
      <div className={styles.resultTitle}>{props.title}</div>
      <p className={styles.resultDetail}>{props.detail}</p>
      <Actions>
        {props.onRetry && <Button onClick={props.onRetry}>Try again</Button>}
        <Button primary onClick={props.onDone} autoFocus>{props.ok ? 'Done' : 'Close'}</Button>
      </Actions>
    </div>
  );
}
