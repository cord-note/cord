import { createRoot } from 'react-dom/client';
import type { TagViewControls } from 'shuttle-editor';
import { TagViewEmbed } from './TagViewEmbed';

/**
 * Draws a tag view into the box Shuttle gives it, as its own React root in its
 * own element, so a redraw never shares a container with the root it replaces.
 * Unmounting is deferred: Shuttle may call cleanup while React is rendering.
 */
export function mountTagView(
  container: HTMLElement, viewId: string, controls: TagViewControls,
  onOpen: (noteId: string, blockId?: string) => void,
): () => void {
  const el = document.createElement('div');
  container.appendChild(el);
  const root = createRoot(el);
  root.render(<TagViewEmbed viewId={viewId} onOpen={onOpen} onRemove={() => controls.remove()} />);
  return () => {
    queueMicrotask(() => {
      root.unmount();
      el.remove();
    });
  };
}
