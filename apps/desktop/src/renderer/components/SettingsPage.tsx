import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, RotateCcw } from 'lucide-react';
import { api } from '../ipc';
import { useVaultStore } from '../store/vaults';
import { useTagStore } from '../store/tags';
import { useSettingsStore } from '../store/settings';
import { useUIStore, type SettingsTab } from '../store/ui';
import { useThemeStore, type ColorScheme } from '../store/theme';
import { useThemeRegistry } from '../registry/ThemeRegistry';
import {
  KEYBINDINGS,
  KEYBINDING_GROUPS,
  conflictsFor,
  eventToAccel,
  formatAccel,
  keybindingDef,
  useKeybindingStore,
  type KeybindingId,
} from '../store/keybindings';
import { HoldButton } from './HoldButton';
import { StepSlider } from './StepSlider';
import { HOLD_ARCHIVE_MS } from '@shared/constants';
import {
  VAULT_COLOR_FAMILIES,
  VAULT_SHADE_LABELS,
  DISTINCT_VAULT_COLORS,
  DEFAULT_VAULT_COLOR,
} from '@shared/constants/vaultColors';
import styles from './SettingsPage.module.css';

/** Debounce before a typed vault name is written back to the sidecar. */
const NAME_SAVE_DEBOUNCE_MS = 600;

type ChapterId = 'appearance' | 'editor' | 'keyboard' | 'vault' | 'tags';

/** Nav order, and the order the chapters are rendered in — keep the two in step. */
const CHAPTERS: { id: ChapterId; label: string }[] = [
  { id: 'editor',     label: 'Editor'     },
  { id: 'vault',      label: 'Vault'      },
  { id: 'appearance', label: 'Appearance' },
  { id: 'keyboard',   label: 'Keyboard'   },
  { id: 'tags',       label: 'Tags'       },
];

/**
 * Settings used to be three separate sub-pages. It is now one scrolling
 * document; the old `SettingsTab` values survive as scroll anchors so the
 * command palette's "Appearance"/"Vault settings" commands still land in the
 * right place.
 */
const TAB_TO_CHAPTER: Record<SettingsTab, ChapterId> = {
  appearance: 'appearance',
  app:        'editor',
  vault:      'vault',
};

export default function SettingsPage() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<Partial<Record<ChapterId, HTMLElement | null>>>({});
  // Replaced on mount by whichever chapter the caller asked for; seeded with
  // the first one so the nav highlight matches the top of the page.
  const [activeChapter, setActiveChapter] = useState<ChapterId>('editor');

  function scrollTo(id: ChapterId) {
    chapterRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Jump to whichever chapter the caller asked for when settings opened.
  useEffect(() => {
    const target = TAB_TO_CHAPTER[settingsTab];
    setActiveChapter(target);
    // Wait a frame so the sections have laid out before scrolling to one.
    const raf = requestAnimationFrame(() => {
      chapterRefs.current[target]?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [settingsTab]);

  // Highlight the chapter currently in view.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = visible?.target.getAttribute('data-chapter') as ChapterId | null;
        if (id) setActiveChapter(id);
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const el of Object.values(chapterRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const setChapterRef = (id: ChapterId) => (el: HTMLElement | null) => {
    chapterRefs.current[id] = el;
  };

  return (
    <div className={`${styles.page} cord-settings`}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarLabel}>Settings</div>
        <nav className={`${styles.sidebarNav} cord-settings__nav`}>
          {CHAPTERS.map((c) => (
            <button
              key={c.id}
              className={`${styles.navItem} cord-settings__nav-item ${activeChapter === c.id ? `${styles.navActive} cord-settings__nav-item--active` : ''}`}
              onClick={() => scrollTo(c.id)}
            >
              {c.label}
            </button>
          ))}
        </nav>
        <div className={styles.autosaveNote}>Changes save automatically.</div>
      </div>

      <div className={styles.content} ref={scrollRef}>
        <EditorChapter sectionRef={setChapterRef('editor')} />
        <VaultChapter sectionRef={setChapterRef('vault')} />
        <AppearanceChapter sectionRef={setChapterRef('appearance')} />
        <KeyboardChapter sectionRef={setChapterRef('keyboard')} />
        <TagsChapter sectionRef={setChapterRef('tags')} />
      </div>
    </div>
  );
}

interface ChapterProps {
  sectionRef: (el: HTMLElement | null) => void;
}

// ── Appearance ────────────────────────────────────────────────────────────────

const SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: 'dark',   label: 'Dark'   },
  { id: 'light',  label: 'Light'  },
  { id: 'system', label: 'System' },
];

function AppearanceChapter({ sectionRef }: ChapterProps) {
  const { activeTheme, colorScheme, setTheme, setColorScheme } = useThemeStore();
  const themes = useThemeRegistry((s) => s.themes);
  const [filter, setFilter] = useState('');

  // Subscribing to colorScheme (rather than reading the DOM attribute during
  // render, as this used to) is what makes the previews repaint on mode change.
  const isDark = colorScheme === 'dark'
    || (colorScheme === 'system'
      && typeof window !== 'undefined'
      && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const visibleThemes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return themes;
    return themes.filter(
      (t) => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [filter, themes]);

  return (
    <section className={`${styles.chapter} cord-settings__section`} data-chapter="appearance" ref={sectionRef}>
      <h2 className={`${styles.chapterTitle} cord-settings__section-title`}>Appearance</h2>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldLabel}>Color Mode</div>
        <div className={styles.schemeRow}>
          {SCHEMES.map((s) => (
            <button
              key={s.id}
              className={`${styles.schemeBtn} ${colorScheme === s.id ? styles.schemeBtnActive : ''}`}
              onClick={() => setColorScheme(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldLabel}>Theme</div>
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
                onClick={() => setTheme(t.id)}
              >
                {/* Previews read each theme's own tokens, so a theme's colours are
                    defined once: in global.css, or in its augment's stylesheet. */}
                <div
                  className={styles.themePreview}
                  data-theme={t.id}
                  data-scheme={isDark ? 'dark' : 'light'}
                >
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
      </div>
    </section>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────────

const FONT_PREVIEW_TEXT =
  'The quick brown fox jumps over the lazy dog while the editor renders at this size.';

function EditorChapter({ sectionRef }: ChapterProps) {
  const { editorFontSize, editorLineWidth, spellCheck, distinctVaultColors, update } =
    useSettingsStore();
  const applyDistinctColors = useVaultStore((s) => s.applyDistinctColors);

  /**
   * Turning the setting on is not just a filter on the picker — it repaints
   * the vaults you already have. A rail where half the dots come from the
   * curated set and half don't defeats the point of the setting.
   */
  async function handleDistinctToggle(on: boolean) {
    await update({ distinctVaultColors: on });
    if (!on) return;
    try {
      await applyDistinctColors();
    } catch (err) {
      console.error('Failed to remap vault colors:', err);
    }
  }

  return (
    <section className={`${styles.chapter} cord-settings__section`} data-chapter="editor" ref={sectionRef}>
      <h2 className={`${styles.chapterTitle} cord-settings__section-title`}>Editor</h2>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldLabel}>Font size</div>
        <div className={styles.sliderRow}>
          <StepSlider
            label="Editor font size"
            min={12}
            max={20}
            step={1}
            value={editorFontSize}
            onChange={(v) => update({ editorFontSize: v })}
          />
          <span className={styles.sliderValue}>{editorFontSize}px</span>
        </div>
        <div
          className={styles.fontPreview}
          style={{ fontSize: `${editorFontSize}px` }}
        >
          {FONT_PREVIEW_TEXT}
        </div>
      </div>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldLabel}>Line width</div>
        <div className={styles.sliderRow}>
          <StepSlider
            label="Editor line width"
            min={480}
            max={1200}
            step={40}
            notchStep={120}
            value={editorLineWidth}
            onChange={(v) => update({ editorLineWidth: v })}
          />
          <span className={styles.sliderValue}>{editorLineWidth}px</span>
        </div>
      </div>

      <ToggleField
        label="Spell check"
        hint="Requires restart"
        checked={spellCheck}
        onChange={(v) => update({ spellCheck: v })}
      />

      <ToggleField
        label="Use distinct vault colors"
        hint="Limits the palette to a curated set of high-contrast hues, and repaints existing vaults with their nearest match"
        checked={distinctVaultColors}
        onChange={handleDistinctToggle}
      />
    </section>
  );
}

interface ToggleFieldProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleField({ label, hint, checked, onChange }: ToggleFieldProps) {
  return (
    <div className={`${styles.field} cord-settings__field`}>
      <div className={styles.toggleRow}>
        <div>
          <div className={styles.fieldLabel}>{label}</div>
          {hint && <div className={styles.fieldHint}>{hint}</div>}
        </div>
        <button
          role="switch"
          aria-checked={checked}
          aria-label={label}
          className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
          onClick={() => onChange(!checked)}
        >
          <span className={styles.toggleThumb} />
        </button>
      </div>
    </div>
  );
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

function KeyboardChapter({ sectionRef }: ChapterProps) {
  const { bindings, setBinding, clearBinding, resetBinding, resetAll } = useKeybindingStore();
  const [recording, setRecording] = useState<KeybindingId | null>(null);

  // While recording, the whole keyboard belongs to the row being edited —
  // otherwise the chord you are trying to assign fires the action it is
  // currently assigned to.
  useEffect(() => {
    if (!recording) return;

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(null); return; }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (recording) clearBinding(recording);
        setRecording(null);
        return;
      }
      const accel = eventToAccel(e);
      // A bare modifier press is the user still assembling the chord.
      if (!accel || !recording) return;
      setBinding(recording, accel);
      setRecording(null);
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, setBinding, clearBinding]);

  return (
    <section className={`${styles.chapter} cord-settings__section`} data-chapter="keyboard" ref={sectionRef}>
      <h2 className={`${styles.chapterTitle} cord-settings__section-title`}>Keyboard</h2>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldHint}>
          Click a shortcut to record a new one. Esc cancels, Backspace unbinds.
          Editor shortcuts take precedence over the ones the editor ships with.
        </div>
      </div>

      {KEYBINDING_GROUPS.map((group) => (
        <div key={group} className={`${styles.field} cord-settings__field`}>
          <div className={styles.fieldLabel}>{group}</div>
          <ul className={styles.keyList}>
            {KEYBINDINGS.filter((d) => d.group === group).map((def) => {
              const accel = bindings[def.id];
              const conflicts = conflictsFor(bindings, def.id);
              const isRecording = recording === def.id;
              return (
                <li key={def.id} className={styles.keyRow}>
                  <div className={styles.keyLabelCol}>
                    <span className={styles.keyLabel}>{def.label}</span>
                    {def.hint && <span className={styles.keyHint}>{def.hint}</span>}
                    {conflicts.length > 0 && (
                      <span className={styles.keyConflict}>
                        Also bound to {conflicts.map((id) => keybindingDef(id).label).join(', ')}
                      </span>
                    )}
                  </div>

                  <button
                    className={[
                      styles.keyChord,
                      isRecording ? styles.keyChordRecording : '',
                      !accel ? styles.keyChordUnset : '',
                      conflicts.length > 0 ? styles.keyChordConflict : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setRecording(isRecording ? null : def.id)}
                    title={isRecording ? 'Press a key combination' : 'Click to rebind'}
                  >
                    {isRecording ? 'Press keys…' : (formatAccel(accel) || 'Unbound')}
                  </button>

                  <button
                    className={styles.keyReset}
                    onClick={() => { setRecording(null); resetBinding(def.id); }}
                    disabled={accel === def.defaultAccel}
                    title={
                      def.defaultAccel
                        ? `Reset to ${formatAccel(def.defaultAccel)}`
                        : 'Reset to unbound'
                    }
                    aria-label={`Reset ${def.label} shortcut`}
                  >
                    <RotateCcw size={13} strokeWidth={1.75} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className={`${styles.field} cord-settings__field`}>
        <button
          className={styles.secondaryBtn}
          onClick={() => { setRecording(null); resetAll(); }}
        >
          Reset all shortcuts
        </button>
      </div>
    </section>
  );
}

// ── Vault ─────────────────────────────────────────────────────────────────────

function VaultChapter({ sectionRef }: ChapterProps) {
  const { vaults, activeVaultId, archiveVault, loadVaults } = useVaultStore();
  const { setView } = useUIStore();
  const distinctVaultColors = useSettingsStore((s) => s.distinctVaultColors);
  const vault = vaults.find((v) => v.id === activeVaultId);

  const [name, setName] = useState(vault?.name ?? '');
  const [color, setColor] = useState<string>(vault?.color ?? DEFAULT_VAULT_COLOR);

  // Re-seed the local mirrors when the selected vault changes, so editing one
  // vault's name doesn't leak into the next.
  useEffect(() => {
    setName(vault?.name ?? '');
    setColor(vault?.color ?? DEFAULT_VAULT_COLOR);
  }, [vault?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave the name. The equality check means this never fires on mount or
  // immediately after a save round-trips back through the store.
  useEffect(() => {
    if (!activeVaultId) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === vault?.name) return;
    const timer = setTimeout(async () => {
      try {
        await api.vaults.update(activeVaultId, { name: trimmed });
        await loadVaults();
      } catch (err) {
        console.error('Failed to rename vault:', err);
      }
    }, NAME_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [name, activeVaultId, vault?.name, loadVaults]);

  if (!vault) {
    return (
      <section className={`${styles.chapter} cord-settings__section`} data-chapter="vault" ref={sectionRef}>
        <h2 className={`${styles.chapterTitle} cord-settings__section-title`}>Vault</h2>
        <div className={styles.empty}>No vault selected.</div>
      </section>
    );
  }

  async function handlePickColor(c: string) {
    if (!activeVaultId) return;
    setColor(c); // optimistic — the swatch highlights before the write lands
    try {
      await api.vaults.update(activeVaultId, { color: c });
      await loadVaults();
    } catch (err) {
      console.error('Failed to update vault color:', err);
    }
  }

  async function handleArchive() {
    if (!activeVaultId) return;
    try {
      await archiveVault(activeVaultId);
      setView('notes');
    } catch (err) {
      console.error('Failed to archive vault:', err);
    }
  }

  return (
    <section className={`${styles.chapter} cord-settings__section`} data-chapter="vault" ref={sectionRef}>
      <h2 className={`${styles.chapterTitle} cord-settings__section-title`}>Vault</h2>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldLabel}>Vault name</div>
        <input
          className={styles.textInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldLabel}>Color</div>
        <div className={styles.fieldHint}>
          {distinctVaultColors
            ? 'Showing the curated high-contrast set. Turn off “Use distinct vault colors” for the full palette.'
            : 'Hues across, shades down.'}
        </div>
        {distinctVaultColors ? (
          <div className={styles.distinctPalette}>
            {DISTINCT_VAULT_COLORS.map((c) => (
              <ColorSwatch key={c} color={c} selected={c === color} onPick={handlePickColor} />
            ))}
          </div>
        ) : (
          <div className={styles.palette}>
            {VAULT_COLOR_FAMILIES.map((family) => (
              <div key={family.name} className={styles.paletteColumn}>
                {family.shades.map((c, i) => (
                  <ColorSwatch
                    key={c}
                    color={c}
                    title={`${family.name} ${VAULT_SHADE_LABELS[i]}`}
                    selected={c === color}
                    onPick={handlePickColor}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.dangerLabel}>Danger zone</div>
        <div className={styles.fieldHint}>
          Press and hold to archive “{vault.name}”. You can restore it later.
        </div>
        <HoldButton
          variant="text"
          durationMs={HOLD_ARCHIVE_MS}
          onComplete={handleArchive}
          holdingLabel="Keep holding…"
          className={styles.inlineHoldBtn}
          title={`Hold to archive vault "${vault.name}"`}
        >
          Archive vault
        </HoldButton>
      </div>
    </section>
  );
}

interface ColorSwatchProps {
  color: string;
  selected: boolean;
  onPick: (color: string) => void;
  title?: string;
}

function ColorSwatch({ color, selected, onPick, title }: ColorSwatchProps) {
  return (
    <button
      className={`${styles.colorSwatch} ${selected ? styles.colorSelected : ''}`}
      style={{ background: color }}
      onClick={() => onPick(color)}
      title={title ?? color}
      aria-label={title ?? color}
      aria-pressed={selected}
    />
  );
}

// ── Tags ──────────────────────────────────────────────────────────────────────

function TagsChapter({ sectionRef }: ChapterProps) {
  const { tags, deleteTag } = useTagStore();

  return (
    <section className={`${styles.chapter} cord-settings__section`} data-chapter="tags" ref={sectionRef}>
      <h2 className={`${styles.chapterTitle} cord-settings__section-title`}>Tags</h2>

      {tags.length === 0 ? (
        <div className={styles.empty}>No tags yet. Create tags from the editor.</div>
      ) : (
        <ul className={styles.tagList}>
          {tags.map((tag) => (
            <li key={tag.id} className={styles.tagRow}>
              <span className={styles.tagDot} style={{ background: tag.color ?? 'var(--text-muted)' }} />
              <span className={styles.tagName}>{tag.name}</span>
              <button
                className={styles.tagDeleteBtn}
                onClick={() => { if (confirm(`Delete tag "${tag.name}"?`)) deleteTag(tag.id); }}
                title="Delete tag"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
