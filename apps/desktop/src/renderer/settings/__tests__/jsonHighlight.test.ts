import { describe, it, expect } from 'bun:test';
import { tokenizeJsonc, lineOfKey } from '../jsonHighlight';

const kinds = (text: string) =>
  tokenizeJsonc(text).filter((t) => t.kind !== 'plain').map((t) => `${t.kind}:${t.text}`);

describe('tokenizeJsonc', () => {
  it('tells keys from string values', () => {
    expect(kinds('{ "a": "b" }')).toEqual(['punct:{', 'key:"a"', 'punct::', 'string:"b"', 'punct:}']);
  });

  it('colours numbers, literals and comments', () => {
    expect(kinds('// hi\n{"n": -1.5e3, "t": true, /* x */ "z": null}')).toEqual([
      'comment:// hi', 'punct:{', 'key:"n"', 'punct::', 'number:-1.5e3', 'punct:,',
      'key:"t"', 'punct::', 'literal:true', 'punct:,', 'comment:/* x */',
      'key:"z"', 'punct::', 'literal:null', 'punct:}',
    ]);
  });

  it('keeps escaped quotes inside a string', () => {
    expect(kinds('"a\\"b"')).toEqual(['string:"a\\"b"']);
  });

  it('round-trips the text exactly, even when half typed', () => {
    const text = '{\n  "editor.fontSize": 1\n  "unterminated\n  /* open';
    expect(tokenizeJsonc(text).map((t) => t.text).join('')).toBe(text);
  });
});

describe('lineOfKey', () => {
  it('finds the line a key is on', () => {
    expect(lineOfKey('{\n  "a": 1,\n  "b": 2\n}', 'b')).toBe(3);
    expect(lineOfKey('{}', 'missing')).toBeUndefined();
  });
});
