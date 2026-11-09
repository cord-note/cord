import { useEffect, useState } from 'react';
import type { NoteFields, Tag } from '@shared/types';
import { api } from '../../ipc';
import { useFieldsVersion } from '../../store/fieldsVersion';
import { log } from '../../lib/log';
import { ValueEditor } from './ValueEditor';
import styles from './tags.module.css';

interface Props {
  noteId: string;
  /** The note's own tags; block tags don't show here. */
  tags: Tag[];
}

/** The note's field values, grouped by tag, editable in place. */
export function PropertiesStrip({ noteId, tags }: Props) {
  const version = useFieldsVersion((s) => s.version);
  const bump = useFieldsVersion((s) => s.bump);
  const [data, setData] = useState<NoteFields | null>(null);
  const [open, setOpen] = useState(true);
  const tagKey = tags.map((t) => t.id).join(',');

  useEffect(() => { void api.fields.forNote(noteId).then(setData); }, [noteId, version, tagKey]);

  const tagIds = new Set(tags.map((t) => t.id));
  const fields = (data?.fields ?? []).filter((f) => tagIds.has(f.tagId));
  if (fields.length === 0) return null;
  const valueOf = (fieldId: string): unknown =>
    data?.values.find((v) => v.fieldId === fieldId && v.targetKind === 'note' && v.targetId === noteId)?.value ?? null;
  const commit = (fieldId: string, value: unknown): void => {
    const write = value === null
      ? api.fields.clearValue(fieldId, noteId)
      : api.fields.setValue({ fieldId, targetId: noteId, targetKind: 'note', noteId, value });
    write.then(bump).catch((e: unknown) => log('warn', 'tags', 'Setting a value failed', { error: String(e) }));
  };

  return (
    <div className={`${styles.strip} cord-editor__properties`}>
      <button type="button" className={styles.stripToggle} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? 'Hide properties' : `Properties (${fields.length})`}
      </button>
      {open && tags.flatMap((t) => fields.filter((f) => f.tagId === t.id).map((f) => (
        <div key={f.id} className={styles.stripRow}>
          <span className={styles.stripLabel}>#{t.name} · {f.name}</span>
          <ValueEditor field={f} value={valueOf(f.id)} onCommit={(v) => commit(f.id, v)} />
        </div>
      )))}
    </div>
  );
}
