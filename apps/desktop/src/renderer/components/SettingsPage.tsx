import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Braces, Search, X } from 'lucide-react';
import { registry } from '../registry';
import { useSettings, useSettingsRegistry } from '../settings';
import { filterSettings, modifiedKeys } from '../settings/search';
import type { SettingDefinition } from '../settings/schema';
import { useUIStore, type SettingsTab } from '../store/ui';
import { SettingRow } from './settings/SettingRow';
import { JsonView } from './settings/JsonView';
import { ProblemsBanner } from './settings/ProblemsBanner';
import './settings/pages';
import styles from './SettingsPage.module.css';

/** Sections with a fixed place; any other section follows alphabetically. */
const SECTION_ORDER = ['Editor', 'Appearance', 'Vaults'];

/**
 * The command palette opens Settings at a named place. Old tab names survive
 * as anchors so "Appearance" and "Vault settings" still land correctly.
 */
const TAB_TO_ANCHOR: Record<SettingsTab, string> = {
  appearance: 'section:Appearance',
  app:        'section:Editor',
  vault:      'page:vault',
};

interface Chapter {
  anchor: string;
  label: string;
  settings?: SettingDefinition[];
  page?: ComponentType;
}

function sectionRank(section: string): number {
  const i = SECTION_ORDER.indexOf(section);
  return i === -1 ? SECTION_ORDER.length : i;
}

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

  const chapters = useMemo<Chapter[]>(() => {
    const modified = modifiedKeys(definitions, values);
    const matching = filterSettings(definitions, query, modified);
    const bySection = new Map<string, SettingDefinition[]>();
    for (const def of matching) {
      bySection.set(def.section, [...(bySection.get(def.section) ?? []), def]);
    }
    const sections: Chapter[] = [...bySection.entries()]
      .sort(([a], [b]) => sectionRank(a) - sectionRank(b) || a.localeCompare(b))
      .map(([section, defs]) => ({
        anchor: `section:${section}`,
        label: section,
        settings: [...defs].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
      }));

    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter((w) => w && w !== '@modified');
    const pages: Chapter[] = q.includes('@modified')
      ? []
      : registry.getPages('settings')
        .filter((p) => words.every((w) => p.label.toLowerCase().includes(w)))
        .map((p) => ({ anchor: `page:${p.id}`, label: p.label, page: p.component }));
    return [...sections, ...pages];
  }, [definitions, values, query]);

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
          {chapters.map((c) => (
            <button
              key={c.anchor}
              className={`${styles.navItem} cord-settings__nav-item ${activeAnchor === c.anchor ? `${styles.navActive} cord-settings__nav-item--active` : ''}`}
              onClick={() => { setJsonOpen(false); requestAnimationFrame(() => scrollTo(c.anchor)); }}
            >
              {c.label}
            </button>
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
                {c.settings?.map((def) => <SettingRow key={def.key} definition={def} />)}
                {Page && <Page />}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
