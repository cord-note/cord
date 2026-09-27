import type { DocNode } from '@shared/blockDoc';

/** Shorter titles ("AI", "Go") match too much ordinary prose to be useful. */
const MIN_TITLE_LENGTH = 3;

export interface MentionCandidate {
  id: string;
  title: string;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Notes whose title appears in the document as a whole word but that it does
 * not wiki-link yet, excluding the note itself. Word boundaries are
 * Unicode-aware, so "Café" is not found inside "Cafés".
 */
export function outboundMentions<T extends MentionCandidate>(
  doc: DocNode,
  notes: readonly T[],
  currentNoteId: string,
): T[] {
  const linked = new Set<string>();
  const parts: string[] = [];
  (function walk(n: DocNode): void {
    if (n.type === 'mention') {
      const id = n.attrs?.['id'];
      if (typeof id === 'string') linked.add(id);
      return;
    }
    if (typeof n.text === 'string') parts.push(n.text);
    n.content?.forEach(walk);
  })(doc);
  const text = parts.join(' ');

  return notes.filter((n) => {
    if (n.id === currentNoteId || linked.has(n.id)) return false;
    const title = n.title.trim();
    if (title.length < MIN_TITLE_LENGTH) return false;
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(title)}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
  });
}
