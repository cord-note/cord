import type { FilterOp, TagField, ViewFilter } from '@shared/types';
import { TITLE_COLUMN } from '../../fields/query';
import { ValueEditor } from './ValueEditor';
import styles from './tags.module.css';

const OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: 'is', label: 'is', needsValue: true },
  { op: 'isNot', label: 'is not', needsValue: true },
  { op: 'contains', label: 'contains', needsValue: true },
  { op: 'isEmpty', label: 'is empty', needsValue: false },
  { op: 'isNotEmpty', label: 'is not empty', needsValue: false },
  { op: 'before', label: 'before', needsValue: true },
  { op: 'after', label: 'after', needsValue: true },
];

const TITLE_FIELD: TagField = { id: TITLE_COLUMN, tagId: '', vaultId: '', name: 'Title', type: 'text', options: [], sort: -1, createdAt: 0 };

interface Props {
  fields: TagField[];
  filters: ViewFilter[];
  onChange: (filters: ViewFilter[]) => void;
}

/** Every filter must match (AND). */
export function FilterBar({ fields, filters, onChange }: Props) {
  const set = (i: number, f: ViewFilter): void => onChange(filters.map((x, j) => (j === i ? f : x)));
  const all = [TITLE_FIELD, ...fields];

  return (
    <div className={styles.filters}>
      {filters.map((f, i) => {
        const field = all.find((x) => x.id === f.fieldId) ?? TITLE_FIELD;
        const op = OPS.find((o) => o.op === f.op) ?? OPS[0]!;
        return (
          <span key={i} className={styles.filter}>
            <select value={f.fieldId} onChange={(e) => set(i, { fieldId: e.target.value, op: f.op })} aria-label="Filter field">
              {all.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select value={f.op} onChange={(e) => set(i, { ...f, op: e.target.value as FilterOp })} aria-label="Filter rule">
              {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            {op.needsValue && (
              <ValueEditor
                field={field.type === 'multi_select' ? { ...field, type: 'select' } : field}
                value={f.value ?? null}
                onCommit={(value) => set(i, { ...f, value })}
              />
            )}
            <button type="button" className={styles.btn} onClick={() => onChange(filters.filter((_, j) => j !== i))} aria-label="Remove filter">×</button>
          </span>
        );
      })}
      <button type="button" className={styles.btn} onClick={() => onChange([...filters, { fieldId: TITLE_COLUMN, op: 'contains', value: '' }])}>
        + Filter
      </button>
    </div>
  );
}
