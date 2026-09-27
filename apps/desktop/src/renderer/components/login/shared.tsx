import { useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { LockScreenUser } from '@shared/types';
import { useAuthStore } from '../../store/auth';
import styles from '../LoginScreen.module.css';

export const isPin = (s: string): boolean => /^\d{4,6}$/.test(s);

/** Runs a form action with a loading flag and a readable error. */
export function useSubmit(action: () => Promise<void>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await action();
    } catch (err: unknown) {
      // Tauri rejects with the sidecar's message as a plain string.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, setError, onSubmit };
}

export function useSelectedUser(): LockScreenUser | null {
  return useAuthStore((s) => s.lockScreen.users.find((u) => u.id === s.selectedUserId) ?? null);
}

/** Collapses rather than unmounting, so it keeps the last message while it animates shut. */
export function ErrorPanel({ error }: { error: string }) {
  const last = useRef('');
  if (error) last.current = error;
  return (
    <div className={`${styles.collapsible} ${error ? styles.collapsibleOpen : ''}`}>
      <div className={styles.collapsibleInner}>
        <div className={styles.error} role="alert">{error || last.current}</div>
      </div>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function PasswordField(props: FieldProps & { autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={props.id}>{props.label}</label>
      <div className={styles.passwordRow}>
        <input
          id={props.id}
          className={styles.input}
          type={show ? 'text' : 'password'}
          autoComplete={props.autoComplete}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          required
        />
        <button
          type="button"
          className={styles.showPwBtn}
          onClick={() => setShow((v) => !v)}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}

/** Masked, digits only, at most 6. `inputMode` brings up a number pad on touch screens. */
export function PinField(props: FieldProps) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className={`${styles.input} ${styles.pinInput} cord-login__pin`}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        required
      />
    </div>
  );
}

export function TextField(props: FieldProps & { autoComplete: string; placeholder?: string; mono?: boolean }) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className={`${styles.input} ${props.mono ? styles.mono : ''}`}
        type="text"
        spellCheck={false}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        required
      />
    </div>
  );
}

/** Which user is unlocking. A native select: keyboard and screen-reader friendly for free. */
export function UserPicker({ disabled }: { disabled?: boolean }) {
  const users = useAuthStore((s) => s.lockScreen.users);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const selectUser = useAuthStore((s) => s.selectUser);
  if (users.length === 0) return null;
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor="auth-user">User</label>
      <select
        id="auth-user"
        className={`${styles.input} ${styles.userSelect} cord-login__user-picker`}
        value={selectedUserId ?? ''}
        onChange={(e) => void selectUser(e.target.value)}
        disabled={disabled}
      >
        {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
      </select>
    </div>
  );
}

export function LinkRow({ links }: { links: { label: string; onClick: () => void }[] }) {
  return (
    <div className={`${styles.links} cord-login__links`}>
      {links.map((l) => (
        <button key={l.label} type="button" className={styles.linkBtn} onClick={l.onClick}>{l.label}</button>
      ))}
    </div>
  );
}
