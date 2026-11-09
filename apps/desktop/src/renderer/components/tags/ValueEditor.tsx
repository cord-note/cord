import { useEffect, useState } from 'react';
import type { TagField } from '@shared/types';
import { coerce } from '../../fields/values';
import styles from './tags.module.css';

interface Props {
  field: TagField;
  value: unknown;
  /** null clears the value. */
  onCommit: (value: unknown) => void;
}

/** Edits one cell. Text and numbers commit on blur or Enter; the rest at once. */
export function ValueEditor({ field, value, onCommit }: Props) {
  const v = coerce(field, value);
  const shown = v === null ? '' : String(v);
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);

  const commitText = (): void => {
    const next = field.type === 'number' ? (draft.trim() === '' ? null : Number(draft)) : (draft === '' ? null : draft);
    if (next !== null && field.type === 'number' && !Number.isFinite(next)) return;
    if (next !== v) onCommit(next);
  };

  switch (field.type) {
    case 'text':
    case 'number':
      return (
        <input
          className={styles.cellInput}
          type={field.type === 'number' ? 'number' : 'text'}
          value={draft}
          placeholder="—"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label={field.name}
        />
      );
    case 'checkbox':
      return <input type="checkbox" checked={v === true} onChange={(e) => onCommit(e.target.checked)} aria-label={field.name} />;
    case 'date':
      return (
        <input
          className={styles.cellInput}
          type="date"
          data-empty={v === null}
          value={typeof v === 'string' ? v.slice(0, 10) : ''}
          onChange={(e) => onCommit(e.target.value === '' ? null : e.target.value)}
          aria-label={field.name}
        />
      );
    case 'select':
      return (
        <select
          className={styles.cellInput}
          value={typeof v === 'string' ? v : ''}
          onChange={(e) => onCommit(e.target.value === '' ? null : e.target.value)}
          aria-label={field.name}
        >
          <option value="">—</option>
          {field.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      );
    case 'multi_select': {
      const chosen = Array.isArray(v) ? (v as string[]) : [];
      const toggle = (id: string): void => {
        const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
        onCommit(next.length === 0 ? null : next);
      };
      return (
        <span className={styles.editor}>
          {field.options.map((o) => (
            <button key={o.id} type="button" className={styles.pill} aria-pressed={chosen.includes(o.id)} onClick={() => toggle(o.id)}>
              <span className={styles.dot} style={{ background: o.color ?? 'var(--text-muted)' }} />{o.name}
            </button>
          ))}
          {field.options.length === 0 && <span className={styles.muted}>No options yet</span>}
        </span>
      );
    }
  }
}
