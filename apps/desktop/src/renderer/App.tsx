import { useEffect, useRef } from 'react';
import TitleBar from './components/TitleBar';
import LoginScreen from './components/LoginScreen';
import NotesPage from './pages/NotesPage';
import { useAuthStore } from './store/auth';
import { useSettingsStore } from './store/settings';
import { useThemeStore } from './store/theme';
import { checkForUpdate } from './updater';

// Temporary port of the CordDB shell: TitleBar sits above everything,
// LoginScreen shows until authenticated, then the notes workspace.
// (Registry-driven routing is deferred until the migration settles.)

export function App() {
  const { check, user, checking } = useAuthStore();

  // Increments each time the user logs out — forces LoginScreen to remount fresh
  const loginKeyRef = useRef(0);
  const prevUserRef = useRef(user);
  if (prevUserRef.current !== null && user === null) loginKeyRef.current += 1;
  prevUserRef.current = user;

  useEffect(() => {
    useSettingsStore.getState().load();
    useThemeStore.getState().init();
    check();
    // Fire-and-forget: never gates rendering, and swallows its own failures.
    void checkForUpdate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* TitleBar sits above everything — visible on login screen too */}
      <TitleBar />

      {checking ? null : !user ? (
        <LoginScreen key={loginKeyRef.current} />
      ) : (
        <NotesPage />
      )}
    </div>
  );
}
