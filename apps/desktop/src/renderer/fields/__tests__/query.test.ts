import { describe, it, expect } from 'bun:test';
import type { TagField, TagRow } from '@shared/types';
import { applyView, groupRows, rowLabel, visibleColumns, TITLE_COLUMN } from '../query';

const status: TagField = { id: 's', tagId: 't', vaultId: 'v', name: 'Status', type: 'select', sort: 0, createdAt: 0,
  options: [{ id: 'todo', name: 'Todo', color: null }, { id: 'done', name: 'Done', color: null }] };
const due: TagField = { id: 'd', tagId: 't', vaultId: 'v', name: 'Due', type: 'date', options: [], sort: 1, createdAt: 0 };
const row = (id: string, title: string, values: Record<string, unknown>, kind: TagRow['kind'] = 'note'): TagRow =>
  ({ kind, targetId: id, noteId: id, title, text: kind === 'block' ? `text of ${id}` : null, updatedAt: 0, values });
const rows = [
  row('1', 'Write', { s: 'todo', d: '2026-12-05' }),
  row('2', 'Ship', { s: 'done', d: '2026-11-01' }),
  row('3', 'Plan', {}),
  row('4', 'Groceries', { s: 'todo' }, 'block'),
];

describe('applyView', () => {
  it('filters with AND and sorts, blanks last', () => {
    const out = applyView(rows, [status, due], {
      filters: [{ fieldId: 's', op: 'is', value: 'todo' }],
      sort: { fieldId: 'd', dir: 'asc' },
    });
    expect(out.map((r) => r.targetId)).toEqual(['1', '4']);
    expect(applyView(rows, [status, due], { filters: [{ fieldId: 'd', op: 'before', value: '2026-12-01' }] }).map((r) => r.targetId)).toEqual(['2']);
    expect(applyView(rows, [status, due], { filters: [{ fieldId: 's', op: 'isEmpty' }] }).map((r) => r.targetId)).toEqual(['3']);
    expect(applyView(rows, [status, due], { filters: [{ fieldId: TITLE_COLUMN, op: 'contains', value: 'pl' }] }).map((r) => r.targetId)).toEqual(['3']);
    expect(applyView(rows, [status, due], { sort: { fieldId: TITLE_COLUMN, dir: 'desc' } }).map((r) => r.targetId)).toEqual(['1', '4', '2', '3']);
  });

  it('ignores filters on fields that are gone', () => {
    expect(applyView(rows, [due], { filters: [{ fieldId: 's', op: 'is', value: 'todo' }] })).toHaveLength(4);
  });
});

describe('groupRows', () => {
  it('groups by option order with a "no value" column last', () => {
    const groups = groupRows(rows, status);
    expect(groups.map((g) => [g.option?.id ?? null, g.rows.map((r) => r.targetId)])).toEqual([
      ['todo', ['1', '4']], ['done', ['2']], [null, ['3']],
    ]);
  });
});

describe('columns and labels', () => {
  it('uses the saved order, else every field', () => {
    expect(visibleColumns([status, due], {}).map((f) => f.id)).toEqual(['s', 'd']);
    expect(visibleColumns([status, due], { columns: ['d', 'gone'] }).map((f) => f.id)).toEqual(['d']);
  });

  it('labels block rows by their text', () => {
    expect(rowLabel(rows[3]!)).toBe('text of 4');
    expect(rowLabel(row('5', '', {}))).toBe('Untitled');
  });
});
