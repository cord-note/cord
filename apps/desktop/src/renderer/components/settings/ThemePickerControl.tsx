import { useMemo, useState, type MouseEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Check, Copy, FileArchive, Folder, GitBranch, LayoutGrid, List, Paintbrush, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useThemeRegistry, type ThemeRegistration } from '../../registry/ThemeRegistry';
import { resolveScheme, useThemeStore } from '../../store/theme';
import { useThemeLibrary } from '../../store/themeLibrary';
import { useContextMenu } from '../../store/contextMenu';
import { log } from '../../lib/log';
import type { SettingControlProps } from '../../settings/schema';
import type { ThemeImportResult } from '@shared/types';
import styles from '../SettingsPage.module.css';

type View = 'grid' | 'list';
const VIEW_KEY = 'cord-theme-gallery-view';

function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}

interface ImportNotice { kind: 'ok' | 'error'; text: string }

/**
 * The theme gallery. The selected theme follows the theme actually shown,
 * which differs from the setting while a saved library theme is not loaded.
 * Previews read each theme's own tokens via data-theme, so a theme's colours
 * are defined once: in global.css, or in its library stylesheet.
 */
export function ThemePickerControl({ onChange }: SettingControlProps<string>) {
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const themes = useThemeRegistry((s) => s.themes);
  const importFrom = useThemeLibrary((s) => s.importFrom);
  const importUrl = useThemeLibrary((s) => s.importUrl);
  const libraryThemes = useThemeLibrary((s) => s.themes);
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<View>(readView);
  const [notice, setNotice] = useState<ImportNotice | null>(null);
  const scheme = resolveScheme(colorScheme);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (t: ThemeRegistration) =>
      !q || [t.label, t.description, t.author ?? ''].some((s) => s.toLowerCase().includes(q));
    return [
      { label: 'Built-in', themes: themes.filter((t) => t.source === 'builtin' && match(t)) },
      { label: 'Library',  themes: themes.filter((t) => t.source === 'library' && match(t)) },
    ];
  }, [filter, themes]);
  const total = groups.reduce((n, g) => n + g.themes.length, 0);

  function changeView(v: View) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-viewer nicety only */ }
  }

  async function runImport(directory: boolean) {
    try {
      const picked = await open(directory
        ? { directory: true, multiple: false, title: 'Import themes from a folder' }
        : { multiple: false, title: 'Import themes from a zip', filters: [{ name: 'Theme pack', extensions: ['zip', 'css'] }] });
      if (typeof picked !== 'string' || !picked) return;
      report(await importFrom(picked), 'Imported');
    } catch (err) {
      fail(err);
    }
  }

  /** Downloads a repo or .zip link; also how "Update from source" works. */
  async function runUrlImport(url: string, verb: 'Imported' | 'Updated') {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      report(await importUrl(url.trim()), verb);
      setRepoOpen(false);
      setRepoUrl('');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function report(result: ThemeImportResult, verb: 'Imported' | 'Updated') {
    const names = result.imported.map((t) => t.label);
    const skipped = result.problems.length;
    setNotice(names.length > 0
      ? { kind: 'ok', text: `${verb} ${names.join(', ')}${skipped ? ` · ${skipped} skipped` : ''}` }
      : { kind: 'error', text: result.problems[0]?.message ?? 'Nothing was imported' });
  }

  function fail(err: unknown) {
    setNotice({ kind: 'error', text: String(err).replace(/^Error:\s*/, '') });
    log('error', 'themes', 'Importing themes failed', err);
  }

  function themeMenu(e: MouseEvent, t: ThemeRegistration) {
    e.preventDefault();
    e.stopPropagation();
    const source = libraryThemes.find((l) => l.id === t.id)?.source ?? null;
    useContextMenu.getState().open(e, [
      { label: 'Use theme', icon: Paintbrush, disabled: activeTheme === t.id, onSelect: () => onChange(t.id) },
      ...(source ? [
        'divider' as const,
        { label: 'Update from source', icon: RefreshCw, onSelect: () => runUrlImport(source, 'Updated') },
        { label: 'Copy source link', icon: Copy, onSelect: () => navigator.clipboard.writeText(source) },
      ] : []),
    ]);
  }

  function openImportMenu(e: MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    useContextMenu.getState().open({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: 'From folder…', icon: Folder, onSelect: () => runImport(true) },
      { label: 'From zip…', icon: FileArchive, onSelect: () => runImport(false) },
      { label: 'From Git repo…', icon: GitBranch, onSelect: () => { setRepoOpen(true); setNotice(null); } },
    ]);
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.galleryBar}>
        <div className={`${styles.filterRow} ${styles.galleryFilter}`}>
          <Search size={13} strokeWidth={1.75} className={styles.filterIcon} />
          <input
            className={styles.filterInput}
            placeholder="Filter themes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className={styles.filterClear} onClick={() => setFilter('')} title="Clear filter">
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>
        <div className={styles.viewToggle} role="group" aria-label="Gallery layout">
          <button
            className={`${styles.viewToggleBtn} ${view === 'grid' ? styles.viewToggleOn : ''}`}
            onClick={() => changeView('grid')}
            aria-pressed={view === 'grid'}
            title="Grid"
          ><LayoutGrid size={14} strokeWidth={1.75} /></button>
          <button
            className={`${styles.viewToggleBtn} ${view === 'list' ? styles.viewToggleOn : ''}`}
            onClick={() => changeView('list')}
            aria-pressed={view === 'list'}
            title="List"
          ><List size={14} strokeWidth={1.75} /></button>
        </div>
        <button className={styles.secondaryBtn} onClick={openImportMenu}>
          <Plus size={13} strokeWidth={2} /> Import
        </button>
      </div>

      {repoOpen && (
        <form
          className={styles.repoForm}
          onSubmit={(e) => { e.preventDefault(); void runUrlImport(repoUrl, 'Imported'); }}
        >
          <div className={`${styles.filterRow} ${styles.repoInput}`}>
            <GitBranch size={13} strokeWidth={1.75} className={styles.filterIcon} />
            <input
              autoFocus
              className={styles.filterInput}
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              disabled={busy}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setRepoOpen(false); }}
              aria-label="Repository link"
              spellCheck={false}
            />
          </div>
          <button type="submit" className={styles.secondaryBtn} disabled={busy || !repoUrl.trim()}>
            {busy ? <><RefreshCw size={13} strokeWidth={1.75} className={styles.spin} /> Downloading…</> : 'Import'}
          </button>
          <button type="button" className={styles.filterClear} onClick={() => setRepoOpen(false)} title="Cancel">
            <X size={12} strokeWidth={2} />
          </button>
          <div className={styles.repoHint}>
            GitHub, GitLab or Codeberg, public repos. Link to a branch or folder to import just that part.
          </div>
        </form>
      )}

      {notice && (
        <div className={`${styles.galleryNotice} ${notice.kind === 'error' ? styles.galleryNoticeError : ''}`}>
          <span>{notice.text}</span>
          <button className={styles.filterClear} onClick={() => setNotice(null)} title="Dismiss">
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      )}

      {total === 0 && filter ? (
        <div className={styles.empty}>No themes match “{filter}”.</div>
      ) : (
        groups.map((g) => (
          <div key={g.label} className={styles.galleryGroup}>
            <div className={styles.galleryGroupLabel}>{g.label}</div>
            {g.themes.length === 0 ? (
              <div className={styles.galleryEmpty}>
                {filter ? 'None match.' : 'No library themes yet. Import a folder or zip, or add themes to the theme folder below.'}
              </div>
            ) : view === 'grid' ? (
              <div className={styles.themeGrid}>
                {g.themes.map((t) => (
                  <button
                    key={t.id}
                    className={`${styles.themeCard} ${activeTheme === t.id ? styles.themeCardActive : ''}`}
                    onClick={() => onChange(t.id)}
                    onContextMenu={(e) => themeMenu(e, t)}
                    aria-pressed={activeTheme === t.id}
                    title={t.description || t.label}
                  >
                    <ThemePreview id={t.id} scheme={scheme} />
                    <div className={styles.themeCardFoot}>
                      <span className={styles.themeCardLabel}>{t.label}</span>
                      {activeTheme === t.id && <Check size={13} strokeWidth={2.5} className={styles.themeCardCheck} />}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.themeList}>
                {g.themes.map((t) => (
                  <button
                    key={t.id}
                    className={`${styles.themeRow} ${activeTheme === t.id ? styles.themeRowActive : ''}`}
                    onClick={() => onChange(t.id)}
                    onContextMenu={(e) => themeMenu(e, t)}
                    aria-pressed={activeTheme === t.id}
                  >
                    <span className={styles.themeSwatches} data-theme={t.id} data-scheme={scheme}>
                      <i style={{ background: 'var(--bg)' }} />
                      <i style={{ background: 'var(--bg-panel)' }} />
                      <i style={{ background: 'var(--text-primary)' }} />
                      <i style={{ background: 'var(--accent)' }} />
                    </span>
                    <span className={styles.themeRowText}>
                      <span className={styles.themeRowName}>{t.label}</span>
                      {t.description && <span className={styles.themeRowDesc}>{t.description}</span>}
                    </span>
                    {t.author && <span className={styles.themeRowAuthor}>{t.author}</span>}
                    <span className={styles.themeRowCheck}>
                      {activeTheme === t.id && <Check size={14} strokeWidth={2.5} />}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** A tiny Cord window drawn with the theme's own tokens. */
function ThemePreview({ id, scheme }: { id: string; scheme: 'light' | 'dark' }) {
  return (
    <div className={styles.themePreview} data-theme={id} data-scheme={scheme} aria-hidden="true">
      <div className={styles.pvRail}>
        <i className={styles.pvDotAccent} /><i /><i />
      </div>
      <div className={styles.pvList}>
        <div className={`${styles.pvRow} ${styles.pvRowActive}`}><b /><i /></div>
        <div className={styles.pvRow}><b /><i /></div>
        <div className={styles.pvRow}><b /><i /></div>
      </div>
      <div className={styles.pvEditor}>
        <b className={styles.pvTitle} />
        <i /><i className={styles.pvLink} /><i className={styles.pvShort} />
        <span className={styles.pvChip} />
      </div>
    </div>
  );
}
