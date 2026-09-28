import { useState } from 'react';
import { api } from '../../../ipc';
import { Actions, Button, Field, InlineError, Result, StepDots, isPin, useStepAction, type Phase } from './shared';
import styles from './AccountFlows.module.css';

export function ChangePinFlow({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'step', index: 0 });
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const { busy, error, run } = useStepAction((message) => setPhase({ kind: 'failed', message, retryStep: 1 }));

  if (phase.kind === 'done') {
    return <Result ok title="PIN changed" detail="Use your new PIN the next time you unlock Cord." onDone={onClose} />;
  }
  if (phase.kind === 'failed') {
    return (
      <Result
        ok={false}
        title="PIN not changed"
        detail={`${phase.message} Your old PIN still works.`}
        onDone={onClose}
        onRetry={() => setPhase({ kind: 'step', index: phase.retryStep })}
      />
    );
  }

  if (phase.index === 0) {
    return (
      <form className={styles.form} onSubmit={(e) => run(e, async () => {
        await api.auth.verifyPassword({ password });
        setPhase({ kind: 'step', index: 1 });
      })}>
        <StepDots index={0} count={2} />
        <p className={styles.intro}>First, confirm it’s you with your password.</p>
        <Field id="pin-flow-password" label="Password" value={password} onChange={setPassword}
          autoComplete="current-password" autoFocus disabled={busy} />
        <InlineError error={error} />
        <Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" primary disabled={busy || !password}>{busy ? 'Checking…' : 'Continue'}</Button>
        </Actions>
      </form>
    );
  }

  return (
    <form className={styles.form} onSubmit={(e) => run(e, async () => {
      if (pin !== repeat) throw new Error('The PINs do not match.');
      await api.auth.setPin({ pin, password });
      setPhase({ kind: 'done' });
    })}>
      <StepDots index={1} count={2} />
      <p className={styles.intro}>Choose a new PIN of 4 to 6 digits.</p>
      <Field id="pin-flow-new" label="New PIN" type="pin" value={pin} onChange={setPin} autoFocus disabled={busy} />
      <Field id="pin-flow-repeat" label="Repeat PIN" type="pin" value={repeat} onChange={setRepeat} disabled={busy} />
      <InlineError error={error} />
      <Actions>
        <Button onClick={() => setPhase({ kind: 'step', index: 0 })} disabled={busy}>Back</Button>
        <Button type="submit" primary disabled={busy || !isPin(pin) || !repeat}>{busy ? 'Saving…' : 'Change PIN'}</Button>
      </Actions>
    </form>
  );
}
