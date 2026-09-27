import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  KEYBINDINGS,
  KEYBINDING_GROUPS,
  conflictsFor,
  eventToAccel,
  formatAccel,
  keybindingDef,
  useKeybindingStore,
  type KeybindingId,
} from '../../store/keybindings';
import { KeyChord } from '../KeyChord';
import styles from '../SettingsPage.module.css';

export default function KeyboardPage() {
  const { bindings, setBinding, clearBinding, resetBinding, resetAll } = useKeybindingStore();
  const [recording, setRecording] = useState<KeybindingId | null>(null);

  // While recording, the whole keyboard belongs to the row being edited —
  // otherwise the chord you are trying to assign fires the action it is
  // currently assigned to.
  useEffect(() => {
    if (!recording) return;

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(null); return; }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (recording) clearBinding(recording);
        setRecording(null);
        return;
      }
      const accel = eventToAccel(e);
      // A bare modifier press is the user still assembling the chord.
      if (!accel || !recording) return;
      setBinding(recording, accel);
      setRecording(null);
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, setBinding, clearBinding]);

  return (
    <>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldHint}>
          Click a shortcut to record a new one. Esc cancels, Backspace unbinds.
          Editor shortcuts take precedence over the ones the editor ships with.
        </div>
      </div>

      {KEYBINDING_GROUPS.map((group) => (
        <div key={group} className={`${styles.field} cord-settings__field`}>
          <div className={styles.fieldLabel}>{group}</div>
          <ul className={styles.keyList}>
            {KEYBINDINGS.filter((d) => d.group === group).map((def) => {
              const accel = bindings[def.id];
              const conflicts = conflictsFor(bindings, def.id);
              const isRecording = recording === def.id;
              return (
                <li key={def.id} className={styles.keyRow}>
                  <div className={styles.keyLabelCol}>
                    <span className={styles.keyLabel}>{def.label}</span>
                    {def.hint && <span className={styles.keyHint}>{def.hint}</span>}
                    {conflicts.length > 0 && (
                      <span className={styles.keyConflict}>
                        Also bound to {conflicts.map((id) => keybindingDef(id).label).join(', ')}
                      </span>
                    )}
                  </div>

                  <button
                    className={[
                      styles.keyChord,
                      isRecording ? styles.keyChordRecording : '',
                      !accel ? styles.keyChordUnset : '',
                      conflicts.length > 0 ? styles.keyChordConflict : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setRecording(isRecording ? null : def.id)}
                    title={isRecording ? 'Press a key combination' : 'Click to rebind'}
                  >
                    {isRecording ? 'Press keys…' : accel ? <KeyChord accel={accel} /> : 'Unbound'}
                  </button>

                  <button
                    className={styles.keyReset}
                    onClick={() => { setRecording(null); resetBinding(def.id); }}
                    disabled={accel === def.defaultAccel}
                    title={
                      def.defaultAccel
                        ? `Reset to ${formatAccel(def.defaultAccel)}`
                        : 'Reset to unbound'
                    }
                    aria-label={`Reset ${def.label} shortcut`}
                  >
                    <RotateCcw size={13} strokeWidth={1.75} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className={`${styles.field} cord-settings__field`}>
        <button
          className={styles.secondaryBtn}
          onClick={() => { setRecording(null); resetAll(); }}
        >
          Reset all shortcuts
        </button>
      </div>
    </>
  );
}
