import { useEffect, useRef, useState } from 'react';
import { Search, X, Plus, Pin, PinOff, Trash2, SlidersHorizontal } from 'lucide-react';
import { useVaultStore } from '../store/vaults';
import { useNoteStore } from '../store/notes';
import { useTagStore } from '../store/tags';
import { useUIStore } from '../store/ui';
import { HoldButton } from './HoldButton';
import { HOLD_DELETE_MS } from '@shared/constants';
import styles from './NoteList.module.css';

const EXCERPT_LENGTH = 80;
const SEARCH_DEBOUNCE_MS = 300;

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type DocNode = { type?: string; text?: string; content?: DocNode[] };
function collectText(node: DocNode, out: string[]): void {
  if (node.text) out.push(node.text);
  node.content?.forEach((c) => collectText(c, out));
}
function excerpt(bodyJson: string): string {
  try {
    const doc = JSON.parse(bodyJson) as DocNode;
    const texts: string[] = [];
    collectText(doc, texts);
    return texts.join(' ').slice(0, EXCERPT_LENGTH);
  } catch { return ''; }
}

export default function NoteList() {
  const { activeVaultId, vaults } = useVaultStore();
  const activeVault = vaults.find((v) => v.id === activeVaultId);
  const {
    notes, activeNoteId, setActiveNote, createNote, deleteNote, loadLinks,
    searchQuery, searchResults, searchNotes, clearSearch, updateNote,
  } = useNoteStore();
  const { tags, activeTagId, noteTagMap, setActiveTag } = useTagStore();
  const { setView } = useUIStore();

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTagFilter, setShowTagFilter] = useState(false);

  useEffect(() => {
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || (e.ctrlKey && !e.altKey)) && e.key === 'n') {
        e.preventDefault();
        handleNewNote();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVaultId]);

  async function handleSelectNote(id: string) {
    setView('notes');
    setActiveNote(id);
    await loadLinks(id);
  }

  async function handleNewNote() {
    if (!activeVaultId) return;
    try {
      await createNote({ vaultId: activeVaultId });
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }

  async function handleDeleteNote(id: string) {
    try {
      await deleteNote(id);
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  }

  async function handleTogglePin(e: React.MouseEvent, note: { id: string; isPinned: boolean }) {
    e.stopPropagation();
    try {
      await updateNote(note.id, { isPinned: !note.isPinned });
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) { clearSearch(); return; }
    searchTimer.current = setTimeout(() => {
      if (activeVaultId) searchNotes(activeVaultId, q);
    }, SEARCH_DEBOUNCE_MS);
  }

  if (!activeVaultId) {
    return <div className={styles.empty}><p>Select a vault</p></div>;
  }

  let displayedNotes = searchResults ?? notes;
  if (!searchResults && activeTagId) {
    displayedNotes = displayedNotes.filter(
      (n) => (noteTagMap[n.id] ?? []).includes(activeTagId),
    );
  }

  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          Notes
          {displayedNotes.length > 0 && (
            <span className={styles.count}>{displayedNotes.length}</span>
          )}
        </span>
        <div className={styles.headerActions}>
          {tags.length > 0 && (
            <button
              className={`${styles.newBtn} ${showTagFilter ? styles.newBtnActive : ''}`}
              onClick={() => setShowTagFilter((v) => !v)}
              title="Filter by tag"
            >
              <SlidersHorizontal size={13} strokeWidth={2} />
            </button>
          )}
          <button className={styles.newBtn} onClick={handleNewNote} title="New note (Ctrl+N)">
            <Plus size={15} strokeWidth={2} />
          </button>
        </div>
      </div>

      {activeVault && (
        <div className={styles.vaultLine}>
          <span
            className={styles.vaultDot}
            style={{ background: activeVault.color ?? 'var(--text-muted)' }}
          />
          <span className={styles.vaultName}>{activeVault.name}</span>
        </div>
      )}

      {showTagFilter && tags.length > 0 && (
        <div className={styles.tagFilter}>
          <button
            className={`${styles.tagFilterItem} ${activeTagId === null ? styles.tagFilterActive : ''}`}
            onClick={() => { setActiveTag(null); setShowTagFilter(false); }}
          >
            All notes
          </button>
          {tags.map((tag) => (
            <button
              key={tag.id}
              className={`${styles.tagFilterItem} ${tag.id === activeTagId ? styles.tagFilterActive : ''}`}
              onClick={() => { setActiveTag(tag.id); setShowTagFilter(false); }}
            >
              <span className={styles.tagFilterDot} style={{ background: tag.color ?? 'var(--text-muted)' }} />
              {tag.name}
            </button>
          ))}
        </div>
      )}

      <div className={styles.searchBar}>
        <Search size={13} strokeWidth={1.75} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          placeholder="Search notes…"
          defaultValue={searchQuery}
          onChange={handleSearchChange}
        />
        {searchResults && (
          <button className={styles.clearSearch} onClick={clearSearch} title="Clear search">
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      {activeTagId && !searchResults && (
        <div className={styles.tagActivePill}>
          <span className={styles.tagFilterDot} style={{ background: tagById[activeTagId]?.color ?? 'var(--accent)' }} />
          {tagById[activeTagId]?.name}
          <button className={styles.tagPillClear} onClick={() => setActiveTag(null)} title="Clear filter">
            <X size={10} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {displayedNotes.length === 0 ? (
        <div className={styles.empty}>
          {searchResults ? (
            <p>No results for &ldquo;{searchQuery}&rdquo;</p>
          ) : activeTagId ? (
            <p>No notes with this tag</p>
          ) : (
            <>
              <p>No notes yet</p>
              <button className={styles.createFirst} onClick={handleNewNote}>
                Create your first note
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className={styles.list}>
          {displayedNotes.map((note) => {
            const ex = excerpt(note.bodyJson);
            const noteTags = (noteTagMap[note.id] ?? [])
              .map((id) => tagById[id])
              .filter(Boolean);

            return (
              <li
                key={note.id}
                className={`${styles.item} ${note.id === activeNoteId ? styles.active : ''}`}
                onClick={() => handleSelectNote(note.id)}
              >
                <div className={styles.itemContent}>
                  <div className={styles.itemTitleRow}>
                    <span className={styles.itemTitle}>
                      {note.title || <em className={styles.untitled}>Untitled</em>}
                    </span>
                    <div className={styles.itemActions}>
                      <button
                        className={`${styles.pinBtn} ${note.isPinned ? styles.pinned : ''}`}
                        onClick={(e) => handleTogglePin(e, note)}
                        title={note.isPinned ? 'Unpin' : 'Pin to top'}
                      >
                        {note.isPinned
                          ? <Pin size={12} strokeWidth={2} />
                          : <PinOff size={12} strokeWidth={1.75} />}
                      </button>
                      <HoldButton
                        durationMs={HOLD_DELETE_MS}
                        onComplete={() => handleDeleteNote(note.id)}
                        size={20}
                        title="Hold to move to trash"
                      >
                        <Trash2 size={12} strokeWidth={1.75} />
                      </HoldButton>
                    </div>
                  </div>

                  <div className={styles.itemMeta}>
                    <span className={styles.itemDate}>{formatDate(note.updatedAt)}</span>
                    {ex && <span className={styles.itemExcerpt}>{ex}</span>}
                  </div>

                  {noteTags.length > 0 && (
                    <div className={styles.itemTags}>
                      {noteTags.map((tag) => (
                        <span
                          key={tag!.id}
                          className={styles.itemTagChip}
                          style={{ borderColor: tag!.color ?? 'var(--text-muted)' }}
                        >
                          {tag!.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
