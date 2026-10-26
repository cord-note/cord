import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useTagStore } from '../../store/tags';
import { useVaultStore } from '../../store/vaults';
import { useSetting } from '../../settings';
import { holdDuration } from '../../settings/derived';
import { log } from '../../lib/log';
import { HoldButton } from '../HoldButton';
import { ColorSwatch } from './ColorSwatch';
import { HOLD_DELETE_MS } from '@shared/constants';
import { DISTINCT_VAULT_COLORS } from '@shared/constants/vaultColors';
import type { Tag } from '@shared/types';
import styles from '../SettingsPage.module.css';

/** The one place to rename, recolour, create and delete a vault's tags. */
export default function TagsPage() {
  const { tags, noteTagMap, createTag } = useTagStore();
  const { vaults, activeVaultId } = useVaultStore();
  const vault = vaults.find((v) => v.id === activeVaultId);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const ids of Object.values(noteTagMap)) for (const id of ids) c.set(id, (c.get(id) ?? 0) + 1);
    return c;
  }, [noteTagMap]);

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const shown = tags
    .filter((t) => t.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const canCreate = trimmed !== '' && !tags.some((t) => t.name.toLowerCase() === q);

  async function create() {
    if (!canCreate || !activeVaultId) return;
    try {
      await createTag({ vaultId: activeVaultId, name: trimmed });
      setQuery('');
      setError(null);
    } catch (err) {
      setError(String(err));
      log('error', 'tags', 'Creating the tag failed', err);
    }
  }

  if (!vault) {
    return <div className={styles.empty}>Open a vault to manage its tags.</div>;
  }

  return (
    <div className={`${styles.field} cord-settings__field`}>
      <div className={styles.fieldHint}>
        Tags belong to a vault. These are the tags in “{vault.name}”.
      </div>

      <div className={styles.tagSearch}>
        <Search size={14} strokeWidth={1.75} className={styles.tagSearchIcon} />
        <input
          className={styles.textInput}
          placeholder="Search or add a tag…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void create(); }
            if (e.key === 'Escape') setQuery('');
          }}
        />
        {canCreate && (
          <button className={styles.tagAddBtn} onClick={() => void create()}>
            <Plus size={13} strokeWidth={2} /> Add “{trimmed}”
          </button>
        )}
      </div>
      {error && <div className={styles.tagError}>{error}</div>}

      {tags.length === 0 ? (
        <div className={styles.empty}>No tags yet. Type a name above to add one.</div>
      ) : shown.length === 0 ? (
        <div className={styles.empty}>No tags match “{trimmed}”.</div>
      ) : (
        <ul className={styles.tagList}>
          {shown.map((tag) => (
            <TagRow key={tag.id} tag={tag} count={counts.get(tag.id) ?? 0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TagRow({ tag, count }: { tag: Tag; count: number }) {
  const { updateTag, deleteTag } = useTagStore();
  const holdSpeed = useSetting('general.holdToConfirm');
  const [name, setName] = useState(tag.name);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => { setName(tag.name); }, [tag.name]);

  // Clicking outside the row closes its palette.
  useEffect(() => {
    if (!paletteOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setPaletteOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [paletteOpen]);

  async function save(patch: { name?: string; color?: string }) {
    try {
      await updateTag(tag.id, patch);
      setError(null);
    } catch (err) {
      setName(tag.name);
      setError(String(err).replace(/^Error:\s*/, ''));
      log('error', 'tags', 'Updating the tag failed', err);
    }
  }

  function commitName() {
    const next = name.trim();
    if (!next) { setName(tag.name); return; }
    if (next !== tag.name) void save({ name: next });
  }

  const color = tag.color ?? 'var(--text-muted)';

  return (
    <li ref={rowRef} className={`${styles.tagItem} ${paletteOpen ? styles.tagItemOpen : ''}`}>
      <div className={styles.tagRow}>
        <button
          className={styles.tagColorBtn}
          style={{ background: color }}
          onClick={() => setPaletteOpen((v) => !v)}
          title="Change colour"
          aria-label={`Change colour of ${tag.name}`}
          aria-expanded={paletteOpen}
        />
        <input
          className={styles.tagNameInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setName(tag.name); (e.target as HTMLInputElement).blur(); }
          }}
          aria-label="Tag name"
          spellCheck={false}
        />
        <span className={styles.tagCount}>{count === 1 ? '1 note' : `${count} notes`}</span>
        <HoldButton
          durationMs={holdDuration(HOLD_DELETE_MS, holdSpeed)}
          onComplete={() => void deleteTag(tag.id)}
          size={26}
          title={`Hold to delete “${tag.name}”`}
          className={styles.tagDeleteBtn}
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </HoldButton>
      </div>
      {paletteOpen && (
        <div className={styles.tagPalette}>
          {DISTINCT_VAULT_COLORS.map((c) => (
            <ColorSwatch
              key={c}
              color={c}
              selected={c === tag.color}
              onPick={(picked) => { void save({ color: picked }); setPaletteOpen(false); }}
            />
          ))}
        </div>
      )}
      {error && <div className={styles.tagError}>{error}</div>}
    </li>
  );
}
