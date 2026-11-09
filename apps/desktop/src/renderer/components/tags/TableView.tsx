import type { TagField, TagRow, ViewSort } from '@shared/types';
import { rowLabel, TITLE_COLUMN } from '../../fields/query';
import { ValueEditor } from './ValueEditor';
import styles from './tags.module.css';

interface Props {
  rows: TagRow[];
  columns: TagField[];
  sort: ViewSort | null;
  onSort: (sort: ViewSort | null) => void;
  onOpen: (row: TagRow) => void;
  onSetValue: (row: TagRow, field: TagField, value: unknown) => void;
}

/** Clicking a header sorts ascending, then descending, then not at all. */
function nextSort(current: ViewSort | null, fieldId: string): ViewSort | null {
  if (current?.fieldId !== fieldId) return { fieldId, dir: 'asc' };
  return current.dir === 'asc' ? { fieldId, dir: 'desc' } : null;
}

export function TableView({ rows, columns, sort, onSort, onOpen, onSetValue }: Props) {
  const arrow = (id: string): string => (sort?.fieldId === id ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '');
  if (rows.length === 0) return <p className={styles.muted}>Nothing here yet. Tag a note or a block to add a row.</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th onClick={() => onSort(nextSort(sort, TITLE_COLUMN))}>Title{arrow(TITLE_COLUMN)}</th>
            {columns.map((c) => <th key={c.id} onClick={() => onSort(nextSort(sort, c.id))}>{c.name}{arrow(c.id)}</th>)}
            <th>Where</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.kind}:${row.targetId}`}>
              <td><button type="button" className={styles.rowTitle} onClick={() => onOpen(row)}>{rowLabel(row)}</button></td>
              {columns.map((c) => (
                <td key={c.id}><ValueEditor field={c} value={row.values[c.id] ?? null} onCommit={(v) => onSetValue(row, c, v)} /></td>
              ))}
              <td className={styles.where}>{row.kind === 'block' ? `Block in ${row.title || 'Untitled'}` : 'Note'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
