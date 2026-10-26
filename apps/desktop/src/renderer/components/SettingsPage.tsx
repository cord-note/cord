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
  const clickedRef = useRef(false);
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

  // Highlight the chapter being read: the last one whose top has passed a line
  // a little below the header. The observer this replaces only saw sections
  // that crossed its edge, so a short section above could keep the highlight.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || jsonOpen) return;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      if (clickedRef.current) return;
      const line = root.getBoundingClientRect().top + 140;
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 4;
      let current: string | null = null;
      for (const c of chapters) {
        const el = chapterRefs.current[c.anchor];
        if (el && el.getBoundingClientRect().top <= line) current = c.anchor;
      }
      if (atEnd) current = chapters[chapters.length - 1]?.anchor ?? current;
      if (current) setActiveAnchor(current);
    };
    const onScroll = (): void => { if (!frame) frame = requestAnimationFrame(update); };
    // A chapter picked in the nav keeps the highlight until the user scrolls themself.
    const release = (): void => { clickedRef.current = false; };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('wheel', release, { passive: true });
    root.addEventListener('pointerdown', release);
    root.addEventListener('keydown', release);
    update();
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('wheel', release);
      root.removeEventListener('pointerdown', release);
      root.removeEventListener('keydown', release);
      if (frame) cancelAnimationFrame(frame);
    };
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
                  onClick={() => { setJsonOpen(false); clickedRef.current = true; setActiveAnchor(c.anchor); requestAnimationFrame(() => scrollTo(c.anchor)); }}
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
