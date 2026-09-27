import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PasswordField, useSelectedUser, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function PasswordView() {
  const login = useAuthStore((s) => s.login);
  const setView = useAuthStore((s) => s.setView);
  const notice = useAuthStore((s) => s.notice);
  const user = useSelectedUser();
  const [password, setPassword] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (user) await login(user.username, password);
  });

  const canUsePin = !!user?.hasPin && !user.pinLocked;

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <PasswordField
        id="auth-password" label="Password" value={password} onChange={setPassword}
        autoComplete="current-password" disabled={loading} autoFocus
      />
      <ErrorPanel error={error || notice || ''} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !user || !password}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
      <LinkRow links={[
        ...(canUsePin ? [{ label: 'Use PIN', onClick: () => setView('pin') }] : []),
        { label: 'Forgot password?', onClick: () => setView('recover') },
        { label: 'New user', onClick: () => setView('register') },
      ]} />
    </form>
  );
}
