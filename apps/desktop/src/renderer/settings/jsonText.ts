import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  SyntaxKind,
  type ParseError,
  type ParseErrorCode,
} from 'jsonc-parser';

/**
 * Reading and editing Cord's config files as text. The files are JSONC —
 * comments and trailing commas allowed — and edits touch only the key being
 * changed, so whatever else the user wrote survives.
 */

export interface SettingsProblem {
  /** The setting or binding the problem is about; null for file-level problems. */
  key: string | null;
  severity: 'error' | 'warning';
  message: string;
  /** 1-based line, for syntax errors. */
  line?: number;
}

export interface ParsedObject {
  /** The parsed object, or null when the text is not a valid JSONC object. */
  data: Record<string, unknown> | null;
  problems: SettingsProblem[];
}

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' } as const;

export function positionOf(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function describeError(code: ParseErrorCode): string {
  const words = printParseErrorCode(code).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function parseJsoncObject(text: string): ParsedObject {
  if (text.trim() === '') return { data: {}, problems: [] };

  const errors: ParseError[] = [];
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return {
      data: null,
      problems: errors.map((e) => {
        const { line, column } = positionOf(text, e.offset);
        return {
          key: null,
          severity: 'error' as const,
          message: `${describeError(e.error)} at line ${line}, column ${column}`,
          line,
        };
      }),
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      data: null,
      problems: [{ key: null, severity: 'error', message: 'The file must contain a single JSON object' }],
    };
  }
  return { data: parsed as Record<string, unknown>, problems: [] };
}

/** Offset of the first comma token in `text[from, to)`, skipping comments; -1 if none. */
function findComma(text: string, from: number, to: number): number {
  const scanner = createScanner(text.slice(from, to), true);
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.CommaToken) return from + scanner.getTokenOffset();
  }
  return -1;
}

/**
 * `text` without top-level `key`. jsonc-parser's own removal also deletes
 * everything between the preceding token and the property — including a
 * comment the user wrote above the first key — so removal is done here:
 * the property, its comma, and its line if nothing else is left on it.
 */
function removeKey(text: string, key: string): string {
  const root = parseTree(text);
  const prop = root ? findNodeAtLocation(root, [key])?.parent : undefined;
  const siblings = prop?.parent?.children;
  if (!prop || !siblings) return text;

  const i = siblings.indexOf(prop);
  let start = prop.offset;
  let end = prop.offset + prop.length;
  const next = siblings[i + 1];
  const commaAfter = findComma(text, end, next ? next.offset : text.length);
  if (next && commaAfter !== -1) {
    end = commaAfter + 1;
  } else if (i > 0) {
    const prev = siblings[i - 1]!;
    const commaBefore = findComma(text, prev.offset + prev.length, start);
    if (commaBefore !== -1) start = commaBefore;
  } else if (commaAfter !== -1) {
    end = commaAfter + 1; // a trailing comma after the only key
  }

  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline === -1 ? text.length : newline;
  if (text.slice(lineStart, start).trim() === '' && text.slice(end, lineEnd).trim() === '') {
    start = lineStart;
    end = newline === -1 ? text.length : newline + 1;
  }
  return text.slice(0, start) + text.slice(end);
}

/**
 * `text` with one top-level key set to `value`, or removed when `value` is
 * undefined. Keys are flat — `editor.fontSize` is one property, not a path.
 */
export function setKeyInText(text: string, key: string, value: unknown): string {
  if (value === undefined) return text.trim() === '' ? text : removeKey(text, key);
  const base = text.trim() === '' ? '{}' : text;
  return applyEdits(base, modify(base, [key], value, { formattingOptions: FORMATTING }));
}
