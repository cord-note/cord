import { EDITOR_ELEMENTS, PUBLIC_CLASSES } from '@shared/theming/publicApi';

// Loads only what docs/theming/public-api.md allows. Anything else is dropped
// and reported, never passed through. Every rule must be scoped to the theme's
// own [data-theme="<id>"], because all library themes are loaded at once (the
// gallery previews them) and an unscoped rule would restyle the whole app.

export const THEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface SanitizeOptions {
  /** Turns a relative url() into a data: URI, or null to drop it. */
  resolveAsset: (relativePath: string) => string | null;
}

export interface SanitizedTheme {
  id: string | null;
  css: string;
  /** Human-readable reasons for everything left out. */
  dropped: string[];
}

const PSEUDO_CLASSES = new Set([
  'hover', 'active', 'focus', 'focus-visible', 'focus-within', 'disabled', 'checked',
  'first-child', 'last-child', 'only-child', 'nth-child', 'nth-last-child',
  'first-of-type', 'last-of-type', 'nth-of-type', 'empty', 'placeholder-shown',
  'not', 'is', 'where',
]);
const NESTING_PSEUDOS = new Set(['not', 'is', 'where']);
const PSEUDO_ELEMENTS = new Set([
  'before', 'after', 'placeholder', 'selection', 'marker', 'first-line', 'first-letter',
  '-webkit-scrollbar', '-webkit-scrollbar-thumb', '-webkit-scrollbar-track',
]);
const GROUPING_AT_RULES = new Set(['media', 'supports']);

export function sanitizeThemeCss(input: string, opts: SanitizeOptions): SanitizedTheme {
  const css = stripComments(input);
  const id = findThemeId(css);
  const dropped: string[] = [];
  if (!id) {
    return { id: null, css: '', dropped: ['No [data-theme="…"] selector found, so the theme has no id'] };
  }
  const out = sanitizeBlock(css, id, opts, dropped);
  return { id, css: out, dropped };
}

// ── Parsing ────────────────────────────────────────────────────────────────

function stripComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (ch === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close === -1 ? css.length : close + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function skipString(s: string, start: number): number {
  const quote = s[start];
  let i = start + 1;
  while (i < s.length && s[i] !== quote) i += s[i] === '\\' ? 2 : 1;
  return Math.min(i + 1, s.length);
}

/** Index just past the `}` matching the `{` at `open`. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"' || ch === "'") { i = skipString(s, i) - 1; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  return s.length;
}

/** Splits on `sep` outside strings, brackets and parentheses. */
function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"' || ch === "'") { i = skipString(s, i) - 1; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === sep && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts;
}

function findThemeId(css: string): string | null {
  const m = /\[\s*data-theme\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-z0-9-]+))\s*\]/i.exec(css);
  const id = m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
  return THEME_ID.test(id) ? id : null;
}

// ── Blocks and rules ───────────────────────────────────────────────────────

function sanitizeBlock(css: string, id: string, opts: SanitizeOptions, dropped: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i]!)) i++;
    if (i >= css.length) break;

    if (css[i] === '@') {
      const name = /^@([a-z-]+)/i.exec(css.slice(i))?.[1]?.toLowerCase() ?? '';
      const brace = nextOf(css, i, '{');
      const semi = nextOf(css, i, ';');
      if (semi !== -1 && (brace === -1 || semi < brace)) {
        dropped.push(`@${name} is not allowed`);
        i = semi + 1;
        continue;
      }
      if (brace === -1) break;
      const end = matchBrace(css, brace);
      const prelude = css.slice(i, brace).trim();
      const body = css.slice(brace + 1, end - 1);
      i = end;

      if (GROUPING_AT_RULES.has(name)) {
        const inner = sanitizeBlock(body, id, opts, dropped);
        if (inner.trim()) out.push(`${prelude} {\n${inner}\n}`);
      } else if (name === 'font-face') {
        const decls = sanitizeDeclarations(body, opts, dropped);
        if (decls) out.push(`@font-face { ${decls} }`);
      } else if (name === 'keyframes' || name === '-webkit-keyframes') {
        out.push(`${prelude} {${body}}`);
      } else {
        dropped.push(`@${name} is not allowed`);
      }
      continue;
    }

    const brace = nextOf(css, i, '{');
    if (brace === -1) break;
    const end = matchBrace(css, brace);
    const prelude = css.slice(i, brace).trim();
    const body = css.slice(brace + 1, end - 1);
    i = end;

    const kept: string[] = [];
    for (const raw of splitTop(prelude, ',')) {
      const selector = raw.trim();
      if (!selector) continue;
      const problem = checkSelector(selector, id);
      if (problem) dropped.push(`${selector}: ${problem}`);
      else kept.push(selector);
    }
    if (kept.length === 0) continue;
    const decls = sanitizeDeclarations(body, opts, dropped);
    if (decls) out.push(`${kept.join(',\n')} { ${decls} }`);
  }
  return out.join('\n');
}

function nextOf(s: string, from: number, ch: string): number {
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"' || c === "'") { i = skipString(s, i) - 1; continue; }
    if (c === ch) return i;
  }
  return -1;
}

function sanitizeDeclarations(body: string, opts: SanitizeOptions, dropped: string[]): string {
  const kept: string[] = [];
  for (const raw of splitTop(body, ';')) {
    const decl = raw.trim();
    if (!decl) continue;
    if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(decl)) {
      dropped.push(`${decl}: not allowed`);
      continue;
    }
    const withAssets = rewriteUrls(decl, opts);
    if (withAssets === null) {
      dropped.push(`${decl}: only files beside the theme can be used in url()`);
      continue;
    }
    kept.push(withAssets);
  }
  return kept.length ? `${kept.join('; ')};` : '';
}

/** Inlines relative url()s; null when any url() is remote or missing. */
function rewriteUrls(decl: string, opts: SanitizeOptions): string | null {
  let failed = false;
  const out = decl.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi, (_m, a, b, c) => {
    const ref = String(a ?? b ?? c ?? '').trim();
    if (/^data:(image|font)\//i.test(ref)) return `url("${ref}")`;
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref) || ref.startsWith('/')) { failed = true; return ''; }
    const data = opts.resolveAsset(ref);
    if (!data) { failed = true; return ''; }
    return `url("${data}")`;
  });
  return failed ? null : out;
}

// ── Selectors ──────────────────────────────────────────────────────────────

/** Null when the selector is allowed, otherwise why not. */
export function checkSelector(selector: string, id: string): string | null {
  const compounds = splitCompounds(selector);
  if (compounds.length === 0) return 'empty selector';
  if (!scopes(compounds[0]!, id)) return `must start with [data-theme="${id}"]`;

  let inEditor = false;
  for (let n = 0; n < compounds.length; n++) {
    const problem = checkCompound(compounds[n]!, { id, first: n === 0, inEditor });
    if (problem) return problem;
    if (/\.cord-editor__body(?![\w-])/.test(compounds[n]!)) inEditor = true;
  }
  return null;
}

/** Compound selectors, with combinators dropped. */
function splitCompounds(selector: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]!;
    if (ch === '"' || ch === "'") { const end = skipString(selector, i); cur += selector.slice(i, end); i = end - 1; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~')) {
      if (cur) parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function scopes(compound: string, id: string): boolean {
  const re = /\[\s*data-theme\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-z0-9-]+))\s*\]/gi;
  for (const m of compound.matchAll(re)) if ((m[1] ?? m[2] ?? m[3]) === id) return true;
  return false;
}

interface Context { id: string; first: boolean; inEditor: boolean }

function checkCompound(compound: string, ctx: Context): string | null {
  let i = 0;
  const s = compound;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;

    if ((m = /^[a-z][a-z0-9]*/i.exec(rest))) {
      const tag = m[0].toLowerCase();
      if (tag === 'html' ? !ctx.first : !(ctx.inEditor && EDITOR_ELEMENTS.has(tag))) {
        return `element "${tag}" is only allowed inside .cord-editor__body`;
      }
      i += m[0].length;
    } else if ((m = /^\.(-?[_a-z][\w-]*)/i.exec(rest))) {
      if (!PUBLIC_CLASSES.has(m[1]!)) return `.${m[1]} is not a public class`;
      i += m[0].length;
    } else if (rest.startsWith('[')) {
      const end = s.indexOf(']', i);
      if (end === -1) return 'unclosed attribute selector';
      const attr = /^\[\s*([\w-]+)/.exec(s.slice(i, end + 1))?.[1] ?? '';
      if (attr !== 'data-theme' && attr !== 'data-scheme') return `[${attr}] is not allowed`;
      if (attr === 'data-theme' && !scopes(s.slice(i, end + 1), ctx.id)) return 'targets another theme';
      i = end + 1;
    } else if ((m = /^::([\w-]+)/.exec(rest))) {
      if (!PSEUDO_ELEMENTS.has(m[1]!.toLowerCase())) return `::${m[1]} is not allowed`;
      i += m[0].length;
    } else if ((m = /^:([\w-]+)/.exec(rest))) {
      const name = m[1]!.toLowerCase();
      i += m[0].length;
      if (name === 'root') {
        if (!ctx.first) return ':root must come first';
        continue;
      }
      if (!PSEUDO_CLASSES.has(name)) return `:${name} is not allowed`;
      if (s[i] === '(') {
        const close = closingParen(s, i);
        const inner = s.slice(i + 1, close);
        if (NESTING_PSEUDOS.has(name)) {
          for (const part of splitTop(inner, ',')) {
            for (const c of splitCompounds(part.trim())) {
              const problem = checkCompound(c, { ...ctx, first: false });
              if (problem) return problem;
            }
          }
        }
        i = close + 1;
      }
    } else if (rest.startsWith('*')) {
      return 'the universal selector * is not allowed';
    } else if (rest.startsWith('#')) {
      return 'id selectors are not allowed';
    } else if (rest.startsWith('&')) {
      return 'nested rules are not allowed';
    } else {
      return `unexpected "${rest[0]}"`;
    }
  }
  return null;
}

function closingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return s.length - 1;
}
