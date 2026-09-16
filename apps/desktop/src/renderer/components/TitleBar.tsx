import { useEffect, useRef, useState, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Search, FilePlus, Trash2, Settings, LogOut, FileText, Pin,
  Monitor, BookOpen, PinOff, Bold, Italic,
  Heading1, Heading2, Heading3, Code2, CheckSquare, Minus,
  Sun, Moon, Laptop, PanelLeftClose,
  LayoutList, ArrowUp, ArrowDown, Copy, Blocks, Repeat,
} from 'lucide-react';
import AppIcon from './icons/AppIcon';
import { useUIStore } from '../store/ui';
import { useAuthStore } from '../store/auth';
import { useNoteStore } from '../store/notes';
import { useVaultStore } from '../store/vaults';
import { useThemeStore } from '../store/theme';
import {
  IS_MAC, formatAccel, matchesBinding, useKeybindingStore, type KeybindingId,
} from '../store/keybindings';
import type { NoteListItem } from '@shared/types';
import { api } from '../ipc';
import styles from './TitleBar.module.css';

interface Cmd {
  id: string;
  label: string;
  /** Shortcut shown on the row, resolved live from the keybinding store. */
  binding?: KeybindingId;
  icon: React.ElementType;
  group?: string;
  /** Only offered while a notepad is open — meaningless for a plain note. */
  notepadOnly?: boolean;
}

const COMMANDS: Cmd[] = [
  // Navigation
  { id: 'new-note',    label: 'New Note',      binding: 'app.newNote',          icon: FilePlus,      group: 'Navigation' },
  { id: 'new-notepad', label: 'New Notepad',   binding: 'app.newNotepad',       icon: LayoutList,    group: 'Navigation' },
  { id: 'notes-view',  label: 'Go to Notes',                                     icon: BookOpen,      group: 'Navigation' },
  { id: 'pin-note',    label: 'Pin / Unpin Note',                                icon: Pin,           group: 'Navigation' },
  { id: 'trash',       label: 'Toggle Trash',  binding: 'app.toggleTrash',      icon: Trash2,        group: 'Navigation' },
  { id: 'collapse',    label: 'Toggle Notes Panel', binding: 'app.toggleNotesPanel', icon: PanelLeftClose, group: 'Navigation' },
  // Settings
  { id: 'settings',    label: 'App Settings',  binding: 'app.settings',         icon: Settings,      group: 'Settings'   },
  { id: 'appearance',  label: 'Appearance',                              icon: Monitor,       group: 'Settings'   },
  { id: 'vault-cfg',   label: 'Vault Settings',                          icon: Settings,      group: 'Settings'   },
  // Appearance
  { id: 'dark-mode',   label: 'Dark Mode',                               icon: Moon,          group: 'Appearance' },
  { id: 'light-mode',  label: 'Light Mode',                              icon: Sun,           group: 'Appearance' },
  { id: 'system-mode', label: 'System Mode',                             icon: Laptop,        group: 'Appearance' },
  // Editor
  { id: 'fmt-bold',    label: 'Bold',          binding: 'editor.bold',          icon: Bold,          group: 'Editor'     },
  { id: 'fmt-italic',  label: 'Italic',        binding: 'editor.italic',        icon: Italic,        group: 'Editor'     },
  { id: 'fmt-h1',      label: 'Heading 1',     binding: 'editor.heading1',      icon: Heading1,      group: 'Editor'     },
  { id: 'fmt-h2',      label: 'Heading 2',     binding: 'editor.heading2',      icon: Heading2,      group: 'Editor'     },
  { id: 'fmt-h3',      label: 'Heading 3',     binding: 'editor.heading3',      icon: Heading3,      group: 'Editor'     },
  { id: 'fmt-code',    label: 'Code Block',    binding: 'editor.codeBlock',     icon: Code2,         group: 'Editor'     },
  { id: 'fmt-task',    label: 'Task List',     binding: 'editor.taskList',      icon: CheckSquare,   group: 'Editor'     },
  { id: 'fmt-hr',      label: 'Insert Divider',binding: 'editor.divider',       icon: Minus,         group: 'Editor'     },
  { id: 'convert',     label: 'Convert Note ↔ Notepad',                          icon: Repeat,        group: 'Editor'     },
  // Blocks — notepad only
  { id: 'blk-up',       label: 'Move Block Up',   binding: 'block.moveUp',       icon: ArrowUp,   group: 'Blocks', notepadOnly: true },
  { id: 'blk-down',     label: 'Move Block Down', binding: 'block.moveDown',     icon: ArrowDown, group: 'Blocks', notepadOnly: true },
  { id: 'blk-dup',      label: 'Duplicate Block', binding: 'block.duplicate',    icon: Copy,      group: 'Blocks', notepadOnly: true },
  { id: 'blk-del',      label: 'Delete Block',    binding: 'block.delete',       icon: Trash2,    group: 'Blocks', notepadOnly: true },
  { id: 'blk-ref',      label: 'Insert Block Reference', binding: 'block.insertRef', icon: Blocks, group: 'Blocks', notepadOnly: true },
  // Account
  { id: 'logout',      label: 'Log Out',                                 icon: LogOut,        group: 'Account'    },
];

// ── Main TitleBar ─────────────────────────────────────────────────────────────

const isMac = IS_MAC;

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

// Notes here are NoteListItem, not Note: rows only need id, title and isPinned,
// and it is the shape the backend search returns. Note is assignable to it, so
// the loaded-notes path still fits.
type Row = { kind: 'cmd'; data: Cmd } | { kind: 'note'; data: NoteListItem };

function CommandPill() {
  const { commandsOpen, openCommands, closeCommands, openSettings, setView, view } = useUIStore();
  const { logout }    = useAuthStore();
  const { notes, activeNoteId, createNote, updateNote, setActiveNote, loadLinks,
          convertNote, conversionImpact } = useNoteStore();
  const { vaults, activeVaultId, setActiveVault } = useVaultStore();
  const { setColorScheme } = useThemeStore();
  const bindings = useKeybindingStore((s) => s.bindings);

  const [query, setQuery]   = useState('');
  const [cursor, setCursor] = useState(0);
  const [bodyHits, setBodyHits] = useState<NoteListItem[]>([]);
  const inputRef  = useRef<HTMLInputElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const itemRefs  = useRef<(HTMLButtonElement | null)[]>([]);

  // ── Rows ──────────────────────────────────────────────────────────────────

  const q = query.toLowerCase().trim();

  // Build dynamic vault-switch commands
  const vaultCmds: Cmd[] = vaults
    .filter((v) => v.id !== activeVaultId)
    .map((v) => ({ id: `vault:${v.id}`, label: `Switch to ${v.name}`, icon: BookOpen, group: 'Vaults' }));

  // Block commands only exist for a notepad, so offering them elsewhere would
  // list actions that silently do nothing.
  const activeNote = notes.find((n) => n.id === activeNoteId);
  const isNotepad = activeNote?.kind === 'notepad';

  const allCmds = [...COMMANDS, ...vaultCmds];
  const filteredCmds = allCmds
    .filter((c) => !c.notepadOnly || isNotepad)
    .filter((c) => !q || c.label.toLowerCase().includes(q));
  // Title matches come from the already-loaded notes, so the list reacts on the
  // first keystroke instead of waiting on a round trip. Body matches arrive
  // from the same backend search the Notes tab uses and are merged in when they
  // land — the palette used to filter titles only, so a note whose body held
  // the term was findable in the Notes tab and invisible here.
  const titleHits = q
    ? notes.filter((n) => (n.title || '').toLowerCase().includes(q))
    : [];

  const seen = new Set(titleHits.map((n) => n.id));
  const filteredNotes: NoteListItem[] = q
    ? [...titleHits, ...bodyHits.filter((n) => !seen.has(n.id))].slice(0, 8)
    : notes.slice(0, 6);

  const rows: Row[] = [
    ...filteredCmds.map((c): Row => ({ kind: 'cmd',  data: c })),
    ...filteredNotes.map((n): Row => ({ kind: 'note', data: n })),
  ];

  // Body-text search. Debounced because this fires per keystroke, and guarded
  // by `cancelled` so a slow response for an earlier query cannot overwrite the
  // results of a later one. Failures clear the extra hits rather than surfacing
  // an error: the title matches above are still a useful answer.
  useEffect(() => {
    if (!q || !activeVaultId) { setBodyHits([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.notes
        .search(activeVaultId, q)
        .then((items) => { if (!cancelled) setBodyHits(items); })
        .catch(() => { if (!cancelled) setBodyHits([]); });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, activeVaultId]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { itemRefs.current[cursor]?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  useEffect(() => {
    if (commandsOpen) inputRef.current?.focus();
  }, [commandsOpen]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Both chords are user-rebindable; the defaults are Ctrl+Tab (Cmd+K on
      // macOS, where Cmd+Tab is the OS app switcher and never reaches the
      // webview) and F1. Bare Tab is deliberately left alone so it still
      // indents inside the editor.
      if (!matchesBinding(e, 'app.commandBar') && !matchesBinding(e, 'app.commandBarAlt')) return;
      e.preventDefault();
      openCommands();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCommands]);

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
      case 'new-notepad':
        if (activeVaultId) {
          setView('notes');
          await createNote({ vaultId: activeVaultId, kind: 'notepad' });
        }
        break;
      case 'convert': {
        const note = notes.find((n) => n.id === activeNoteId);
        if (!note) break;
        const to = note.kind === 'notepad' ? 'note' : 'notepad';

        // Going back to a plain note loses block structure, and any reference
        // pointing into this note breaks. State the cost in specifics before
        // asking, and skip the prompt entirely when there is nothing to lose.
        if (to === 'note') {
          const impact = await conversionImpact(note.id);
          const losses: string[] = [];
          if (impact.blockTagCount > 0) {
            losses.push(`${impact.blockTagCount} block tag${impact.blockTagCount === 1 ? '' : 's'}`);
          }
          if (impact.blockLinkCount > 0) {
            losses.push(`${impact.blockLinkCount} block link${impact.blockLinkCount === 1 ? '' : 's'}`);
          }
          if (losses.length > 0 || impact.inboundRefCount > 0) {
            const lines = ['Convert this notepad to a plain note?', ''];
            if (losses.length > 0) {
              lines.push(`${losses.join(' and ')} will stop being shown.`);
              lines.push('Converting back restores them.');
            }
            if (impact.inboundRefCount > 0) {
              lines.push('');
              lines.push(
                `${impact.inboundRefCount} reference${impact.inboundRefCount === 1 ? '' : 's'} ` +
                'from other notepads will break permanently.',
              );
            }
            if (!confirm(lines.join('\n'))) break;
          }
        }

        await convertNote(note.id, to);
        // The editor keys its instance off kind, so it rebuilds on this change.
        await setActiveNote(note.id);
        break;
      }
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
      case 'blk-up':       editorCmd('block:moveUp');    break;
      case 'blk-down':     editorCmd('block:moveDown');  break;
      case 'blk-dup':      editorCmd('block:duplicate'); break;
      case 'blk-del':      editorCmd('block:delete');    break;
      case 'blk-ref':      editorCmd('block:insertRef'); break;
      case 'logout':       if (confirm('Log out?')) await logout(); break;
      default:
        if (row.data.id.startsWith('vault:')) {
          setActiveVault(row.data.id.slice(6));
        }
        break;
    }
  }, [close, activeVaultId, activeNoteId, createNote, updateNote, notes, loadLinks, logout, openSettings, setActiveNote, setView, view, setColorScheme, setActiveVault, convertNote, conversionImpact]);

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
          placeholder={`Search or command… (${formatAccel(bindings['app.commandBar'])})`}
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
                    const hotkey = cmd.binding ? formatAccel(bindings[cmd.binding]) : '';
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
                        {hotkey && <span className={styles.dropRowKbd}>{hotkey}</span>}
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
