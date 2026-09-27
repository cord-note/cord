// Pure helpers over a stored Shuttle document (Tiptap JSON), built on
// shuttle-editor/doc so the sidecar reads exactly what the editor writes.
//
// No DB, no editor, no React — safe to import from the sidecar.
//
// Both note kinds share one document format: every top-level block node
// carries its own `blockId`. Notepads written before Shuttle wrapped each block
// in a `notepadBlock`; those open read-only and are never rewritten, but the
// index still reads through the wrapper so they stay searchable.
import { nodeText, topLevelBlocks, type DocNode } from 'shuttle-editor/doc';

export type { DocNode };

/** What an empty note stores, for both kinds. */
export const EMPTY_DOC_JSON = '{"type":"doc","content":[{"type":"paragraph"}]}';
const emptyDoc = (): DocNode => ({ type: 'doc', content: [{ type: 'paragraph' }] });

const LEGACY_WRAPPER = 'notepadBlock';

/** One top-level unit of a document, flattened for indexing. */
export interface ExtractedBlock {
  /** The node's blockId, or a deterministic synthetic id when it has none. */
  id: string;
  /** Whether `id` came from a real blockId attribute. Synthetic ids are not
   *  valid blockRef targets — they move when surrounding blocks move. */
  synthetic: boolean;
  type: string;
  sort: number;
  level: number | null;
  text: string;
  refBlockId: string | null;
  /** The content node itself, for transclusion. */
  node: DocNode;
}

/**
 * Parse a stored body into a document, falling back to an empty one.
 *
 * The column default '{}' parses cleanly but is NOT a valid doc, so the shape
 * is checked as well as the syntax.
 */
export function parseDoc(bodyJson: string): DocNode {
  try {
    const parsed: unknown = JSON.parse(bodyJson);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as DocNode).type === 'doc' &&
      Array.isArray((parsed as DocNode).content) &&
      (parsed as DocNode).content!.length > 0
    ) {
      return parsed as DocNode;
    }
  } catch {
    // Malformed JSON — fall through to an empty document.
  }
  return emptyDoc();
}

/**
 * Flatten a document's top level into indexable blocks.
 *
 * Duplicate ids are kept on the first occurrence only — it holds the original
 * position, so fragment tags and links stay where the user put them. Later ones
 * fall back to a synthetic id, which keeps them searchable while marking them
 * unsuitable as reference targets. Without this the index's primary key is
 * violated.
 */
export function extractBlocks(doc: DocNode, noteId: string): ExtractedBlock[] {
  const seen = new Set<string>();
  return topLevelBlocks(doc).map(({ index, blockId, node }) => {
    const inner = node.type === LEGACY_WRAPPER ? (node.content?.[0] ?? node) : node;
    const real = blockId !== null && !seen.has(blockId) ? blockId : null;
    if (real !== null) seen.add(real);

    const type = inner.type ?? 'paragraph';
    const ref = type === 'blockRef' ? inner.attrs?.['refBlockId'] : null;
    return {
      id: real ?? `${noteId}:${index}`,
      synthetic: real === null,
      type,
      sort: index,
      level: type === 'heading' ? Number(inner.attrs?.['level'] ?? 1) : null,
      text: nodeText(inner),
      refBlockId: typeof ref === 'string' ? ref : null,
      node: inner,
    };
  });
}

/** The stored content of a real (non-synthetic) top-level block. */
export function findBlockContent(doc: DocNode, blockId: string): DocNode | null {
  return extractBlocks(doc, '').find((b) => !b.synthetic && b.id === blockId)?.node ?? null;
}
