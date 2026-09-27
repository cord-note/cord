import { BLOCK_ID_ATTRIBUTE } from 'shuttle-editor';

/** Selector for the element that renders block `blockId`. */
export const blockSelector = (blockId: string): string => `[${BLOCK_ID_ATTRIBUTE}="${CSS.escape(blockId)}"]`;

/** The element that renders block `blockId`, or null. Block ids are unique in a document. */
export function blockElement(root: HTMLElement, blockId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(blockSelector(blockId));
}

/**
 * The id of the top-level block containing `target`.
 *
 * Nested paragraphs (in lists, table cells, toggles) carry ids of their own, so
 * `closest()` alone would answer with the inner one. This climbs to the
 * editor's direct child instead. A table renders inside a `.tableWrapper` that
 * does not carry the attribute — the table one level down does.
 */
export function topLevelBlockId(root: HTMLElement, target: EventTarget | null): string | null {
  let el = target instanceof Node ? (target instanceof HTMLElement ? target : target.parentElement) : null;
  while (el && el.parentElement !== root) el = el.parentElement;
  if (!el) return null;
  return el.getAttribute(BLOCK_ID_ATTRIBUTE)
    ?? el.querySelector(`[${BLOCK_ID_ATTRIBUTE}]`)?.getAttribute(BLOCK_ID_ATTRIBUTE)
    ?? null;
}
