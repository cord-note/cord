import type { BlockSummary, FragmentActionType, NoteRef, ShuttleHost, KeybindingId } from 'shuttle-editor';
import type { Attachment, Block, BlockRefTarget, CreateAttachmentInput } from '@shared/types';
import type { LogLevel } from '../lib/log';

const ATTACHMENT_PREFIX = 'attachment:';
const ATTACHMENT_SCHEME = 'cord-attachment';
const SEARCH_LIMIT = 20;

/** The slice of a note the host reads. */
export interface HostNote {
  id: string;
  title: string;
  deletedAt: number | null;
}

/**
 * Everything the host needs from Cord, injected so it can be tested without
 * Tauri, the stores or IPC.
 */
export interface CordHostDeps {
  getNotes(): readonly HostNote[];
  getActiveVaultId(): string | null;
  api: {
    blocks: {
      listForNote(noteId: string): Promise<Block[]>;
      resolveRef(blockId: string): Promise<BlockRefTarget | null>;
    };
    attachments: { create(input: CreateAttachmentInput): Promise<Attachment> };
    fragments: { deleteLink(linkId: string): Promise<void> };
  };
  /** Tauri's `convertFileSrc`. */
  convertFileSrc(path: string, protocol: string): string;
  openNote(noteId: string, blockId?: string): void;
  onFragmentAction(action: { docKey: string; type: FragmentActionType; blockId: string }): void;
  reloadFragments(noteId: string): void;
  /** Wiki links changed in the editor; the next save will re-derive note_links. */
  onLinksMaybeChanged(docKey: string): void;
  keybindingOverrides: Partial<Record<KeybindingId, string>>;
  log(level: LogLevel, scope: string, message: string, data?: unknown): void;
}

const toRef = (n: HostNote): NoteRef => ({ id: n.id, title: n.title });

/** Base64 of a file's bytes, chunked so large images don't overflow the stack. */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Cord's `ShuttleHost`. Build a new one whenever the note list changes: Shuttle
 * refreshes unlinked-mention highlighting when the host's identity changes.
 */
export function createCordHost(deps: CordHostDeps): ShuttleHost {
  const live = (): HostNote[] => deps.getNotes().filter((n) => n.deletedAt === null);

  // Shuttle caches its title matcher by array identity, so hand back the same
  // array until the store's note list itself changes.
  let titlesFor: readonly HostNote[] | null = null;
  let titles: NoteRef[] = [];

  return {
    searchNotes: async (query) => {
      const q = query.trim().toLowerCase();
      return live().filter((n) => n.title.toLowerCase().includes(q)).slice(0, SEARCH_LIMIT).map(toRef);
    },

    findNoteByTitle: (title) => {
      const t = title.trim().toLowerCase();
      if (!t) return null;
      const hit = live().find((n) => n.title.trim().toLowerCase() === t);
      return hit ? toRef(hit) : null;
    },

    listNoteTitles: () => {
      const notes = deps.getNotes();
      if (notes !== titlesFor) {
        titlesFor = notes;
        titles = live().map(toRef);
      }
      return titles;
    },

    listBlocks: async (noteId) => (await deps.api.blocks.listForNote(noteId)).map((b): BlockSummary => ({
      id: b.id, noteId: b.noteId, type: b.type, text: b.text, level: b.level,
    })),

    resolveBlock: async (blockId) => {
      const target = await deps.api.blocks.resolveRef(blockId);
      if (!target) return null;
      return {
        blockId: target.blockId,
        noteId: target.noteId,
        noteTitle: target.noteTitle,
        content: JSON.parse(target.contentJson) as Record<string, unknown>,
      };
    },

    resolveFileSrc: (src) => (src.startsWith(ATTACHMENT_PREFIX)
      ? deps.convertFileSrc(src.slice(ATTACHMENT_PREFIX.length), ATTACHMENT_SCHEME)
      : src),

    uploadFile: async (file) => {
      const vaultId = deps.getActiveVaultId();
      if (!vaultId) throw new Error('No active vault to store the file in');
      const attachment = await deps.api.attachments.create({ vaultId, mime: file.type, dataBase64: await fileToBase64(file) });
      return { src: `${ATTACHMENT_PREFIX}${attachment.id}` };
    },

    onLinksChanged: (docKey) => deps.onLinksMaybeChanged(docKey),

    onFragmentLinksRemoved: (docKey, linkIds) => {
      void Promise.all(linkIds.map((id) => deps.api.fragments.deleteLink(id)))
        .catch((error: unknown) => deps.log('warn', 'shuttle', 'Deleting fragment links failed', { docKey, error: String(error) }))
        .finally(() => deps.reloadFragments(docKey));
    },

    onFragmentAction: (action) => deps.onFragmentAction(action),
    openNote: (noteId, blockId) => deps.openNote(noteId, blockId),
    log: (level, message, data) => deps.log(level, 'shuttle', message, data),
    keybindings: deps.keybindingOverrides,
  };
}
