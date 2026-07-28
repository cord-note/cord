import { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useVaultStore } from '../store/vaults';
import { useNoteStore } from '../store/notes';
import { useTagStore } from '../store/tags';
import { useUIStore } from '../store/ui';
import VaultSidebar from '../components/VaultSidebar';
import NoteList from '../components/NoteList';
import TrashView from '../components/TrashView';
import SettingsPage from '../components/SettingsPage';
import Editor from '../components/Editor';
import styles from './NotesPage.module.css';

export default function NotesPage() {
  const { loadVaults, vaults, activeVaultId, setActiveVault } = useVaultStore();
  const { notes, activeNoteId, activeNoteLoading, loadNotes } = useNoteStore();
  const { loadTags } = useTagStore();
  const { view, setView, openSettings } = useUIStore();

  const [panelCollapsed, setPanelCollapsed] = useState(() => !useVaultStore.getState().activeVaultId);
  // Keep NoteList mounted while the close animation plays, then unmount
  const [noteListMounted, setNoteListMounted] = useState(true);

  useEffect(() => {
    if (!panelCollapsed) {
      setNoteListMounted(true);
    } else {
      const t = setTimeout(() => setNoteListMounted(false), 240);
      return () => clearTimeout(t);
    }
  }, [panelCollapsed]);

  // Initial load
  useEffect(() => {
    loadVaults().then(() => {
      const vid = useVaultStore.getState().activeVaultId;
      if (vid) { loadNotes(vid); loadTags(vid); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload notes+tags on vault switch; collapse panel when no vault.
  // Selecting a vault also reveals the note panel — switching vaults is meant
  // to land you in that vault's notes, which is pointless with the list hidden.
  useEffect(() => {
    if (activeVaultId) { loadNotes(activeVaultId); loadTags(activeVaultId); setPanelCollapsed(false); }
    else setPanelCollapsed(true);
  }, [activeVaultId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Global keyboard shortcuts
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || (e.ctrlKey && !e.altKey)) && e.key === ',') {
      e.preventDefault();
      openSettings('app');
    }
    if ((e.metaKey || (e.ctrlKey && !e.altKey)) && e.key === 't') {
      e.preventDefault();
      setView(view === 'trash' ? 'notes' : 'trash');
    }
    if ((e.metaKey || (e.ctrlKey && !e.altKey)) && e.key === '\\') {
      e.preventDefault();
      setPanelCollapsed((v) => !v);
    }
    if ((e.metaKey || (e.ctrlKey && !e.altKey)) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const idx = vaults.findIndex((v) => v.id === activeVaultId);
      if (idx === -1 || vaults.length < 2) return;
      const next = e.key === 'ArrowDown'
        ? (idx + 1) % vaults.length
        : (idx - 1 + vaults.length) % vaults.length;
      const target = vaults[next];
      if (target) setActiveVault(target.id);
    }
  }, [openSettings, setView, view, vaults, activeVaultId, setActiveVault]);

  // Toggle panel from command palette
  useEffect(() => {
    const onToggle = () => setPanelCollapsed((v) => !v);
    window.addEventListener('corddb:toggle-panel', onToggle);
    return () => window.removeEventListener('corddb:toggle-panel', onToggle);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  const activeNote = notes.find((n) => n.id === activeNoteId);

  function renderMain() {
    if (view === 'settings') return <SettingsPage />;
    if (view === 'trash')    return <TrashView />;
    if (activeNote) {
      // Body is fetched asynchronously after selection — wait for it before
      // mounting the editor so Tiptap initialises with real content. Keyed off
      // an explicit flag, not bodyJson: a new note's body legitimately is '{}'.
      if (activeNoteLoading) {
        return <div className={styles.empty}><p>Loading…</p></div>;
      }
      return <Editor key={activeNote.id} note={activeNote} />;
    }
    return <div className={styles.empty}><p>Select or create a note</p></div>;
  }

  return (
    <div className={styles.layout}>
      <VaultSidebar
        activeView={view === 'trash' ? 'trash' : 'notes'}
        onOpenTrash={() => setView(view === 'trash' ? 'notes' : 'trash')}
      />

      {/* Animated wrapper controls width — NoteList itself is full-width inside */}
      <div className={`${styles.notePanel} ${panelCollapsed ? styles.notePanelCollapsed : ''}`}>
        {noteListMounted && <NoteList />}
      </div>

      <button
        className={`${styles.noteToggle} ${panelCollapsed ? styles.noteToggleClosed : ''}`}
        onClick={() => setPanelCollapsed((v) => !v)}
        title={panelCollapsed ? 'Show notes' : 'Hide notes'}
      >
        <ChevronRight size={13} strokeWidth={2.5} />
      </button>

      <main className={styles.main}>
        {renderMain()}
      </main>
    </div>
  );
}
