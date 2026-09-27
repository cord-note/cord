import { useSettings } from '../../settings';
import { useKeybindingStore } from '../../store/keybindings';
import styles from '../SettingsPage.module.css';

/** What is wrong with the config files, and what Cord is doing about it. */
export function ProblemsBanner({ onOpenJson }: { onOpenJson: () => void }) {
  const problems = useSettings((s) => s.problems);
  const syntaxError = useSettings((s) => s.syntaxError);
  const saveError = useSettings((s) => s.saveError);
  const keybindingError = useKeybindingStore((s) => s.fileError);

  const lines: string[] = [];
  if (syntaxError) {
    lines.push('settings.json has a syntax error. Cord is using the last good values, and changes made here are not saved until the file is fixed.');
  } else {
    const errors = problems.filter((p) => p.severity === 'error').length;
    const warnings = problems.filter((p) => p.severity === 'warning').length;
    if (errors) lines.push(`${errors} invalid value${errors === 1 ? '' : 's'} in settings.json ${errors === 1 ? 'is' : 'are'} using the default.`);
    if (warnings) lines.push(`${warnings} unknown key${warnings === 1 ? '' : 's'} in settings.json ${warnings === 1 ? 'is' : 'are'} kept but ignored.`);
  }
  if (saveError) lines.push(saveError);
  if (keybindingError) lines.push(keybindingError);
  if (lines.length === 0) return null;

  return (
    <div className={styles.problemsColumn}>
      <div className={styles.problemsBanner} role="status">
        {lines.map((l) => <div key={l}>{l}</div>)}
        {(syntaxError || problems.length > 0) && (
          <button className={styles.bannerLink} onClick={onOpenJson}>Open settings.json</button>
        )}
      </div>
    </div>
  );
}
