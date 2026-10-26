import { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Search, X } from 'lucide-react';
import { registry } from '../registry';
import { useSettings, useSettingsRegistry } from '../settings';
import { filterSettings, modifiedKeys } from '../settings/search';
import { buildSettingsNav, chapterAnchor } from '../settings/layout';
import { useUIStore, type SettingsTab } from '../store/ui';
import { SettingRow } from './settings/SettingRow';
import { JsonView } from './settings/JsonView';
import { ProblemsBanner } from './settings/ProblemsBanner';
import './settings/pages';
import styles from './SettingsPage.module.css';

const TAB_TO_ANCHOR: Record<SettingsTab, string> = {
  appearance: chapterAnchor('appearance'),
  app:        chapterAnchor('editor'),
  vault:      chapterAnchor('vault'),
  tags:       chapterAnchor('tags'),
};

export default function SettingsPage() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const definitions = useSettingsRegistry((s) => s.definitions);
  const values = useSettings((s) => s.values);
  const [query, setQuery] = useState('');
  const [jsonOpen, setJsonOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeAnchor, setActiveAnchor] = useState(TAB_TO_ANCHOR[settingsTab]);

  // Re-read the files when Settings opens, in case they were edited elsewhere.
  useEffect(() => { void useSettings.getState().reload(); }, []);

  const groups = useMemo(() => {
    const modified = modifiedKeys(definitions, values);
    const matching = filterSettings(definitions, query, modified);
    const pages = registry.getPages('settings').map((p) => ({ id: p.id, label: p.label, component: p.component }));
    return buildSettingsNav(definitions, matching, pages, query);
  }, [definitions, values, query]);
  const chapters = groups.flatMap((g) => g.chapters);

  function scrollTo(anchor: string) {
    chapterRefs.current[anchor]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Jump to whichever place the caller asked for when settings opened.
  useEffect(() => {
    const target = TAB_TO_ANCHOR[settingsTab];
    setActiveAnchor(target);
    const raf = requestAnimationFrame(() => {
      chapterRefs.current[target]?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [settingsTab]);

  // Highlight the chapter currently in view.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || jsonOpen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const anchor = visible?.target.getAttribute('data-chapter');
        if (anchor) setActiveAnchor(anchor);
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const el of Object.values(chapterRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [chapters, jsonOpen]);

  return (
    <div className={`${styles.page} cord-settings`}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarLabel}>Settings</div>
        <nav className={`${styles.sidebarNav} cord-settings__nav`}>
          {groups.map((g) => (
            <div key={g.label} className={styles.navGroup}>
              <div className={`${styles.navGroupLabel} cord-settings__nav-group`}>{g.label}</div>
              {g.chapters.map((c) => (
                <button
                  key={c.anchor}
                  className={`${styles.navItem} cord-settings__nav-item ${activeAnchor === c.anchor && !jsonOpen ? `${styles.navActive} cord-settings__nav-item--active` : ''}`}
                  onClick={() => { setJsonOpen(false); requestAnimationFrame(() => scrollTo(c.anchor)); }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.autosaveNote}>Changes save automatically.</div>
      </div>

      <div className={styles.content} ref={scrollRef}>
        <div className={styles.settingsHeader}>
          <div className={`${styles.filterRow} ${styles.searchRow} cord-settings__search`}>
            <Search size={13} strokeWidth={1.75} className={styles.filterIcon} />
            <input
              className={styles.filterInput}
              placeholder="Search settings — @modified for changed ones"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setJsonOpen(false); }}
              aria-label="Search settings"
            />
            {query && (
              <button className={styles.filterClear} onClick={() => setQuery('')} title="Clear search">
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
          <button
            className={`${styles.secondaryBtn} ${jsonOpen ? styles.jsonToggleOn : ''}`}
            onClick={() => setJsonOpen((o) => !o)}
            aria-pressed={jsonOpen}
          >
            <Braces size={13} strokeWidth={1.75} /> Edit as JSON
          </button>
        </div>

        <ProblemsBanner onOpenJson={() => setJsonOpen(true)} />

        {jsonOpen ? (
          <JsonView />
        ) : chapters.length === 0 ? (
          <div className={styles.empty}>No settings match “{query}”.</div>
        ) : (
          chapters.map((c) => {
            const Page = c.page;
            return (
              <section
                key={c.anchor}
                className={`${styles.chapter} cord-settings__section`}
                data-chapter={c.anchor}
                ref={(el) => { chapterRefs.current[c.anchor] = el; }}
              >
                <h2 className={`${styles.chapterTitle} cord-settings__section-title`}>{c.label}</h2>
                {Page && <Page />}
                {c.settings.map((def) => <SettingRow key={def.key} definition={def} />)}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
