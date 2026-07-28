import { useEffect } from 'react';
import { Trash2, RotateCcw } from 'lucide-react';
import { useVaultStore } from '../store/vaults';
import { useNoteStore } from '../store/notes';
import { HoldButton } from './HoldButton';
import { HOLD_DELETE_MS } from '@shared/constants';
import styles from './TrashView.module.css';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TrashView() {
  const { activeVaultId } = useVaultStore();
  const { trashedNotes, loadTrashed, restoreNote, permanentDeleteNote } = useNoteStore();

  useEffect(() => {
    if (activeVaultId) loadTrashed(activeVaultId);
  }, [activeVaultId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeVaultId) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Trash</span>
        <span className={styles.subtitle}>
          {trashedNotes.length === 0
            ? 'Empty'
            : `${trashedNotes.length} note${trashedNotes.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {trashedNotes.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}><Trash2 size={32} strokeWidth={1.25} /></div>
          <p>Trash is empty</p>
        </div>
      ) : (
        <>
          <div className={styles.hint}>
            Notes in trash are kept for 30 days before permanent removal.
            Press and hold “Delete forever” to confirm.
          </div>
          <ul className={styles.list}>
            {trashedNotes.map((note) => (
              <li key={note.id} className={styles.item}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemTitle}>
                    {note.title || <em>Untitled</em>}
                  </span>
                  <span className={styles.itemDate}>
                    Deleted {note.deletedAt ? formatDate(note.deletedAt) : ''}
                  </span>
                </div>
                <div className={styles.itemActions}>
                  <button
                    className={styles.restoreBtn}
                    onClick={() => restoreNote(note.id)}
                    title="Restore note"
                  >
                    <RotateCcw size={13} strokeWidth={1.75} /> Restore
                  </button>
                  <HoldButton
                    variant="text"
                    durationMs={HOLD_DELETE_MS}
                    onComplete={() => permanentDeleteNote(note.id)}
                    holdingLabel="Keep holding…"
                    title={`Hold to permanently delete "${note.title || 'Untitled'}". This cannot be undone.`}
                  >
                    Delete forever
                  </HoldButton>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
