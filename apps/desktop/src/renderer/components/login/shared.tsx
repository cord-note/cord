import { useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
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
export function PinField(props: FieldProps & { hero?: boolean; invalid?: boolean }) {
  if (props.hero) return <PinSlots {...props} />;
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

const PIN_SLOTS = 6;
const PIN_MIN = 4;

/**
 * The PIN as a row of slots, the focus of the unlock screen. The real input
 * sits invisibly over the slots, so typing, pasting, focus and screen readers
 * all go through a plain password field; the slots only mirror its length.
 * Slots past the fourth are drawn lighter: a PIN may stop there.
 */
function PinSlots(props: FieldProps & { invalid?: boolean }) {
  const length = props.value.length;
  return (
    <div className={styles.pinHero}>
      <label className={styles.label} htmlFor={props.id}>{props.label}</label>
      <div className={`${styles.pinSlots} ${props.invalid ? styles.pinSlotsInvalid : ''}`}>
        {Array.from({ length: PIN_SLOTS }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={[
              styles.pinSlot,
              i < length ? styles.pinSlotFilled : '',
              i === length ? styles.pinSlotNext : '',
              i >= PIN_MIN ? styles.pinSlotOptional : '',
            ].join(' ')}
          />
        ))}
        <input
          id={props.id}
          className={`${styles.pinSlotsInput} cord-login__pin`}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_SLOTS}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_SLOTS))}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          required
        />
      </div>
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

/**
 * Which user is unlocking, as a pill in the lock screen's top-right corner.
 * A native select under the styling: keyboard and screen-reader friendly for free.
 */
export function UserPicker() {
  const users = useAuthStore((s) => s.lockScreen.users);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const selectUser = useAuthStore((s) => s.selectUser);
  const selected = users.find((u) => u.id === selectedUserId);
  if (users.length === 0) return null;
  return (
    <div className={styles.userPill}>
      <span className={styles.userAvatar} aria-hidden="true">
        {(selected?.username ?? '?').slice(0, 1).toUpperCase()}
      </span>
      <select
        id="auth-user"
        aria-label="User"
        className={`${styles.userSelect} cord-login__user-picker`}
        value={selectedUserId ?? ''}
        onChange={(e) => void selectUser(e.target.value)}
      >
        {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
      </select>
      {/* The native arrow is hidden to match the pill; this puts one back. */}
      <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} aria-hidden="true" />
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
