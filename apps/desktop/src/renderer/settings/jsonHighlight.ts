// Tokens for colouring settings.json (JSON with comments) in the JSON view.
// Lenient on purpose: half-typed text must still colour sensibly.

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'comment' | 'punct' | 'plain';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/;
const LITERAL = /^(true|false|null)\b/;

export function tokenizeJsonc(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = 0;

  const push = (kind: JsonTokenKind, end: number): void => {
    const last = tokens[tokens.length - 1];
    const chunk = text.slice(i, end);
    if (last && last.kind === kind && kind === 'plain') last.text += chunk;
    else tokens.push({ kind, text: chunk });
    i = end;
  };

  while (i < text.length) {
    const ch = text[i]!;
    const rest = text.slice(i);

    if (rest.startsWith('//')) {
      const nl = text.indexOf('\n', i);
      push('comment', nl === -1 ? text.length : nl);
    } else if (rest.startsWith('/*')) {
      const close = text.indexOf('*/', i + 2);
      push('comment', close === -1 ? text.length : close + 2);
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      const end = Math.min(text[j] === '"' ? j + 1 : j, text.length);
      push(isKey(text, end) ? 'key' : 'string', end);
    } else if ('{}[]:,'.includes(ch)) {
      push('punct', i + 1);
    } else {
      const num = NUMBER.exec(rest);
      const lit = num ? null : LITERAL.exec(rest);
      if (num) push('number', i + num[0].length);
      else if (lit) push('literal', i + lit[0].length);
      else push('plain', i + 1);
    }
  }
  return tokens;
}

/** A string is a key when the next non-space character is a colon. */
function isKey(text: string, from: number): boolean {
  for (let j = from; j < text.length; j++) {
    const c = text[j]!;
    if (c === ':') return true;
    if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') return false;
  }
  return false;
}

/** 1-based line of `"key"` in the text, or undefined when it isn't there. */
export function lineOfKey(text: string, key: string): number | undefined {
  const at = text.indexOf(JSON.stringify(key));
  if (at === -1) return undefined;
  let line = 1;
  for (let j = 0; j < at; j++) if (text[j] === '\n') line++;
  return line;
}
