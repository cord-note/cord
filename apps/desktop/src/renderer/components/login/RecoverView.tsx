import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PasswordField, TextField, useSelectedUser, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function RecoverView() {
  const recover = useAuthStore((s) => s.recover);
  const setView = useAuthStore((s) => s.setView);
  const selected = useSelectedUser();
  const [username, setUsername] = useState(selected?.username ?? '');
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Passwords do not match.');
    await recover(username, key, password);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <TextField
        id="auth-username" label="Username" value={username} onChange={setUsername}
        autoComplete="username" disabled={loading}
      />
      <TextField
        id="auth-recovery-key" label="Recovery key" value={key} onChange={setKey}
        autoComplete="off" placeholder="XXXX-XXXX-…" mono disabled={loading} autoFocus
      />
      <PasswordField
        id="auth-password" label="New password" value={password} onChange={setPassword}
        autoComplete="new-password" disabled={loading}
      />
      <PasswordField
        id="auth-confirm" label="Repeat password" value={confirm} onChange={setConfirm}
        autoComplete="new-password" disabled={loading}
      />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !username || !key || !password || !confirm}>
        {loading ? 'Checking…' : 'Reset password'}
      </button>
      <LinkRow links={[{ label: 'Back', onClick: () => setView('password') }]} />
    </form>
  );
}
