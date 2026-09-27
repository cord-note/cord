import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function RecoveryKeyView() {
  const recoveryKey = useAuthStore((s) => s.recoveryKey) ?? '';
  const finishSetup = useAuthStore((s) => s.finishSetup);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const { loading, error, onSubmit } = useSubmit(finishSetup);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={`${styles.keyBox} cord-login__recovery-key`}>
        {/* Two rows of four groups, so the key never wraps mid-group. */}
        <code>{recoveryKey.slice(0, 20)}<br />{recoveryKey.slice(20)}</code>
        <button type="button" className={styles.showPwBtn} onClick={() => void copy()} aria-label="Copy recovery key">
          {copied ? <Check size={15} strokeWidth={1.75} /> : <Copy size={15} strokeWidth={1.75} />}
        </button>
      </div>
      <p className={styles.hint}>
        Write it down or keep it in a password manager. It is shown only now. Without it, a forgotten password can’t be reset.
      </p>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I’ve saved my recovery key
      </label>
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !saved}>
        {loading ? 'Opening…' : 'Continue'}
      </button>
    </form>
  );
}
