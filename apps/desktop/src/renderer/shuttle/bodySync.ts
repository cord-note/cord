import * as Y from 'yjs';

/** Update origins that must not be sent back to cord-core. */
export const LOAD = 'load';
export const REMOTE = 'remote';

/** A note's Y.Doc from the state cord-core stored; empty bytes give an empty doc. */
export function loadDoc(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  if (state.length > 0) Y.applyUpdate(doc, state, LOAD);
  return doc;
}

/**
 * Collects a note's local Yjs edits and sends them as one merged update after
 * `delayMs` of quiet. A failed send keeps the update for the next try.
 */
export class BodySync {
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD || origin === REMOTE) return;
    this.pending.push(update);
    if (this.timer) clearTimeout(this.timer);
    // A failed send is kept for the next flush; `send` does the logging.
    this.timer = setTimeout(() => { this.flush().catch(() => undefined); }, this.delayMs());
  };

  constructor(
    readonly noteId: string,
    readonly doc: Y.Doc,
    private readonly send: (noteId: string, update: Uint8Array) => Promise<void>,
    private readonly delayMs: () => number,
  ) {
    doc.on('update', this.onUpdate);
  }

  /** Sends what is pending now. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.pending.length === 0) return;
    const update = Y.mergeUpdates(this.pending);
    this.pending = [];
    try {
      await this.send(this.noteId, update);
    } catch (error) {
      this.pending.unshift(update);
      throw error;
    }
  }

  /** Stops listening and sends what is pending. */
  async dispose(): Promise<void> {
    this.doc.off('update', this.onUpdate);
    await this.flush();
  }
}
