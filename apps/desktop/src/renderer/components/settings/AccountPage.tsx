import { useState } from 'react';
import { Dialog } from '../Dialog';
import { ChangePinFlow } from './account/ChangePinFlow';
import { ChangePasswordFlow } from './account/ChangePasswordFlow';
import { RecoveryKeyFlow } from './account/RecoveryKeyFlow';
import styles from '../SettingsPage.module.css';
import own from './AccountPage.module.css';

type Flow = 'pin' | 'password' | 'recoveryKey';

const ROWS: { flow: Flow; title: string; hint: string; button: string }[] = [
  { flow: 'pin',         title: 'PIN',          hint: 'Unlocks Cord day to day. Changing it needs your password.', button: 'Change PIN…' },
  { flow: 'password',    title: 'Password',     hint: 'Needed to change your PIN, and after too many wrong PINs.', button: 'Change password…' },
  { flow: 'recoveryKey', title: 'Recovery key', hint: 'Resets a forgotten password. Make a new one if the old one was lost or seen.', button: 'New recovery key…' },
];

const TITLES: Record<Flow, string> = {
  pin: 'Change PIN',
  password: 'Change password',
  recoveryKey: 'New recovery key',
};

/** Each change is a guided dialog; the page itself only lists what can be changed. */
export default function AccountPage() {
  const [open, setOpen] = useState<Flow | null>(null);
  const close = (): void => setOpen(null);

  return (
    <>
      {ROWS.map((row) => (
        <div key={row.flow} className={`${own.row} cord-settings__field`}>
          <div className={own.text}>
            <div className={styles.fieldLabel}>{row.title}</div>
            <div className={styles.fieldHint}>{row.hint}</div>
          </div>
          <button type="button" className={`${styles.secondaryBtn} ${own.action}`} onClick={() => setOpen(row.flow)}>
            {row.button}
          </button>
        </div>
      ))}

      <Dialog open={open !== null} title={open ? TITLES[open] : ''} onClose={close}>
        {open === 'pin' && <ChangePinFlow onClose={close} />}
        {open === 'password' && <ChangePasswordFlow onClose={close} />}
        {open === 'recoveryKey' && <RecoveryKeyFlow onClose={close} />}
      </Dialog>
    </>
  );
}
