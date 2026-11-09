import type { SelectOption, TagField, TagRow, ViewConfig, ViewFilter } from '@shared/types';
import { coerce, compareValues, displayText, isEmptyValue } from './values';

/** The pseudo field id for a row's title in filters and sorting. */
export const TITLE_COLUMN = '__title';

/** A note row shows its title; a block row shows the start of its text. */
export function rowLabel(row: TagRow): string {
  if (row.kind === 'block') return (row.text ?? '').slice(0, 120) || 'Empty block';
  return row.title || 'Untitled';
}

function matches(row: TagRow, filter: ViewFilter, byId: Map<string, TagField>): boolean {
  if (filter.fieldId === TITLE_COLUMN) {
    const label = rowLabel(row).toLowerCase();
    const q = String(filter.value ?? '').toLowerCase();
    if (filter.op === 'contains') return label.includes(q);
    if (filter.op === 'is') return label === q;
    if (filter.op === 'isNot') return label !== q;
    return true;
  }
  const field = byId.get(filter.fieldId);
  if (!field) return true; // A filter on a deleted field no longer filters.
  const v = coerce(field, row.values[field.id]);
  switch (filter.op) {
    case 'isEmpty': return isEmptyValue(v);
    case 'isNotEmpty': return !isEmptyValue(v);
    case 'contains':
      return displayText(field, v).toLowerCase().includes(String(filter.value ?? '').toLowerCase());
    case 'is':
      return Array.isArray(v) ? v.includes(filter.value) : v === filter.value;
    case 'isNot':
      return Array.isArray(v) ? !v.includes(filter.value) : v !== filter.value;
    case 'before':
    case 'after': {
      if (isEmptyValue(v) || filter.value === undefined) return false;
      const c = compareValues(field, v, filter.value);
      return filter.op === 'before' ? c < 0 : c > 0;
    }
  }
}

/** The rows a view shows: every filter must match, then the saved sort. */
export function applyView(rows: readonly TagRow[], fields: readonly TagField[], config: ViewConfig): TagRow[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const out = rows.filter((r) => (config.filters ?? []).every((f) => matches(r, f, byId)));
  const sort = config.sort;
  if (!sort) return out;
  const dir = sort.dir === 'desc' ? -1 : 1;
  if (sort.fieldId === TITLE_COLUMN) {
    return out.sort((a, b) => dir * rowLabel(a).localeCompare(rowLabel(b)));
  }
  const field = byId.get(sort.fieldId);
  if (!field) return out;
  return out.sort((a, b) => {
    const x = a.values[field.id];
    const y = b.values[field.id];
    const blankX = isEmptyValue(coerce(field, x));
    const blankY = isEmptyValue(coerce(field, y));
    if (blankX || blankY) return Number(blankX) - Number(blankY); // Blanks last either way.
    return dir * compareValues(field, x, y);
  });
}

export interface RowGroup {
  option: SelectOption | null;
  rows: TagRow[];
}

/** Board columns: one per option in order, then "no value". */
export function groupRows(rows: readonly TagRow[], field: TagField): RowGroup[] {
  const groups: RowGroup[] = field.options.map((option) => ({ option, rows: [] }));
  const none: RowGroup = { option: null, rows: [] };
  for (const row of rows) {
    const v = coerce(field, row.values[field.id]);
    const first = Array.isArray(v) ? v[0] : v;
    const group = groups.find((g) => g.option?.id === first);
    (group ?? none).rows.push(row);
  }
  return [...groups, none];
}

/** The saved column order, else every field in field order. */
export function visibleColumns(fields: readonly TagField[], config: ViewConfig): TagField[] {
  if (!config.columns) return [...fields];
  const byId = new Map(fields.map((f) => [f.id, f]));
  return config.columns.flatMap((id) => byId.get(id) ?? []);
}
