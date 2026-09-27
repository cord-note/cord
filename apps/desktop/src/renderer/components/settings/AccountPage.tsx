import { useState, type FormEvent } from 'react';
import { api } from '../../ipc';
import styles from '../SettingsPage.module.css';
import own from './AccountPage.module.css';

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One small form: run `action`, show what happened. */
function useAction(action: () => Promise<string>) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      setStatus(await action());
    } catch (err) {
      setStatus(message(err));
    } finally {
      setBusy(false);
    }
  }
  return { status, busy, onSubmit };
}

function ChangePin() {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const { status, busy, onSubmit } = useAction(async () => {
    await api.auth.setPin({ pin, password });
    setPassword('');
    setPin('');
    return 'PIN changed.';
  });
  return (
    <form className={`${styles.field} cord-settings__field`} onSubmit={onSubmit}>
      <div className={styles.fieldLabel}>Change PIN</div>
      <div className={styles.fieldHint}>4 to 6 digits. Needs your password.</div>
      <div className={own.form}>
        <input className={styles.textInput} type="password" placeholder="Password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className={styles.textInput} type="password" inputMode="numeric" placeholder="New PIN" maxLength={6}
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <button type="submit" className={styles.secondaryBtn} disabled={busy || !password || !/^\d{4,6}$/.test(pin)}>
          Change PIN
        </button>
        {status && <div className={styles.fieldHint} role="status">{status}</div>}
      </div>
    </form>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const { status, busy, onSubmit } = useAction(async () => {
    if (next !== confirm) throw new Error('Passwords do not match.');
    await api.auth.changePassword({ currentPassword: current, newPassword: next });
    setCurrent('');
    setNext('');
    setConfirm('');
    return 'Password changed.';
  });
  return (
    <form className={`${styles.field} cord-settings__field`} onSubmit={onSubmit}>
      <div className={styles.fieldLabel}>Change password</div>
      <div className={own.form}>
        <input className={styles.textInput} type="password" placeholder="Current password" autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className={styles.textInput} type="password" placeholder="New password" autoComplete="new-password"
          value={next} onChange={(e) => setNext(e.target.value)} />
        <input className={styles.textInput} type="password" placeholder="Repeat new password" autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button type="submit" className={styles.secondaryBtn} disabled={busy || !current || !next || !confirm}>
          Change password
        </button>
        {status && <div className={styles.fieldHint} role="status">{status}</div>}
      </div>
    </form>
  );
}

function NewRecoveryKey() {
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const { status, busy, onSubmit } = useAction(async () => {
    const { recoveryKey } = await api.auth.issueRecoveryKey({ password });
    setPassword('');
    setKey(recoveryKey);
    return 'Your old recovery key no longer works. Save this one now — it won’t be shown again.';
  });
  return (
    <form className={`${styles.field} cord-settings__field`} onSubmit={onSubmit}>
      <div className={styles.fieldLabel}>Recovery key</div>
      <div className={styles.fieldHint}>Make a new one if the old key was lost or seen by someone else.</div>
      <div className={own.form}>
        <input className={styles.textInput} type="password" placeholder="Password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className={styles.secondaryBtn} disabled={busy || !password}>
          Make a new recovery key
        </button>
        {key && <code className={own.key}>{key}</code>}
        {status && <div className={styles.fieldHint} role="status">{status}</div>}
      </div>
    </form>
  );
}

export default function AccountPage() {
  return (
    <>
      <ChangePin />
      <ChangePassword />
      <NewRecoveryKey />
    </>
  );
}
