import { X } from 'lucide-react';
import { useTagStore } from '../../store/tags';
import styles from '../SettingsPage.module.css';

export default function TagsPage() {
  const { tags, deleteTag } = useTagStore();

  return (
    <>

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
    </>
  );
}
