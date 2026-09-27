import type { ComponentType } from 'react';
import AppIcon from './icons/AppIcon';
import { useAuthStore, type AuthView } from '../store/auth';
import { PinView } from './login/PinView';
import { PasswordView } from './login/PasswordView';
import { ForgotPinView } from './login/ForgotPinView';
import { RegisterView } from './login/RegisterView';
import { RecoverView } from './login/RecoverView';
import { SetPinView } from './login/SetPinView';
import { RecoveryKeyView } from './login/RecoveryKeyView';
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

export default function LoginScreen() {
  const view = useAuthStore((s) => s.view);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const { title, subtitle } = COPY[view];
  const View = VIEWS[view];

  return (
    <div className={`${styles.screen} cord-login`}>
      <div className={`${styles.card} cord-login__card`}>
        <div className={styles.logoRow}>
          <AppIcon size={22} className={styles.logoIcon} />
          <span className={styles.logoName}>Cord</span>
        </div>

        {/* Keyed so the copy crossfades on view change instead of snapping. */}
        <h1 key={`h-${view}`} className={styles.heading}>{title}</h1>
        <p key={`s-${view}`} className={styles.subheading}>{subtitle}</p>

        {/* Keyed by user too, so switching user clears what was typed. */}
        <View key={`${view}-${selectedUserId ?? ''}`} />

        <p className={styles.disclaimer}>
          Notes are stored only on this device. The PIN keeps other people out of Cord; it does not encrypt your files.
        </p>
      </div>
    </div>
  );
}
