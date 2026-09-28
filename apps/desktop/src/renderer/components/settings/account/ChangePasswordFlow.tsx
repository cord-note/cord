import { useState } from 'react';
import { api } from '../../../ipc';
import { Actions, Button, Field, InlineError, Result, StepDots, useStepAction, type Phase } from './shared';
import styles from './AccountFlows.module.css';

export function ChangePasswordFlow({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'step', index: 0 });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const { busy, error, run } = useStepAction((message) => setPhase({ kind: 'failed', message, retryStep: 1 }));

  if (phase.kind === 'done') {
    return (
      <Result ok title="Password changed"
        detail="Use it to sign in, to change your PIN and after too many wrong PINs. Your PIN and recovery key are unchanged."
        onDone={onClose} />
    );
  }
  if (phase.kind === 'failed') {
    return (
      <Result ok={false} title="Password not changed" detail={`${phase.message} Your old password still works.`}
        onDone={onClose} onRetry={() => setPhase({ kind: 'step', index: phase.retryStep })} />
    );
  }

  if (phase.index === 0) {
    return (
      <form className={styles.form} onSubmit={(e) => run(e, async () => {
        await api.auth.verifyPassword({ password: current });
        setPhase({ kind: 'step', index: 1 });
      })}>
        <StepDots index={0} count={2} />
        <p className={styles.intro}>Enter your current password.</p>
        <Field id="pw-flow-current" label="Current password" value={current} onChange={setCurrent}
          autoComplete="current-password" autoFocus disabled={busy} />
        <InlineError error={error} />
        <Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" primary disabled={busy || !current}>{busy ? 'Checking…' : 'Continue'}</Button>
        </Actions>
      </form>
    );
  }

  return (
    <form className={styles.form} onSubmit={(e) => run(e, async () => {
      if (next !== repeat) throw new Error('The passwords do not match.');
      await api.auth.changePassword({ currentPassword: current, newPassword: next });
      setPhase({ kind: 'done' });
    })}>
      <StepDots index={1} count={2} />
      <p className={styles.intro}>Choose a new password.</p>
      <Field id="pw-flow-new" label="New password" value={next} onChange={setNext}
        autoComplete="new-password" autoFocus disabled={busy} />
      <Field id="pw-flow-repeat" label="Repeat new password" value={repeat} onChange={setRepeat}
        autoComplete="new-password" disabled={busy} />
      <InlineError error={error} />
      <Actions>
        <Button onClick={() => setPhase({ kind: 'step', index: 0 })} disabled={busy}>Back</Button>
        <Button type="submit" primary disabled={busy || !next || !repeat}>{busy ? 'Saving…' : 'Change password'}</Button>
      </Actions>
    </form>
  );
}
