import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, FileJson } from 'lucide-react';
import { useSettings, useSettingsRegistry } from '../../settings';
import { parseJsoncObject, positionOf, type SettingsProblem } from '../../settings/jsonText';
import { tokenizeJsonc, lineOfKey } from '../../settings/jsonHighlight';
import { resolveValues } from '../../settings/schema';
import { formatAccel } from '../../store/keybindings';
import { useResolvedScheme } from '../../hooks/useResolvedScheme';
import styles from '../SettingsPage.module.css';

const isSave = (e: KeyboardEvent): boolean => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';

interface Located extends SettingsProblem {
  at?: number;
}

/**
 * settings.json as text. Checked as you type; syntax errors block saving,
 * while bad values and unknown keys are only flagged — a bad value falls back
 * to its default and stays reported.
 *
 * The textarea does the typing (undo, IME, selection); a coloured copy of the
 * text is drawn underneath it.
 */
export function JsonView() {
  const fileText = useSettings((s) => s.text);
  const saveText = useSettings((s) => s.saveText);
  const definitions = useSettingsRegistry((s) => s.definitions);
  const scheme = useResolvedScheme();
  const [draft, setDraft] = useState(fileText);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Follow the file while there are no local edits (a reload on focus).
  useEffect(() => {
    if (!dirty) setDraft(fileText);
  }, [fileText, dirty]);

  const problems = useMemo<Located[]>(() => {
    const parsed = parseJsoncObject(draft);
    const found = parsed.data ? resolveValues(definitions, parsed.data).problems : parsed.problems;
    return found.map((p) => {
      const at = p.line ?? (p.key ? lineOfKey(draft, p.key) : undefined);
      return at === undefined ? p : { ...p, at };
    });
  }, [draft, definitions]);
  const blocked = problems.some((p) => p.key === null && p.severity === 'error');

  const tokens = useMemo(() => tokenizeJsonc(draft), [draft]);
  const lineCount = draft.split('\n').length;
  const lineSeverity = useMemo(() => {
    const map = new Map<number, 'error' | 'warning'>();
    for (const p of problems) {
      if (p.at === undefined || map.get(p.at) === 'error') continue;
      map.set(p.at, p.severity);
    }
    return map;
  }, [problems]);

  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;

  async function save(): Promise<void> {
    if (blocked || !dirty) return;
    setSaving(true);
    const result = await saveText(draft);
    setSaving(false);
    if (!result.some((p) => p.key === null)) setDirty(false);
  }

  function revert(): void {
    setDraft(fileText);
    setDirty(false);
  }

  function trackCaret(): void {
    const el = textareaRef.current;
    if (el) setCaret(positionOf(el.value, el.selectionStart));
  }

  /** Puts the caret at the start of `line` and selects the line. */
  function goToLine(line: number): void {
    const el = textareaRef.current;
    if (!el) return;
    const lines = el.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    trackCaret();
    el.closest('[data-json-line-anchor]')
      ?.querySelector(`[data-line="${line}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (isSave(e)) {
      e.preventDefault();
      void save();
      return;
    }
    // Tab inserts two spaces instead of leaving the editor; insertText keeps undo.
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  }

  return (
    <div className={`${styles.problemsColumn} ${styles.jsonView} cord-settings__json`}>
      <div className={styles.jsonCard}>
        <div className={styles.jsonBar}>
          <div className={styles.jsonFile}>
            <FileJson size={14} strokeWidth={1.75} />
            <span className={styles.jsonFileName}>settings.json</span>
            <span className={`${styles.jsonState} ${dirty ? styles.jsonStateDirty : ''}`}>
              {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
          </div>
          <div className={styles.settingActions}>
            <button className={styles.secondaryBtn} onClick={revert} disabled={!dirty}>
              Revert
            </button>
            <button
              className={`${styles.secondaryBtn} ${dirty && !blocked ? styles.jsonSaveReady : ''}`}
              onClick={() => { void save(); }}
              disabled={!dirty || blocked || saving}
              title={blocked ? 'Fix the syntax errors first' : `Save (${formatAccel('Mod+S')})`}
            >
              Save
            </button>
          </div>
        </div>

        {/* sh-root carries Shuttle's code colours, so this matches code blocks in notes. */}
        <div className="sh-root" data-sh-scheme={scheme}>
          <div className={styles.jsonCode} data-json-line-anchor>
            <div className={styles.jsonGutter} aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => {
                const severity = lineSeverity.get(i + 1);
                return (
                  <div
                    key={i}
                    data-line={i + 1}
                    className={[
                      styles.jsonLineNo,
                      i + 1 === caret.line ? styles.jsonLineNoCurrent : '',
                      severity === 'error' ? styles.jsonLineNoError : '',
                      severity === 'warning' ? styles.jsonLineNoWarning : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {i + 1}
                  </div>
                );
              })}
            </div>
            <div className={styles.jsonScroll}>
              <div className={styles.jsonLayers}>
                <pre className={styles.jsonHighlight} aria-hidden="true">
                  {tokens.map((t, i) =>
                    t.kind === 'plain'
                      ? t.text
                      : <span key={i} className={styles[`tok_${t.kind}`]}>{t.text}</span>)}
                  {'\n'}
                </pre>
                <textarea
                  ref={textareaRef}
                  className={styles.jsonInput}
                  value={draft}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  wrap="off"
                  aria-label="settings.json"
                  onChange={(e) => { setDraft(e.target.value); setDirty(true); trackCaret(); }}
                  onKeyDown={onKeyDown}
                  onKeyUp={trackCaret}
                  onClick={trackCaret}
                  onSelect={trackCaret}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.jsonStatus}>
          <span>Ln {caret.line}, Col {caret.column}</span>
          <span className={styles.jsonStatusSep} />
          {problems.length === 0 ? (
            <span className={styles.jsonStatusOk}>
              <CheckCircle2 size={12} strokeWidth={2} /> No problems
            </span>
          ) : (
            <span>
              {errors > 0 && `${errors} ${errors === 1 ? 'error' : 'errors'}`}
              {errors > 0 && warnings > 0 && ', '}
              {warnings > 0 && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`}
            </span>
          )}
          <span className={styles.jsonStatusHint}>JSON with comments · only changed values are stored</span>
        </div>
      </div>

      {problems.length > 0 && (
        <ul className={styles.problemList}>
          {problems.map((p, i) => {
            const Icon = p.severity === 'error' ? AlertCircle : AlertTriangle;
            return (
              <li key={i}>
                <button
                  className={`${styles.problemItem} ${p.severity === 'error' ? styles.problemError : styles.problemWarning}`}
                  onClick={() => { if (p.at !== undefined) goToLine(p.at); }}
                  disabled={p.at === undefined}
                >
                  <Icon size={13} strokeWidth={2} className={styles.problemIcon} />
                  <span className={styles.problemMessage}>{p.message}</span>
                  {p.at !== undefined && <span className={styles.problemLine}>Line {p.at}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
