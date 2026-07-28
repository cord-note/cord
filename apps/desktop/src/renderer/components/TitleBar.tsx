import { useEffect, useRef, useState, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Search, FilePlus, Trash2, Settings, LogOut, FileText, Pin,
  Monitor, BookOpen, PinOff, Bold, Italic,
  Heading1, Heading2, Heading3, Code2, CheckSquare, Minus,
  Sun, Moon, Laptop, PanelLeftClose,
} from 'lucide-react';
import AppIcon from './icons/AppIcon';
import { useUIStore } from '../store/ui';
import { useAuthStore } from '../store/auth';
import { useNoteStore } from '../store/notes';
import { useVaultStore } from '../store/vaults';
import { useThemeStore } from '../store/theme';
import type { Note } from '@shared/types';
import styles from './TitleBar.module.css';

interface Cmd {
  id: string;
  label: string;
  hotkey?: string;
  icon: React.ElementType;
  group?: string;
}

const COMMANDS: Cmd[] = [
  // Navigation
  { id: 'new-note',    label: 'New Note',            hotkey: 'Ctrl+N', icon: FilePlus,      group: 'Navigation' },
  { id: 'notes-view',  label: 'Go to Notes',                            icon: BookOpen,      group: 'Navigation' },
  { id: 'pin-note',    label: 'Pin / Unpin Note',                       icon: Pin,           group: 'Navigation' },
  { id: 'trash',       label: 'Toggle Trash',         hotkey: 'Ctrl+T', icon: Trash2,        group: 'Navigation' },
  { id: 'collapse',    label: 'Toggle Notes Panel',   hotkey: 'Ctrl+\\',icon: PanelLeftClose,group: 'Navigation' },
  // Settings
  { id: 'settings',    label: 'App Settings',         hotkey: 'Ctrl+,', icon: Settings,      group: 'Settings'   },
  { id: 'appearance',  label: 'Appearance',                              icon: Monitor,       group: 'Settings'   },
  { id: 'vault-cfg',   label: 'Vault Settings',                          icon: Settings,      group: 'Settings'   },
  // Appearance
  { id: 'dark-mode',   label: 'Dark Mode',                               icon: Moon,          group: 'Appearance' },
  { id: 'light-mode',  label: 'Light Mode',                              icon: Sun,           group: 'Appearance' },
  { id: 'system-mode', label: 'System Mode',                             icon: Laptop,        group: 'Appearance' },
  // Editor
  { id: 'fmt-bold',    label: 'Bold',                 hotkey: 'Ctrl+B', icon: Bold,          group: 'Editor'     },
  { id: 'fmt-italic',  label: 'Italic',               hotkey: 'Ctrl+I', icon: Italic,        group: 'Editor'     },
  { id: 'fmt-h1',      label: 'Heading 1',                               icon: Heading1,      group: 'Editor'     },
  { id: 'fmt-h2',      label: 'Heading 2',                               icon: Heading2,      group: 'Editor'     },
  { id: 'fmt-h3',      label: 'Heading 3',                               icon: Heading3,      group: 'Editor'     },
  { id: 'fmt-code',    label: 'Code Block',                              icon: Code2,         group: 'Editor'     },
  { id: 'fmt-task',    label: 'Task List',                               icon: CheckSquare,   group: 'Editor'     },
  { id: 'fmt-hr',      label: 'Insert Divider',                          icon: Minus,         group: 'Editor'     },
  // Account
  { id: 'logout',      label: 'Log Out',                                 icon: LogOut,        group: 'Account'    },
];

// ── Main TitleBar ─────────────────────────────────────────────────────────────

const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

/** Shortcut that opens the command bar, as displayed to the user. */
const COMMAND_BAR_HOTKEY = isMac ? '⌘K' : 'Ctrl+Tab';

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const { user } = useAuthStore();

  useEffect(() => {
    if (isMac) return;
    getCurrentWindow().isMaximized().then(setMaximized);
  }, [isMac]);

  if (isMac) return null;

  async function toggleMaximize() {
    await getCurrentWindow().toggleMaximize();
    const next = await getCurrentWindow().isMaximized();
    setMaximized(next);
  }

  return (
    <div className={styles.bar}>
      {/* Left — logo + name */}
      <div className={styles.left}>
        <AppIcon size={14} className={styles.dragIcon} />
        <span className={styles.appName}>Cord</span>
      </div>

      {/* Center slot always occupies column 2 so controls stay in column 3 */}
      <div>{user && <CommandPill />}</div>

      {/* Right — window controls */}
      <div className={styles.controls}>
        <button className={styles.btn} title="Minimize" onClick={() => getCurrentWindow().minimize()}>
          <svg width="10" height="1" viewBox="0 0 10 1">
            <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button className={styles.btn} title={maximized ? 'Restore' : 'Maximize'} onClick={toggleMaximize}>
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <rect x="3.2" y="0.7" width="7.1" height="7.1" rx="1" stroke="currentColor" strokeWidth="1.1" fill="var(--bg-sidebar)" />
              <rect x="0.7" y="3.2" width="7.1" height="7.1" rx="1" stroke="currentColor" strokeWidth="1.1" fill="var(--bg-sidebar)" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="0.7" y="0.7" width="8.6" height="8.6" rx="1" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          )}
        </button>
        <button className={`${styles.btn} ${styles.closeBtn}`} title="Close" onClick={() => getCurrentWindow().close()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.3" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Command pill ──────────────────────────────────────────────────────────────

type Row = { kind: 'cmd'; data: Cmd } | { kind: 'note'; data: Note };

function CommandPill() {
  const { commandsOpen, openCommands, closeCommands, openSettings, setView, view } = useUIStore();
  const { logout }    = useAuthStore();
  const { notes, activeNoteId, createNote, updateNote, setActiveNote, loadLinks } = useNoteStore();
  const { vaults, activeVaultId, setActiveVault } = useVaultStore();
  const { setColorScheme } = useThemeStore();

  const [query, setQuery]   = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const itemRefs  = useRef<(HTMLButtonElement | null)[]>([]);

  // ── Rows ──────────────────────────────────────────────────────────────────

  const q = query.toLowerCase().trim();

  // Build dynamic vault-switch commands
  const vaultCmds: Cmd[] = vaults
    .filter((v) => v.id !== activeVaultId)
    .map((v) => ({ id: `vault:${v.id}`, label: `Switch to ${v.name}`, icon: BookOpen, group: 'Vaults' }));

  const allCmds = [...COMMANDS, ...vaultCmds];
  const filteredCmds  = allCmds.filter((c) => !q || c.label.toLowerCase().includes(q));
  const filteredNotes: Note[] = q
    ? notes.filter((n) => (n.title || '').toLowerCase().includes(q)).slice(0, 8)
    : notes.slice(0, 6);

  const rows: Row[] = [
    ...filteredCmds.map((c): Row => ({ kind: 'cmd',  data: c })),
    ...filteredNotes.map((n): Row => ({ kind: 'note', data: n })),
  ];

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { itemRefs.current[cursor]?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  useEffect(() => {
    if (commandsOpen) inputRef.current?.focus();
  }, [commandsOpen]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+Tab opens the command bar. Bare Tab is deliberately left alone so
      // it still indents inside the editor — the chord requires a modifier, so
      // there is nothing to special-case for contenteditable.
      //
      // macOS keeps Cmd+K: Cmd+Tab is the OS application switcher and never
      // reaches the webview.
      const opensCommandBar = isMac
        ? e.metaKey && e.key.toLowerCase() === 'k'
        : e.ctrlKey && !e.altKey && e.key === 'Tab';

      if (opensCommandBar) {
        e.preventDefault();
        openCommands();
        inputRef.current?.focus();
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        openCommands();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCommands, isMac]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const close = useCallback(() => {
    closeCommands();
    setQuery('');
  }, [closeCommands]);

  const activate = useCallback(async (row: Row) => {
    close();
    if (row.kind === 'note') {
      setView('notes');
      setActiveNote(row.data.id);
      loadLinks(row.data.id);
      return;
    }
    const editorCmd = (cmd: string) =>
      window.dispatchEvent(new CustomEvent('corddb:editor-command', { detail: { cmd } }));

    switch (row.data.id) {
      case 'new-note':
        if (activeVaultId) { setView('notes'); await createNote({ vaultId: activeVaultId }); }
        break;
      case 'notes-view':  setView('notes'); break;
      case 'pin-note': {
        const note = notes.find((n) => n.id === activeNoteId);
        if (note) await updateNote(note.id, { isPinned: !note.isPinned });
        break;
      }
      case 'settings':     openSettings('app');         break;
      case 'appearance':   openSettings('appearance');  break;
      case 'vault-cfg':    openSettings('vault');        break;
      case 'trash':        setView(view === 'trash' ? 'notes' : 'trash'); break;
      case 'collapse':     window.dispatchEvent(new CustomEvent('corddb:toggle-panel')); break;
      case 'dark-mode':    setColorScheme('dark');       break;
      case 'light-mode':   setColorScheme('light');      break;
      case 'system-mode':  setColorScheme('system');     break;
      case 'fmt-bold':     editorCmd('bold');            break;
      case 'fmt-italic':   editorCmd('italic');          break;
      case 'fmt-h1':       editorCmd('h1');              break;
      case 'fmt-h2':       editorCmd('h2');              break;
      case 'fmt-h3':       editorCmd('h3');              break;
      case 'fmt-code':     editorCmd('codeBlock');       break;
      case 'fmt-task':     editorCmd('taskList');        break;
      case 'fmt-hr':       editorCmd('hr');              break;
      case 'logout':       if (confirm('Log out?')) await logout(); break;
      default:
        if (row.data.id.startsWith('vault:')) {
          setActiveVault(row.data.id.slice(6));
        }
        break;
    }
  }, [close, activeVaultId, activeNoteId, createNote, updateNote, notes, loadLinks, logout, openSettings, setActiveNote, setView, view, setColorScheme, setActiveVault]);

  // ── Input handlers ────────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!commandsOpen) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setCursor((i) => (i + 1) % Math.max(rows.length, 1)); break;
      case 'ArrowUp':   e.preventDefault(); setCursor((i) => (i - 1 + Math.max(rows.length, 1)) % Math.max(rows.length, 1)); break;
      case 'Enter':     e.preventDefault(); if (rows[cursor]) activate(rows[cursor]); break;
      case 'Escape':    e.preventDefault(); close(); inputRef.current?.blur(); break;
    }
  }

  function handleFocus() { openCommands(); }

  function handleBlur(e: React.FocusEvent) {
    if (wrapRef.current?.contains(e.relatedTarget as Node)) return;
    closeCommands();
    setQuery('');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={wrapRef} className={styles.pillWrap}>
      <div className={`${styles.pill} ${commandsOpen ? styles.pillOpen : ''}`}>
        <Search size={12} strokeWidth={2} className={styles.pillIcon} />
        <input
          ref={inputRef}
          className={styles.pillInput}
          placeholder={`Search or command… (${COMMAND_BAR_HOTKEY})`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
      </div>

      {commandsOpen && (
        <div className={styles.dropdown}>
          <div className={styles.dropList}>

            {filteredCmds.length > 0 && (() => {
              const activeNote = notes.find((n) => n.id === activeNoteId);
              const groups: Record<string, Cmd[]> = {};
              for (const cmd of filteredCmds) {
                const g = cmd.group ?? 'Other';
                if (!groups[g]) groups[g] = [];
                groups[g].push(cmd);
              }
              let gi = 0;
              return Object.entries(groups).map(([groupName, cmds]) => (
                <div key={groupName}>
                  {(!q || Object.keys(groups).length > 1) && (
                    <div className={styles.dropSection}>{groupName}</div>
                  )}
                  {cmds.map((cmd) => {
                    const i = gi++;
                    const isPinCmd = cmd.id === 'pin-note';
                    const Icon = isPinCmd && activeNote?.isPinned ? PinOff : cmd.icon;
                    const label = isPinCmd
                      ? (activeNote ? (activeNote.isPinned ? 'Unpin Note' : 'Pin Note') : 'Pin Note (no note open)')
                      : cmd.label;
                    const dimmed = isPinCmd && !activeNote;
                    return (
                      <button
                        key={cmd.id}
                        ref={(el) => { itemRefs.current[i] = el; }}
                        className={`${styles.dropRow} ${i === cursor ? styles.dropRowActive : ''} ${dimmed ? styles.dropRowDimmed : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); if (!dimmed) activate({ kind: 'cmd', data: cmd }); }}
                        onMouseEnter={() => setCursor(i)}
                      >
                        <span className={styles.dropRowIcon}>
                          <Icon size={14} strokeWidth={1.75} />
                        </span>
                        <span className={styles.dropRowLabel}>{label}</span>
                        {cmd.hotkey && <span className={styles.dropRowKbd}>{cmd.hotkey}</span>}
                      </button>
                    );
                  })}
                </div>
              ));
            })()}

            {filteredNotes.length > 0 && (
              <>
                <div className={styles.dropSection}>Notes</div>
                {filteredNotes.map((note, i) => {
                  const idx = filteredCmds.length + i;
                  return (
                    <button
                      key={note.id}
                      ref={(el) => { itemRefs.current[idx] = el; }}
                      className={`${styles.dropRow} ${idx === cursor ? styles.dropRowActive : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); activate({ kind: 'note', data: note }); }}
                      onMouseEnter={() => setCursor(idx)}
                    >
                      <span className={styles.dropRowIcon}>
                        <FileText size={14} strokeWidth={1.75} />
                      </span>
                      <span className={styles.dropRowLabel}>
                        {note.title || <em className={styles.untitled}>Untitled</em>}
                      </span>
                      {note.isPinned && <Pin size={11} strokeWidth={1.75} className={styles.pinIcon} />}
                    </button>
                  );
                })}
              </>
            )}

            {rows.length === 0 && (
              <div className={styles.dropEmpty}>No results for &ldquo;{query}&rdquo;</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
