import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PasswordField, PinField, UserPicker, isPin, useSelectedUser, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function ForgotPinView() {
  const forgotPin = useAuthStore((s) => s.forgotPin);
  const setView = useAuthStore((s) => s.setView);
  const user = useSelectedUser();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (pin !== confirm) throw new Error('PINs do not match.');
    if (user) await forgotPin(user.username, password, pin);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <UserPicker disabled={loading} />
      <PasswordField
        id="auth-password" label="Password" value={password} onChange={setPassword}
        autoComplete="current-password" disabled={loading} autoFocus
      />
      <PinField id="auth-new-pin" label="New PIN" value={pin} onChange={setPin} disabled={loading} />
      <PinField id="auth-confirm-pin" label="Repeat PIN" value={confirm} onChange={setConfirm} disabled={loading} />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !user || !password || !isPin(pin) || !confirm}>
        {loading ? 'Saving…' : 'Set new PIN'}
      </button>
      <LinkRow links={[
        { label: 'Back', onClick: () => setView('pin') },
        { label: 'Forgot password?', onClick: () => setView('recover') },
      ]} />
    </form>
  );
}
