import { useEffect, useState } from 'react';
import { api } from '../../ipc';
import { useFieldsVersion } from '../../store/fieldsVersion';
import { useTagStore } from '../../store/tags';
import { TagViewBody } from './TagViewBody';
import styles from './tags.module.css';

interface Props {
  viewId: string;
  onOpen: (noteId: string, blockId?: string) => void;
  onRemove: () => void;
}

/** A tag view inside a note, with its own saved settings. */
export function TagViewEmbed({ viewId, onOpen, onRemove }: Props) {
  const version = useFieldsVersion((s) => s.version);
  const tags = useTagStore((s) => s.tags);
  const [tagId, setTagId] = useState<string | null | undefined>(undefined);

  useEffect(() => { void api.views.get(viewId).then((v) => setTagId(v?.tagId ?? null)); }, [viewId, version]);

  const tag = tags.find((t) => t.id === tagId);
  if (tagId === undefined) return <p className={styles.muted}>Loading…</p>;
  if (tagId === null || !tag) {
    return (
      <div className={`${styles.toolbar} ${styles.embed} cord-tag-embed`}>
        <span className={styles.muted}>This view was removed.</span>
        <button type="button" className={styles.btn} onClick={onRemove}>Remove block</button>
      </div>
    );
  }
  return (
    <div className={`${styles.body} ${styles.embed} cord-tag-embed`}>
      <div className={styles.columnHead}>
        <span className={styles.dot} style={{ background: tag.color ?? 'var(--text-muted)' }} />#{tag.name}
      </div>
      <TagViewBody key={viewId} viewId={viewId} onOpen={onOpen} />
    </div>
  );
}
