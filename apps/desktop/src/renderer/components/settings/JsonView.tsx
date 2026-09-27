import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useSettings, useSettingsRegistry } from '../../settings';
import { parseJsoncObject, type SettingsProblem } from '../../settings/jsonText';
import { resolveValues } from '../../settings/schema';
import { formatAccel } from '../../store/keybindings';
import styles from '../SettingsPage.module.css';

const isSave = (e: KeyboardEvent): boolean => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';

/**
 * settings.json as text. Checked as you type; syntax errors block saving,
 * while bad values and unknown keys are only flagged — a bad value falls back
 * to its default and stays reported.
 */
export function JsonView() {
  const fileText = useSettings((s) => s.text);
  const saveText = useSettings((s) => s.saveText);
  const definitions = useSettingsRegistry((s) => s.definitions);
  const [draft, setDraft] = useState(fileText);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Follow the file while there are no local edits (a reload on focus).
  useEffect(() => {
    if (!dirty) setDraft(fileText);
  }, [fileText, dirty]);

  const problems = useMemo<SettingsProblem[]>(() => {
    const parsed = parseJsoncObject(draft);
    return parsed.data ? resolveValues(definitions, parsed.data).problems : parsed.problems;
  }, [draft, definitions]);
  const blocked = problems.some((p) => p.key === null && p.severity === 'error');

  async function save(): Promise<void> {
    if (blocked || !dirty) return;
    setSaving(true);
    const result = await saveText(draft);
    setSaving(false);
    if (!result.some((p) => p.key === null)) setDirty(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (isSave(e)) {
      e.preventDefault();
      void save();
      return;
    }
    // Tab inserts two spaces instead of leaving the editor.
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      setDraft(`${draft.slice(0, start)}  ${draft.slice(end)}`);
      setDirty(true);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
    }
  }

  return (
    <div className={`${styles.problemsColumn} ${styles.jsonView} cord-settings__json`}>
      <div className={styles.jsonBar}>
        <span className={styles.fieldHint}>
          ~/.cord/settings.json — only values that differ from their default. Comments are allowed.
        </span>
        <div className={styles.settingActions}>
          <button
            className={styles.secondaryBtn}
            onClick={() => { setDraft(fileText); setDirty(false); }}
            disabled={!dirty}
          >
            Revert
          </button>
          <button
            className={styles.secondaryBtn}
            onClick={() => { void save(); }}
            disabled={!dirty || blocked || saving}
            title={blocked ? 'Fix the syntax errors first' : `Save (${formatAccel('Mod+S')})`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <textarea
        className={styles.jsonEditor}
        value={draft}
        spellCheck={false}
        aria-label="settings.json"
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onKeyDown={onKeyDown}
      />

      {problems.length > 0 && (
        <ul className={styles.problemList}>
          {problems.map((p, i) => (
            <li key={i} className={p.severity === 'error' ? styles.problemError : styles.problemWarning}>
              {p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
