import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, PinField, isPin, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

/** A setup step: no way around it except closing Cord, which leaves the user PIN-less for next time. */
export function SetPinView() {
  const setPin = useAuthStore((s) => s.setPin);
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (pin !== confirm) throw new Error('PINs do not match.');
    await setPin(pin);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <PinField id="auth-new-pin" label="PIN" value={pin} onChange={setPinValue} disabled={loading} autoFocus />
      <PinField id="auth-confirm-pin" label="Repeat PIN" value={confirm} onChange={setConfirm} disabled={loading} />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !isPin(pin) || !confirm}>
        {loading ? 'Saving…' : 'Set PIN'}
      </button>
    </form>
  );
}
