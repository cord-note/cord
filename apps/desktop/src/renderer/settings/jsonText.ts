import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
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

/**
 * `text` with one top-level key set to `value`, or removed when `value` is
 * undefined. Keys are flat — `editor.fontSize` is one property, not a path.
 */
export function setKeyInText(text: string, key: string, value: unknown): string {
  const base = text.trim() === '' ? '{}' : text;
  const edits = modify(base, [key], value, { formattingOptions: FORMATTING });
  if (edits.length === 0) return text.trim() === '' && value === undefined ? text : base;
  return applyEdits(base, edits);
}
