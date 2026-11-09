import { useEffect, useState } from 'react';
import { FIELD_TYPES, type FieldType, type SelectOption, type TagField } from '@shared/types';
import { DISTINCT_VAULT_COLORS } from '@shared/constants/vaultColors';
import { api } from '../../ipc';
import { useFieldsVersion } from '../../store/fieldsVersion';
import { log } from '../../lib/log';
import styles from './tags.module.css';

const TYPE_NAMES: Record<FieldType, string> = {
  text: 'Text', number: 'Number', checkbox: 'Checkbox', select: 'Select', multi_select: 'Multi-select', date: 'Date',
};

/** Add, rename, retype, reorder and delete a tag's fields, and edit select options. */
export function FieldsEditor({ tagId }: { tagId: string }) {
  const version = useFieldsVersion((s) => s.version);
  const bump = useFieldsVersion((s) => s.bump);
  const [fields, setFields] = useState<TagField[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void api.fields.list(tagId).then(setFields); }, [tagId, version]);

  const run = (p: Promise<unknown>): void => {
    setError(null);
    p.then(bump).catch((e: unknown) => { setError(String(e)); log('warn', 'tags', 'Changing a field failed', { error: String(e) }); });
  };
  const addOption = (f: TagField): void => {
    const color = DISTINCT_VAULT_COLORS[f.options.length % DISTINCT_VAULT_COLORS.length] ?? null;
    const option: SelectOption = { id: crypto.randomUUID(), name: `Option ${f.options.length + 1}`, color };
    run(api.fields.update(f.id, { options: [...f.options, option] }));
  };
  const move = (i: number, by: number): void => {
    const a = fields[i];
    const b = fields[i + by];
    if (!a || !b) return;
    // Equal sorts would not reorder, so give each its index first.
    run(Promise.all([api.fields.update(a.id, { sort: i + by }), api.fields.update(b.id, { sort: i })]));
  };

  return (
    <div className={`${styles.body} ${styles.fieldsPanel}`}>
      {fields.length === 0 && <span className={styles.muted}>No fields yet. Fields give every note and block with this tag something to fill in.</span>}
      {fields.map((f, i) => (
        <div key={f.id} className={styles.toolbar}>
          <input
            key={`${f.id}:${f.name}`}
            defaultValue={f.name}
            aria-label="Field name"
            onBlur={(e) => { if (e.target.value.trim() && e.target.value !== f.name) run(api.fields.update(f.id, { name: e.target.value })); }}
          />
          <select value={f.type} aria-label="Field type" onChange={(e) => run(api.fields.update(f.id, { type: e.target.value as FieldType }))}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_NAMES[t]}</option>)}
          </select>
          <button type="button" className={styles.btn} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
          <button type="button" className={styles.btn} onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label="Move down">↓</button>
          <button type="button" className={styles.btn} onClick={() => run(api.fields.delete(f.id))}>Delete</button>
          {(f.type === 'select' || f.type === 'multi_select') && (
            <span className={styles.editor}>
              {f.options.map((o) => (
                <span key={o.id} className={styles.pill}>
                  <span className={styles.dot} style={{ background: o.color ?? 'var(--text-muted)' }} />
                  <input
                    key={`${o.id}:${o.name}`}
                    defaultValue={o.name}
                    aria-label="Option name"
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== o.name) run(api.fields.update(f.id, { options: f.options.map((x) => (x.id === o.id ? { ...x, name } : x)) }));
                    }}
                  />
                  <button type="button" className={styles.btn} aria-label="Remove option"
                    onClick={() => run(api.fields.update(f.id, { options: f.options.filter((x) => x.id !== o.id) }))}>×</button>
                </span>
              ))}
              <button type="button" className={styles.btn} onClick={() => addOption(f)}>+ Option</button>
            </span>
          )}
        </div>
      ))}
      <div className={styles.toolbar}>
        <button type="button" className={styles.btn} onClick={() => run(api.fields.create({ tagId, name: 'New field', type: 'text' }))}>+ Field</button>
        {error && <span className={styles.muted}>{error}</span>}
      </div>
    </div>
  );
}
