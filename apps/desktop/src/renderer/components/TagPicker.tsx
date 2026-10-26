import { useEffect, useRef, useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { useTagStore } from '../store/tags';
import { useVaultStore } from '../store/vaults';
import { useUIStore } from '../store/ui';
import { log } from '../lib/log';
import styles from './TagPicker.module.css';

interface Props {
  /** Tags already attached; hidden from the list. */
  excludeIds: ReadonlySet<string>;
  onPick: (tagId: string) => void | Promise<void>;
  onClose: () => void;
}

/** Search-or-create tag list. Used by the note's tag button and the block menu. */
export function TagPicker({ excludeIds, onPick, onClose }: Props) {
  const { tags, createTag } = useTagStore();
  const { activeVaultId } = useVaultStore();
  const { openSettings } = useUIStore();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const matches = tags
    .filter((t) => !excludeIds.has(t.id) && t.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const canCreate = trimmed !== '' && !tags.some((t) => t.name.toLowerCase() === q);
  // The create row is the last keyboard target.
  const count = matches.length + (canCreate ? 1 : 0);

  useEffect(() => { setIndex(0); }, [query]);

  async function create() {
    if (!canCreate || !activeVaultId) return;
    try {
      const tag = await createTag({ vaultId: activeVaultId, name: trimmed });
      await onPick(tag.id);
    } catch (err) {
      log('error', 'tags', 'Creating the tag failed', err);
    }
  }

  function choose(i: number) {
    const tag = matches[i];
    if (tag) void onPick(tag.id);
    else if (canCreate) void create();
  }

  return (
    <div className={styles.picker}>
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Search or create a tag…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, count - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(index); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
      />
      <div className={styles.list}>
        {matches.map((tag, i) => (
          <button
            key={tag.id}
            className={`${styles.item} cord-menu__item ${i === index ? `${styles.itemActive} cord-menu__item--active` : ''}`}
            onClick={() => choose(i)}
            onMouseEnter={() => setIndex(i)}
          >
            <span className={styles.dot} style={{ background: tag.color ?? 'var(--text-muted)' }} />
            <span className={styles.label}>{tag.name}</span>
          </button>
        ))}
        {canCreate && (
          <button
            className={`${styles.item} ${styles.create} cord-menu__item ${index === matches.length ? `${styles.itemActive} cord-menu__item--active` : ''}`}
            onClick={() => void create()}
            onMouseEnter={() => setIndex(matches.length)}
          >
            <Plus size={13} strokeWidth={2} />
            <span className={styles.label}>Create “{trimmed}”</span>
          </button>
        )}
        {count === 0 && (
          <div className={styles.empty}>
            {tags.length === 0 ? 'No tags yet. Type to create one.' : 'No more tags to add.'}
          </div>
        )}
      </div>
      <div className={`${styles.divider} cord-menu__divider`} />
      <button
        className={`${styles.item} ${styles.manage} cord-menu__item`}
        onClick={() => { onClose(); openSettings('tags'); }}
      >
        <Settings2 size={13} strokeWidth={1.75} />
        <span className={styles.label}>Manage tags</span>
      </button>
    </div>
  );
}
