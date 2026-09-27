import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PinField, isPin, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function PinView() {
  const unlockWithPin = useAuthStore((s) => s.unlockWithPin);
  const setView = useAuthStore((s) => s.setView);
  const [pin, setPin] = useState('');

  const { loading, error, setError, onSubmit } = useSubmit(async () => {
    const result = await unlockWithPin(pin);
    if (result.ok) return;
    setPin('');
    // At zero the store has already switched to the password view.
    if (result.triesLeft > 0) {
      setError(`Wrong PIN — ${result.triesLeft} ${result.triesLeft === 1 ? 'try' : 'tries'} left.`);
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <PinField id="auth-pin" label="PIN" value={pin} onChange={setPin} disabled={loading} autoFocus hero invalid={!!error} />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !isPin(pin)}>
        {loading ? 'Unlocking…' : 'Unlock'}
      </button>
      <LinkRow links={[
        { label: 'Use password', onClick: () => setView('password') },
        { label: 'Forgot PIN?', onClick: () => setView('forgotPin') },
        { label: 'New user', onClick: () => setView('register') },
      ]} />
    </form>
  );
}
