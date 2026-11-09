import { useState } from 'react';
import type { TagField, TagRow } from '@shared/types';
import { groupRows, rowLabel } from '../../fields/query';
import { displayText } from '../../fields/values';
import styles from './tags.module.css';

interface Props {
  rows: TagRow[];
  groupBy: TagField;
  cardFields: TagField[];
  onOpen: (row: TagRow) => void;
  onSetValue: (row: TagRow, field: TagField, value: unknown) => void;
}

/** Columns from a select field; dropping a card sets its value. */
export function BoardView({ rows, groupBy, cardFields, onOpen, onSetValue }: Props) {
  const [over, setOver] = useState<string | null>(null);
  const key = (r: TagRow): string => `${r.kind}:${r.targetId}`;
  const byKey = new Map(rows.map((r) => [key(r), r]));

  return (
    <div className={styles.board}>
      {groupRows(rows, groupBy).map((g) => {
        const id = g.option?.id ?? '';
        return (
          <div
            key={id || 'none'}
            className={styles.column}
            data-over={over === id}
            onDragOver={(e) => { e.preventDefault(); setOver(id); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const row = byKey.get(e.dataTransfer.getData('text/plain'));
              if (row) onSetValue(row, groupBy, groupBy.type === 'multi_select' ? (id ? [id] : null) : (id || null));
            }}
          >
            <div className={styles.columnHead}>
              <span className={styles.dot} style={{ background: g.option?.color ?? 'var(--text-muted)' }} />
              {g.option?.name ?? 'No value'} <span className={styles.muted}>{g.rows.length}</span>
            </div>
            {g.rows.map((r) => (
              <div key={key(r)} className={styles.card} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', key(r))}>
                <button type="button" className={styles.rowTitle} onClick={() => onOpen(r)}>{rowLabel(r)}</button>
                {cardFields.filter((f) => f.id !== groupBy.id).map((f) => {
                  const text = displayText(f, r.values[f.id]);
                  return text ? <span key={f.id} className={styles.muted}>{f.name}: {text}</span> : null;
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
