import { RotateCcw } from 'lucide-react';
import { useSettings } from '../../settings';
import type { SettingDefinition } from '../../settings/schema';
import { controlFor } from './controls';
import styles from '../SettingsPage.module.css';

// One setting: title, description, control. A changed setting shows a marker
// and a reset button; the key is shown on hover so it can be found in the JSON.

export function SettingRow({ definition }: { definition: SettingDefinition }) {
  const value = useSettings((s) => s.values[definition.key]);
  const set = useSettings((s) => s.set);
  const reset = useSettings((s) => s.reset);
  const modified = !Object.is(value, definition.default);
  const Control = controlFor(definition);
  const inline = definition.type === 'boolean' && !definition.control;

  return (
    <div
      className={`${styles.field} ${styles.settingRow} cord-settings__field ${modified ? `${styles.settingModified} cord-settings__field--modified` : ''}`}
      data-setting={definition.key}
    >
      <div className={inline ? styles.toggleRow : styles.settingHead}>
        <div>
          <div className={styles.fieldLabel}>
            {definition.title}
            <code className={styles.settingKey} title="Setting key in settings.json">{definition.key}</code>
          </div>
          <div className={styles.fieldHint}>{definition.description}</div>
        </div>
        <div className={styles.settingActions}>
          {modified && (
            <button
              className={styles.keyReset}
              onClick={() => reset(definition.key)}
              title="Reset to default"
              aria-label={`Reset ${definition.title} to default`}
            >
              <RotateCcw size={13} strokeWidth={1.75} />
            </button>
          )}
          {inline && <Control value={value} onChange={(v: unknown) => set(definition.key, v)} definition={definition} />}
        </div>
      </div>
      {!inline && <Control value={value} onChange={(v: unknown) => set(definition.key, v)} definition={definition} />}
    </div>
  );
}
