import { Dialog } from '../Dialog';
import { useTagStore } from '../../store/tags';
import { useTagViewPicker } from '../../store/tagViewPicker';
import styles from './tags.module.css';

/** "Which tag should this view show?", answered once per request. */
export function TagViewPicker() {
  const open = useTagViewPicker((s) => s.resolve !== null);
  const answer = useTagViewPicker((s) => s.answer);
  const tags = useTagStore((s) => s.tags);
  return (
    <Dialog open={open} title="Insert a tag view" onClose={() => answer(null)}>
      {tags.length === 0
        ? <p className={styles.muted}>This vault has no tags yet.</p>
        : (
          <div className={styles.filters}>
            {tags.map((t) => (
              <button key={t.id} type="button" className={styles.pill} onClick={() => answer(t.id)}>
                <span className={styles.dot} style={{ background: t.color ?? 'var(--text-muted)' }} />{t.name}
              </button>
            ))}
          </div>
        )}
    </Dialog>
  );
}
