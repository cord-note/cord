import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import AppIcon from './icons/AppIcon';
import { useAuthStore } from '../store/auth';
import styles from './LoginScreen.module.css';

export default function LoginScreen() {
  const { hasUsers, login, register } = useAuthStore();

  // If no users exist yet, default to register view
  const [mode, setMode] = useState<'login' | 'register'>(() => hasUsers ? 'login' : 'register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  // The error panel collapses rather than unmounting, so it needs the last
  // message to stay rendered while it animates shut.
  const lastError = useRef('');
  if (error) lastError.current = error;

  useEffect(() => { usernameRef.current?.focus(); }, [mode]);

  // Sync mode when hasUsers changes (e.g. after first registration)
  useEffect(() => {
    if (!hasUsers) setMode('register');
  }, [hasUsers]);

  function clearForm() {
    setUsername('');
    setPassword('');
    setConfirm('');
    setError('');
  }

  function switchMode(next: 'login' | 'register') {
    clearForm();
    setMode(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (password !== confirm) { setError('Passwords do not match.'); return; }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        {/* Logo / wordmark */}
        <div className={styles.logoRow}>
          <AppIcon size={22} className={styles.logoIcon} />
          <span className={styles.logoName}>Cord</span>
        </div>

        {/* Keyed so the copy crossfades on mode change instead of snapping. */}
        <h1 key={`h-${mode}`} className={styles.heading}>
          {isLogin ? 'Welcome back' : 'Create your account'}
        </h1>
        <p key={`s-${mode}`} className={styles.subheading}>
          {isLogin
            ? 'Sign in to access your notes'
            : 'Set a username and password to protect your notes'}
        </p>

        {/* Tab switcher — only shown when users exist */}
        {hasUsers && (
          <div className={styles.tabs} role="tablist">
            {/* One moving pill rather than a background that jumps between two
                buttons — the motion is what tells you which way you switched. */}
            <span
              className={`${styles.tabThumb} ${isLogin ? '' : styles.tabThumbRight}`}
              aria-hidden="true"
            />
            <button
              role="tab"
              aria-selected={isLogin}
              className={`${styles.tab} ${isLogin ? styles.tabActive : ''}`}
              onClick={() => switchMode('login')}
            >
              Sign in
            </button>
            <button
              role="tab"
              aria-selected={!isLogin}
              className={`${styles.tab} ${!isLogin ? styles.tabActive : ''}`}
              onClick={() => switchMode('register')}
            >
              Register
            </button>
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {/* Username */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="auth-username">Username</label>
            <input
              ref={usernameRef}
              id="auth-username"
              className={styles.input}
              type="text"
              autoComplete={isLogin ? 'username' : 'off'}
              spellCheck={false}
              placeholder="e.g. alice"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          {/* Password */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="auth-password">Password</label>
            <div className={styles.passwordRow}>
              <input
                id="auth-password"
                className={styles.input}
                type={showPw ? 'text' : 'password'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder={isLogin ? '••••••••' : 'At least 8 characters'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
              <button
                type="button"
                className={styles.showPwBtn}
                onClick={() => setShowPw((v) => !v)}
                tabIndex={-1}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
              </button>
            </div>
          </div>

          {/* Confirm password (register only).
              Rendered in both modes and collapsed with a grid-row transition:
              mounting and unmounting it is what made the card jump. */}
          <div className={`${styles.collapsible} ${!isLogin ? styles.collapsibleOpen : ''}`}>
            <div className={styles.collapsibleInner}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="auth-confirm">Confirm Password</label>
                <input
                  id="auth-confirm"
                  className={styles.input}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={loading || isLogin}
                  tabIndex={isLogin ? -1 : undefined}
                  aria-hidden={isLogin}
                  required={!isLogin}
                />
              </div>
            </div>
          </div>

          {/* Error — collapses for the same reason. */}
          <div className={`${styles.collapsible} ${error ? styles.collapsibleOpen : ''}`}>
            <div className={styles.collapsibleInner}>
              <div className={styles.error} role="alert">{error || lastError.current}</div>
            </div>
          </div>

          {/* Submit */}
          <button type="submit" className={styles.submitBtn} disabled={loading || !username || !password}>
            {loading
              ? (isLogin ? 'Signing in…' : 'Creating account…')
              : (isLogin ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <p className={styles.disclaimer}>
          Your notes are stored locally and encrypted with bcrypt.
          No data ever leaves your device.
        </p>
      </div>
    </div>
  );
}
