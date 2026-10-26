import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, ChevronRight, Copy, FolderOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { useThemeLibrary } from '../../store/themeLibrary';
import type { SettingControlProps } from '../../settings/schema';
import { log } from '../../lib/log';
import styles from '../SettingsPage.module.css';

/** The theme library folder: where it is, change it, re-read it, and what went wrong. */
export function ThemeLibraryControl({ value, onChange }: SettingControlProps<string>) {
  const { dir, defaultDir, themes, problems, scanning, error, scan } = useThemeLibrary();
  const [showDetails, setShowDetails] = useState(false);
  const shown = value || defaultDir || dir;
  const filtered = themes.filter((t) => t.dropped.length > 0);
  const issueCount = problems.length + filtered.length;

  async function choose() {
    try {
      const picked = await open({ directory: true, multiple: false, title: 'Choose a theme folder', ...(shown ? { defaultPath: shown } : {}) });
      if (typeof picked === 'string' && picked) onChange(picked);
    } catch (err) {
      log('error', 'themes', 'Choosing the theme folder failed', err);
    }
  }

  return (
    <div className={styles.libraryControl}>
      <div className={styles.libraryPathRow}>
        <FolderOpen size={14} strokeWidth={1.75} className={styles.libraryPathIcon} />
        <span className={styles.libraryPath} title={shown}>{shown || '…'}</span>
        {!value && <span className={styles.libraryBadge}>Default</span>}
        <button
          className={styles.iconBtn}
          onClick={() => { void navigator.clipboard.writeText(shown); }}
          title="Copy path"
          aria-label="Copy path"
        >
          <Copy size={13} strokeWidth={1.75} />
        </button>
      </div>

      <div className={styles.libraryActions}>
        <button className={styles.secondaryBtn} onClick={() => void choose()}>Change…</button>
        {value && (
          <button className={styles.secondaryBtn} onClick={() => onChange('')}>
            <RotateCcw size={13} strokeWidth={1.75} /> Use default
          </button>
        )}
        <button className={styles.secondaryBtn} onClick={() => void scan()} disabled={scanning}>
          <RefreshCw size={13} strokeWidth={1.75} className={scanning ? styles.spin : ''} /> Rescan
        </button>
        <span className={styles.librarySummary}>
          {error ? '' : `${themes.length} ${themes.length === 1 ? 'theme' : 'themes'}`}
        </span>
      </div>

      {error && <div className={styles.libraryError}>{error}</div>}

      {issueCount > 0 && (
        <div className={styles.libraryIssues}>
          <button className={styles.libraryIssuesToggle} onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
            <ChevronRight size={13} strokeWidth={2} className={showDetails ? styles.chevronOpen : ''} />
            <AlertTriangle size={13} strokeWidth={1.75} />
            {problems.length > 0 && `${problems.length} ${problems.length === 1 ? 'file' : 'files'} skipped`}
            {problems.length > 0 && filtered.length > 0 && ' · '}
            {filtered.length > 0 && `${filtered.length} ${filtered.length === 1 ? 'theme' : 'themes'} had rules left out`}
          </button>
          {showDetails && (
            <ul className={styles.libraryIssueList}>
              {problems.map((p) => (
                <li key={p.path}>
                  <span className={styles.libraryIssuePath}>{p.path}</span>
                  <span>{p.message}</span>
                </li>
              ))}
              {filtered.map((t) => (
                <li key={t.id}>
                  <span className={styles.libraryIssuePath}>{t.label} — only the public theme API is loaded</span>
                  {t.dropped.slice(0, 8).map((d, i) => <span key={i} className={styles.libraryDropped}>{d}</span>)}
                  {t.dropped.length > 8 && <span className={styles.libraryDropped}>…and {t.dropped.length - 8} more</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
