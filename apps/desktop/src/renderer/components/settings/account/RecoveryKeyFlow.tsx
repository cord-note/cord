import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { api } from '../../../ipc';
import { Actions, Button, Field, InlineError, Result, StepDots, useStepAction, type Phase } from './shared';
import styles from './AccountFlows.module.css';

export function RecoveryKeyFlow({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'step', index: 0 });
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useStepAction((message) => setPhase({ kind: 'failed', message, retryStep: 0 }));

  if (phase.kind === 'done') {
    return (
      <Result ok title="New recovery key saved"
        detail="Only this key can reset your password now. The old one no longer works."
        onDone={onClose} />
    );
  }
  if (phase.kind === 'failed') {
    return (
      <Result ok={false} title="No new key was made" detail={`${phase.message} Your current recovery key still works.`}
        onDone={onClose} onRetry={() => setPhase({ kind: 'step', index: phase.retryStep })} />
    );
  }

  if (phase.index === 0) {
    return (
      <form className={styles.form} onSubmit={(e) => run(e, async () => {
        await api.auth.verifyPassword({ password });
        const result = await api.auth.issueRecoveryKey({ password });
        setKey(result.recoveryKey);
        setPhase({ kind: 'step', index: 1 });
      })}>
        <StepDots index={0} count={2} />
        <p className={styles.warning}>
          Making a new key <strong>replaces</strong> the one you have. The old key stops working as soon as the new one is shown.
        </p>
        <Field id="key-flow-password" label="Password" value={password} onChange={setPassword}
          autoComplete="current-password" autoFocus disabled={busy} />
        <InlineError error={error} />
        <Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" primary disabled={busy || !password}>{busy ? 'Making key…' : 'Make new key'}</Button>
        </Actions>
      </form>
    );
  }

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(key);
    setCopied(true);
  }

  // No Back and no Cancel: the old key is already gone, so the only way out is
  // through saving this one (closing still works, and the key stays valid).
  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); setPhase({ kind: 'done' }); }}>
      <StepDots index={1} count={2} />
      <p className={styles.intro}>Save this key somewhere safe. It won’t be shown again.</p>
      <div className={`${styles.keyBox} cord-login__recovery-key`}>
        {/* Two rows of four groups, so the key never wraps mid-group. */}
        <code>{key.slice(0, 20)}<br />{key.slice(20)}</code>
        <button type="button" className={styles.copy} onClick={() => void copy()} aria-label="Copy recovery key">
          {copied ? <Check size={15} strokeWidth={1.75} /> : <Copy size={15} strokeWidth={1.75} />}
        </button>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I’ve saved my new recovery key
      </label>
      <Actions>
        <Button type="submit" primary disabled={!saved}>Continue</Button>
      </Actions>
    </form>
  );
}
