import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
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

function UserAvatar({ name }: { name: string }) {
  return <span className={styles.userAvatar} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

/**
 * Which user is unlocking, as a pill in the lock screen's top-right corner.
 * Opening it grows the pill downward into the list, the same width, so the
 * two read as one control. Focus stays on the button; the highlighted option
 * is announced through aria-activedescendant.
 */
export function UserPicker() {
  const users = useAuthStore((s) => s.lockScreen.users);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const selectUser = useAuthStore((s) => s.selectUser);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (users.length === 0) return null;
  const selected = users.find((u) => u.id === selectedUserId);
  const name = selected?.username ?? 'Choose user';

  function show(): void {
    setActive(Math.max(0, users.findIndex((u) => u.id === selectedUserId)));
    setOpen(true);
  }

  function choose(userId: string): void {
    setOpen(false);
    if (userId !== selectedUserId) void selectUser(userId);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % users.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + users.length) % users.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const user = users[active];
      if (user) choose(user.id);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    }
  }

  const activeUser = users[active];
  return (
    <div ref={rootRef} className={`${styles.userPill} ${open ? styles.userPillOpen : ''}`}>
      <button
        type="button"
        id="auth-user"
        className={`${styles.userButton} cord-login__user-picker`}
        aria-label={`User: ${name}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="auth-user-list"
        aria-activedescendant={open && activeUser ? `auth-user-${activeUser.id}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <UserAvatar name={name} />
        <span className={styles.userName}>{name}</span>
        <ChevronDown size={14} strokeWidth={1.75} className={styles.userChevron} aria-hidden="true" />
      </button>
      {open && (
        <ul id="auth-user-list" role="listbox" aria-label="Users" className={styles.userMenu}>
          {users.map((u, i) => (
            <li
              key={u.id}
              id={`auth-user-${u.id}`}
              role="option"
              aria-selected={u.id === selectedUserId}
              className={`${styles.userOption} ${i === active ? styles.userOptionActive : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(u.id)}
            >
              <UserAvatar name={u.username} />
              <span className={styles.userName}>{u.username}</span>
              {u.id === selectedUserId && <Check size={14} strokeWidth={2} className={styles.userCheck} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
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
