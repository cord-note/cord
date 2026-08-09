import { useState, useRef, useEffect, useCallback } from 'react';
import { Database, Trash2, Settings, LogOut, Plus, Link2, GripVertical } from 'lucide-react';
import { useVaultStore } from '../store/vaults';
import { useNoteStore } from '../store/notes';
import { useTagStore } from '../store/tags';
import { useAuthStore } from '../store/auth';
import { useUIStore } from '../store/ui';
import { useSettingsStore } from '../store/settings';
import { randomVaultColor } from '@shared/constants/vaultColors';
import styles from './VaultSidebar.module.css';

interface Props {
  activeView:  'notes' | 'trash';
  onOpenTrash: () => void;
}

export default function VaultSidebar({ activeView, onOpenTrash }: Props) {
  const [expanded, setExpanded]           = useState(false);
  const [creatingVault, setCreatingVault] = useState(false);
  const [newVaultName, setNewVaultName]   = useState('');
  // Rows are only draggable once the grip is pressed, so dragging a vault row
  // by its label doesn't start a reorder.
  const [dragArmedId, setDragArmedId] = useState<string | null>(null);
  const [draggingId, setDraggingId]   = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Which edges of the vault list have more content past them. Drives the
  // fade cues — the rail hides its scrollbar, so without these there is no
  // sign that the list continues.
  const [canScrollUp, setCanScrollUp]     = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const inputRef   = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const scrollRef  = useRef<HTMLDivElement>(null);

  const { vaults, activeVaultId, setActiveVault, createVault, reorderVaults } = useVaultStore();
  const { loadNotes } = useNoteStore();
  const { loadTags }  = useTagStore();
  const { user, logout } = useAuthStore();
  const { openSettings, view, setView } = useUIStore();
  const distinctVaultColors = useSettingsStore((s) => s.distinctVaultColors);

  const userInitial = user?.username?.[0]?.toUpperCase() ?? '?';

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (expanded && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setExpanded(false);
        setCreatingVault(false);
        setNewVaultName('');
      }
    }
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [expanded]);

  const updateScrollCues = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 1px of slack: fractional scroll heights otherwise leave the bottom cue
    // showing permanently on a list that is already fully scrolled.
    setCanScrollUp(el.scrollTop > 1);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  // Re-measure whenever the list can have changed size.
  useEffect(() => {
    updateScrollCues();
  }, [vaults.length, expanded, creatingVault, updateScrollCues]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // The rail animates its width, which rewraps labels and changes the
    // scrollable height partway through the transition.
    const observer = new ResizeObserver(updateScrollCues);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollCues]);

  function toggleExpanded() {
    setExpanded((v) => !v);
    setCreatingVault(false);
    setNewVaultName('');
  }

  /**
   * Switching vault goes straight to that vault's notes. It deliberately does
   * not touch `expanded` — only the rail's empty area and the Vaults icon
   * control expansion.
   */
  async function handleSelectVault(id: string) {
    setActiveVault(id);
    setView('notes');
    try {
      await Promise.all([loadNotes(id), loadTags(id)]);
    } catch (err) {
      console.error('Failed to load vault data:', err);
    }
  }

  async function handleCreateVault() {
    const name = newVaultName.trim();
    if (!name) return;
    try {
      // createVault already sets the new vault active; land the user in its
      // (empty) notes view rather than leaving them on whatever was open.
      const vault = await createVault({ name, color: randomVaultColor(distinctVaultColors) });
      setCreatingVault(false);
      setNewVaultName('');
      setView('notes');
      await Promise.all([loadNotes(vault.id), loadTags(vault.id)]);
    } catch (err) {
      console.error('Failed to create vault:', err);
    }
  }

  function handleNewVaultKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter')  handleCreateVault();
    if (e.key === 'Escape') { setCreatingVault(false); setNewVaultName(''); }
  }

  function handleTrashClick() {
    onOpenTrash();
  }

  function handleSettingsClick() {
    openSettings();
  }

  async function handleLogout() {
    if (!confirm('Log out?')) return;
    await logout();
  }

  // --- reordering -------------------------------------------------------

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag without payload on the transfer.
    e.dataTransfer.setData('text/plain', id);
  }

  /**
   * Where the drop line goes for a given target row.
   *
   * The splice below removes before it inserts, so dropping onto a row *below*
   * the dragged one lands after it, and onto a row above lands before it. The
   * indicator has to say the same thing, or the drop appears to be off by one.
   */
  function dropsBelow(targetId: string): boolean {
    if (!draggingId) return false;
    const ids = vaults.map((v) => v.id);
    return ids.indexOf(draggingId) < ids.indexOf(targetId);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(id);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) return;
    const ids = vaults.map((v) => v.id);
    const from = ids.indexOf(draggingId);
    const to   = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const [moved] = ids.splice(from, 1);
    if (moved) ids.splice(to, 0, moved);
    reorderVaults(ids);
    resetDrag();
  }

  function resetDrag() {
    setDraggingId(null);
    setDropTargetId(null);
    setDragArmedId(null);
  }

  return (
    <aside ref={sidebarRef} className={`${styles.rail} ${expanded ? styles.railExpanded : ''}`}>

      <div className={styles.toggleRow}>
        <button
          className={styles.sectionToggleBtn}
          onClick={toggleExpanded}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <Database size={15} strokeWidth={1.75} className={styles.sectionToggleIcon} />
          {expanded && <span className={styles.sectionToggleLabel}>Vaults</span>}
        </button>
        {expanded && (
          <button className={styles.addVaultBtn} onClick={() => setCreatingVault(v => !v)} title="New vault">
            <Plus size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Vaults + Connections scroll; the account/settings/trash block below
          never does, so those controls are always reachable. */}
      <div className={styles.scrollWrap}>
        <div className={styles.scrollArea} ref={scrollRef} onScroll={updateScrollCues}>
          <nav className={styles.topNav}>
            {vaults.map((v) => (
              <div
                key={v.id}
                className={[
                  styles.vaultRow,
                  draggingId === v.id ? styles.vaultRowDragging : '',
                  dropTargetId === v.id
                    ? (dropsBelow(v.id) ? styles.vaultRowDropBelow : styles.vaultRowDropAbove)
                    : '',
                ].filter(Boolean).join(' ')}
                draggable={dragArmedId === v.id}
                onDragStart={(e) => handleDragStart(e, v.id)}
                onDragOver={(e) => handleDragOver(e, v.id)}
                onDragLeave={() => setDropTargetId((cur) => (cur === v.id ? null : cur))}
                onDrop={(e) => handleDrop(e, v.id)}
                onDragEnd={resetDrag}
              >
                <button
                  className={`${styles.navBtn} ${v.id === activeVaultId ? styles.navActive : ''}`}
                  onClick={() => handleSelectVault(v.id)}
                  title={v.name}
                >
                  <span className={styles.vaultDot} style={{ background: v.color ?? 'var(--text-muted)' }} />
                  {expanded && <span className={styles.navLabel}>{v.name}</span>}
                </button>
                {expanded && (
                  <span
                    className={styles.dragHandle}
                    title="Drag to reorder"
                    aria-hidden="true"
                    onPointerDown={() => setDragArmedId(v.id)}
                    onPointerUp={() => setDragArmedId(null)}
                  >
                    <GripVertical size={13} strokeWidth={1.75} />
                  </span>
                )}
              </div>
            ))}

            {expanded && creatingVault && (
              <div className={styles.newVaultRow}>
                <input
                  ref={inputRef}
                  autoFocus
                  className={styles.newVaultInput}
                  placeholder="Vault name…"
                  value={newVaultName}
                  onChange={(e) => setNewVaultName(e.target.value)}
                  onKeyDown={handleNewVaultKeyDown}
                />
                <button className={styles.newVaultConfirm} onClick={handleCreateVault} disabled={!newVaultName.trim()}>
                  Add
                </button>
              </div>
            )}

            <button
              className={`${styles.navBtn} ${styles.comingSoon}`}
              title="Connections (coming soon)"
              disabled
            >
              <Link2 size={17} strokeWidth={1.75} className={styles.navIcon} />
              {expanded && <span className={styles.navLabel}>Connections</span>}
            </button>
          </nav>

          {/* Empty rail area doubles as the expand/collapse target. */}
          <div
            className={styles.spacer}
            role="button"
            tabIndex={-1}
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            onClick={toggleExpanded}
          />
        </div>

        {/* Fades, not a scrollbar: the rail is narrow enough that a track
            would eat a meaningful slice of it. */}
        <span
          className={`${styles.scrollCue} ${styles.scrollCueTop} ${canScrollUp ? styles.scrollCueVisible : ''}`}
          aria-hidden="true"
        />
        <span
          className={`${styles.scrollCue} ${styles.scrollCueBottom} ${canScrollDown ? styles.scrollCueVisible : ''}`}
          aria-hidden="true"
        />
      </div>

      <div className={styles.bottomNav}>
        <button
          className={`${styles.navBtn} ${activeView === 'trash' ? styles.navActive : ''}`}
          onClick={handleTrashClick}
          title="Trash"
        >
          <Trash2 size={19} strokeWidth={1.75} className={styles.navIcon} />
          {expanded && <span className={styles.navLabel}>Trash</span>}
        </button>

        <button
          className={`${styles.navBtn} ${view === 'settings' ? styles.navActive : ''}`}
          onClick={handleSettingsClick}
          title="Settings"
        >
          <Settings size={19} strokeWidth={1.75} className={styles.navIcon} />
          {expanded && <span className={styles.navLabel}>Settings</span>}
        </button>

        {/* A div, not a button: the logout control nests inside it, and a
            button inside a button is invalid HTML — React warns about it and
            the inner click target behaves inconsistently across engines. */}
        <div
          className={styles.userRow}
          role="button"
          tabIndex={0}
          onClick={() => { if (!expanded) setExpanded(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true); }
          }}
          title={expanded ? undefined : 'Expand sidebar'}
        >
          <span className={styles.navInitial}>{userInitial}</span>
          {expanded && <span className={styles.navLabel}>{user?.username ?? 'Account'}</span>}
          {expanded && (
            <button className={styles.logoutBtn} onClick={(e) => { e.stopPropagation(); handleLogout(); }} title="Log out">
              <LogOut size={14} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
