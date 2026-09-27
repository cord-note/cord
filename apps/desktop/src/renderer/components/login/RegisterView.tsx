import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PasswordField, TextField, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function RegisterView() {
  const register = useAuthStore((s) => s.register);
  const selectUser = useAuthStore((s) => s.selectUser);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const hasUsers = useAuthStore((s) => s.lockScreen.users.length > 0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Passwords do not match.');
    await register(username, password);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <TextField
        id="auth-username" label="Username" value={username} onChange={setUsername}
        autoComplete="off" placeholder="e.g. alice" disabled={loading} autoFocus
      />
      <PasswordField
        id="auth-password" label="Password" value={password} onChange={setPassword}
        autoComplete="new-password" placeholder="You’ll need it to change your PIN" disabled={loading}
      />
      <PasswordField
        id="auth-confirm" label="Repeat password" value={confirm} onChange={setConfirm}
        autoComplete="new-password" disabled={loading}
      />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !username || !password || !confirm}>
        {loading ? 'Creating account…' : 'Create account'}
      </button>
      {hasUsers && (
        <LinkRow links={[{ label: 'Back to sign in', onClick: () => void selectUser(selectedUserId) }]} />
      )}
    </form>
  );
}
