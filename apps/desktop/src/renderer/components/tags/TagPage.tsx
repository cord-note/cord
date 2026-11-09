import { useEffect, useState } from 'react';
import { api } from '../../ipc';
import { useTagStore } from '../../store/tags';
import { log } from '../../lib/log';
import { TagViewBody } from './TagViewBody';
import { FieldsEditor } from './FieldsEditor';
import styles from './tags.module.css';

interface Props {
  tagId: string;
  onOpen: (noteId: string, blockId?: string) => void;
}

/** Everything carrying a tag, as a table or board, with the tag's fields. */
export function TagPage({ tagId, onOpen }: Props) {
  const tag = useTagStore((s) => s.tags.find((t) => t.id === tagId));
  const [viewId, setViewId] = useState<string | null>(null);
  const [showFields, setShowFields] = useState(false);

  useEffect(() => {
    setViewId(null);
    api.views.page(tagId)
      .then((v) => setViewId(v.id))
      .catch((error: unknown) => log('error', 'tags', 'Opening a tag page failed', { tagId, error: String(error) }));
  }, [tagId]);

  if (!tag) return <p className={styles.muted}>This tag no longer exists.</p>;
  return (
    <div className={`${styles.page} cord-tag-page`}>
      <h1 className={styles.pageTitle}>
        <span className={styles.pageDot} style={{ background: tag.color ?? 'var(--text-muted)' }} />
        {tag.name}
      </h1>
      {showFields && <FieldsEditor tagId={tagId} />}
      {viewId && (
        <TagViewBody
          key={viewId}
          viewId={viewId}
          onOpen={onOpen}
          extraTools={
            <button type="button" className={styles.btn} aria-pressed={showFields} onClick={() => setShowFields((v) => !v)}>
              Fields
            </button>
          }
        />
      )}
    </div>
  );
}
