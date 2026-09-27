import type { ComponentType } from 'react';
import AppIcon from './icons/AppIcon';
import Dither from './Dither';
import { useAuthStore, type AuthView } from '../store/auth';
import { PinView } from './login/PinView';
import { PasswordView } from './login/PasswordView';
import { ForgotPinView } from './login/ForgotPinView';
import { RegisterView } from './login/RegisterView';
import { RecoverView } from './login/RecoverView';
import { SetPinView } from './login/SetPinView';
import { RecoveryKeyView } from './login/RecoveryKeyView';
import { UserPicker } from './login/shared';
import styles from './LoginScreen.module.css';

const COPY: Record<AuthView, { title: string; subtitle: string }> = {
  pin:         { title: 'Welcome back',           subtitle: 'Enter your PIN to open Cord' },
  password:    { title: 'Welcome back',           subtitle: 'Enter your password' },
  forgotPin:   { title: 'Choose a new PIN',       subtitle: 'Confirm it’s you with your password' },
  register:    { title: 'Create your account',    subtitle: 'The password protects account changes; a PIN unlocks Cord day to day' },
  recover:     { title: 'Reset your password',    subtitle: 'Use the recovery key you saved when you set up Cord' },
  setPin:      { title: 'Choose a PIN',           subtitle: '4 to 6 digits. You’ll use it to unlock Cord.' },
  recoveryKey: { title: 'Save your recovery key', subtitle: 'It’s the only way back in if you forget your password' },
};

const VIEWS: Record<AuthView, ComponentType> = {
  pin: PinView,
  password: PasswordView,
  forgotPin: ForgotPinView,
  register: RegisterView,
  recover: RecoverView,
  setPin: SetPinView,
  recoveryKey: RecoveryKeyView,
};

/** Views that act on an existing account, so the account can be switched. */
const PICKS_USER: ReadonlySet<AuthView> = new Set(['pin', 'password', 'forgotPin']);

export default function LoginScreen() {
  const view = useAuthStore((s) => s.view);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const { title, subtitle } = COPY[view];
  const View = VIEWS[view];

  return (
    <div className={`${styles.screen} cord-login`}>
      <div className={styles.art}>
        <Dither seed={7} cell={4} shape="square" field="cumulus" from="right" reach={0.6} />
      </div>

      <header className={styles.topBar}>
        <div className={styles.logoRow}>
          <AppIcon size={18} className={styles.logoIcon} />
          <span className={styles.logoName}>Cord</span>
        </div>
        {PICKS_USER.has(view) && <UserPicker />}
      </header>

      <div className={styles.column}>
        <div className={`${styles.card} cord-login__card`}>
          {/* Keyed so the copy crossfades on view change instead of snapping. */}
          <h1 key={`h-${view}`} className={styles.heading}>{title}</h1>
          <p key={`s-${view}`} className={styles.subheading}>{subtitle}</p>

          {/* Keyed by user too, so switching user clears what was typed. */}
          <View key={`${view}-${selectedUserId ?? ''}`} />
        </div>

        <p className={styles.disclaimer}>
          Notes are stored only on this device. The PIN keeps other people out of Cord; it does not encrypt your files.
        </p>
      </div>
    </div>
  );
}
