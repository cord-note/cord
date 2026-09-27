import { describe, it, expect } from 'bun:test';
import { parseJsoncObject, positionOf, setKeyInText } from '../jsonText';

// settings.json is meant to be edited by hand, so it allows comments and
// trailing commas, and edits made from the UI must leave the rest of the text
// — comments, order, formatting — exactly as the user wrote it.

describe('parseJsoncObject', () => {
  it('treats empty text as an empty object', () => {
    expect(parseJsoncObject('')).toEqual({ data: {}, problems: [] });
    expect(parseJsoncObject('  \n')).toEqual({ data: {}, problems: [] });
  });

  it('accepts comments and trailing commas', () => {
    const { data, problems } = parseJsoncObject('{\n  // note\n  "a.b": 1,\n}');
    expect(problems).toEqual([]);
    expect(data).toEqual({ 'a.b': 1 });
  });

  it('reports syntax errors with a line number and no data', () => {
    const { data, problems } = parseJsoncObject('{\n  "a.b": 1\n  "c.d": 2\n}');
    expect(data).toBeNull();
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.line).toBe(3);
    expect(problems[0]?.message).toMatch(/line 3/);
  });

  it('rejects a top level that is not an object', () => {
    expect(parseJsoncObject('[1]').data).toBeNull();
    expect(parseJsoncObject('3').data).toBeNull();
    expect(parseJsoncObject('null').problems[0]?.message).toMatch(/single JSON object/);
  });
});

describe('setKeyInText', () => {
  it('creates an object in empty text', () => {
    expect(JSON.parse(setKeyInText('', 'editor.fontSize', 17))).toEqual({ 'editor.fontSize': 17 });
  });

  it('adds and replaces a key while keeping comments and other keys', () => {
    const start = '{\n  // mine\n  "a.b": 1\n}';
    const added = setKeyInText(start, 'c.d', true);
    expect(added).toContain('// mine');
    expect(parseJsoncObject(added).data).toEqual({ 'a.b': 1, 'c.d': true });
    const replaced = setKeyInText(added, 'a.b', 2);
    expect(replaced).toContain('// mine');
    expect(parseJsoncObject(replaced).data).toEqual({ 'a.b': 2, 'c.d': true });
  });

  it('removes a key when the value is undefined, and ignores a missing one', () => {
    const text = '{\n  "a.b": 1,\n  "c.d": 2\n}';
    expect(parseJsoncObject(setKeyInText(text, 'a.b', undefined)).data).toEqual({ 'c.d': 2 });
    expect(setKeyInText(text, 'x.y', undefined)).toBe(text);
  });

  it('treats a dotted key as one property, not a path', () => {
    expect(parseJsoncObject(setKeyInText('{}', 'editor.fontSize', 3)).data).toEqual({ 'editor.fontSize': 3 });
  });
});

describe('positionOf', () => {
  it('maps an offset to a 1-based line and column', () => {
    expect(positionOf('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(positionOf('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });
});
