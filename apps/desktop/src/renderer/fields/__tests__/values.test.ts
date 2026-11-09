import { describe, it, expect } from 'bun:test';
import type { TagField } from '@shared/types';
import { coerce, compareValues, displayText, isEmptyValue } from '../values';

const field = (type: TagField['type'], options: TagField['options'] = []): TagField =>
  ({ id: 'f', tagId: 't', vaultId: 'v', name: 'F', type, options, sort: 0, createdAt: 0 });
const status = field('select', [{ id: 'a', name: 'Todo', color: null }, { id: 'b', name: 'Done', color: '#0f0' }]);

describe('coerce', () => {
  it('passes values that fit and blanks the rest', () => {
    expect(coerce(field('text'), 'hi')).toBe('hi');
    expect(coerce(field('text'), 3)).toBeNull();
    expect(coerce(field('number'), 3)).toBe(3);
    expect(coerce(field('checkbox'), true)).toBe(true);
    expect(coerce(field('date'), '2026-12-01')).toBe('2026-12-01');
    expect(coerce(field('date'), 'soon')).toBeNull();
    expect(coerce(status, 'a')).toBe('a');
    expect(coerce(status, 'gone')).toBeNull();
    expect(coerce(field('multi_select', status.options), ['a', 'gone', 'b'])).toEqual(['a', 'b']);
  });
});

describe('displayText and comparing', () => {
  it('shows option names and sorts by option order', () => {
    expect(displayText(status, 'b')).toBe('Done');
    expect(displayText(field('checkbox'), true)).toBe('Yes');
    expect(displayText(field('multi_select', status.options), ['a', 'b'])).toBe('Todo, Done');
    expect(compareValues(status, 'a', 'b')).toBeLessThan(0);
    expect(compareValues(field('number'), 2, 10)).toBeLessThan(0);
    expect(compareValues(field('text'), null, 'x')).toBeGreaterThan(0);
  });

  it('knows empty values', () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(false)).toBe(false);
  });
});
