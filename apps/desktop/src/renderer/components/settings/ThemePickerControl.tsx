import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useThemeRegistry } from '../../registry/ThemeRegistry';
import { resolveScheme, useThemeStore } from '../../store/theme';
import type { SettingControlProps } from '../../settings/schema';
import styles from '../SettingsPage.module.css';

/**
 * The theme card grid. The selected card follows the theme actually shown,
 * which differs from the setting while a saved augment theme is not loaded.
 */
export function ThemePickerControl({ onChange }: SettingControlProps<string>) {
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const themes = useThemeRegistry((s) => s.themes);
  const [filter, setFilter] = useState('');
  const isDark = resolveScheme(colorScheme) === 'dark';

  const visibleThemes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return themes;
    return themes.filter(
      (t) => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [filter, themes]);

  return (
    <>
      <div className={styles.filterRow}>
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

      {visibleThemes.length === 0 ? (
        <div className={styles.empty}>No themes match “{filter}”.</div>
      ) : (
        <div className={styles.themeGrid}>
          {visibleThemes.map((t) => (
            <button
              key={t.id}
              className={`${styles.themeCard} ${activeTheme === t.id ? styles.themeCardActive : ''}`}
              onClick={() => onChange(t.id)}
            >
              {/* Previews read each theme's own tokens, so a theme's colours are
                  defined once: in global.css, or in its augment's stylesheet. */}
              <div className={styles.themePreview} data-theme={t.id} data-scheme={isDark ? 'dark' : 'light'}>
                <div className={styles.previewSidebar} />
                <div className={styles.previewContent}>
                  <div className={styles.previewAccent} />
                  <div className={styles.previewLines}>
                    <span /><span /><span style={{ width: '60%' }} />
                  </div>
                </div>
              </div>
              <div className={styles.themeCardLabel}>{t.label}</div>
              <div className={styles.themeCardDesc}>{t.description}</div>
              {activeTheme === t.id && <div className={styles.themeCardCheck}>✓</div>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
