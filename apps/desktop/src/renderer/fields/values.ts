import type { TagField } from '@shared/types';

const DATE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

/** The value if it fits the field's type now, otherwise null: shown blank, kept stored. */
export function coerce(field: TagField, raw: unknown): unknown {
  const known = (v: unknown): v is string => typeof v === 'string' && field.options.some((o) => o.id === v);
  switch (field.type) {
    case 'text': return typeof raw === 'string' ? raw : null;
    case 'number': return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    case 'checkbox': return typeof raw === 'boolean' ? raw : null;
    case 'date': return typeof raw === 'string' && DATE.test(raw) ? raw : null;
    case 'select': return known(raw) ? raw : null;
    case 'multi_select': {
      if (!Array.isArray(raw)) return null;
      const ids = raw.filter(known);
      return ids.length > 0 ? ids : null;
    }
  }
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** What a cell shows, and what "contains" searches. */
export function displayText(field: TagField, raw: unknown): string {
  const v = coerce(field, raw);
  if (v === null) return '';
  const name = (id: unknown): string => field.options.find((o) => o.id === id)?.name ?? '';
  switch (field.type) {
    case 'checkbox': return v ? 'Yes' : 'No';
    case 'select': return name(v);
    case 'multi_select': return (v as string[]).map(name).join(', ');
    case 'number': return String(v);
    default: return v as string;
  }
}

/** Ascending order; blank values always sort last. */
export function compareValues(field: TagField, a: unknown, b: unknown): number {
  const x = coerce(field, a);
  const y = coerce(field, b);
  if (isEmptyValue(x) || isEmptyValue(y)) return Number(isEmptyValue(x)) - Number(isEmptyValue(y));
  const rank = (id: unknown): number => field.options.findIndex((o) => o.id === id);
  switch (field.type) {
    case 'number': return (x as number) - (y as number);
    case 'checkbox': return Number(x) - Number(y);
    case 'select': return rank(x) - rank(y);
    case 'multi_select': return rank((x as string[])[0]) - rank((y as string[])[0]);
    default: return String(x).localeCompare(String(y));
  }
}
