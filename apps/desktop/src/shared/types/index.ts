// DTOs that cross the IPC boundary.
// Plain data shapes only — no classes, no methods.
// Imported by both renderer and sidecar.

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  createdAt: number;
}

export interface AuthSession {
  userId: string;
  username: string;
  loggedInAt: number;
}

export interface RegisterInput {
  username: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

// ─── Vault ────────────────────────────────────────────────────────────────────

export interface Vault {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface CreateVaultInput {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateVaultInput {
  name?: string;
  description?: string;
  color?: string;
}

// ─── Note ─────────────────────────────────────────────────────────────────────

/**
 * A plain `note` is one continuous document. A `notepad` is a flat sequence of
 * addressable blocks — its document schema is `doc → block+`, so no content can
 * exist outside a block.
 */
export type NoteKind = 'note' | 'notepad';

export interface Note {
  id: string;
  vaultId: string;
  title: string;
  bodyJson: string;       // serialised Tiptap JSON document — source of truth
  kind: NoteKind;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface NoteListItem {
  id: string;
  vaultId: string;
  title: string;
  kind: NoteKind;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface CreateNoteInput {
  vaultId: string;
  title?: string;
  bodyJson?: string;
  kind?: NoteKind;
}

export interface UpdateNoteInput {
  title?: string;
  bodyJson?: string;
  isPinned?: boolean;
}

export interface UnlinkedMention {
  noteId: string;
  noteTitle: string;
  excerpt: string;
  /** Block the match was found in — lets the UI scroll straight to it. */
  blockId: string;
}

// ─── Block ────────────────────────────────────────────────────────────────────

/**
 * A row of the `blocks` index. Derived from `notes.body_json` on every save and
 * replaced wholesale — never authored directly, never the source of truth.
 * Authored per-block data (tags, links) lives in `fragments` under the same id.
 */
export interface Block {
  id: string;
  noteId: string;
  vaultId: string;
  type: string;
  sort: number;
  level: number | null;
  text: string;
  refBlockId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Resolved target of a `blockRef` node. */
export interface BlockRefTarget {
  blockId: string;
  noteId: string;
  noteTitle: string;
  type: string;
  /** The source block's Tiptap content, rendered read-only at the ref site. */
  contentJson: string;
}

// ─── Attachment ───────────────────────────────────────────────────────────────

/** An image stored beside the database; documents refer to it as `attachment:<id>`. */
export interface Attachment {
  id: string;
  vaultId: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: number;
  deletedAt: number | null;
}

export interface CreateAttachmentInput {
  vaultId: string;
  mime: string;
  dataBase64: string;
}

// ─── Link ─────────────────────────────────────────────────────────────────────

export interface NoteLink {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  createdAt: number;
}

export interface NoteLinks {
  outbound: NoteLink[];
  backlinks: NoteLink[];
}

// ─── Tag ──────────────────────────────────────────────────────────────────────

export interface Tag {
  id: string;
  vaultId: string;
  name: string;
  color: string | null;
  createdAt: number;
}

export interface CreateTagInput {
  vaultId: string;
  name: string;
  color?: string;
}

export interface NoteTagRow {
  noteId: string;
  tagId: string;
}

// ─── Fragment ─────────────────────────────────────────────────────────────────

export interface Fragment {
  id: string;
  noteId: string;
  vaultId: string;
  createdAt: number;
}

export interface FragmentLink {
  id: string;
  fromFragmentId: string;
  toNoteId: string | null;
  toFragmentId: string | null;
  vaultId: string;
  createdAt: number;
}

export interface FragmentAnnotation {
  tags: Tag[];
  links: FragmentLink[];
  backlinks: FragmentLink[];
}

export type FragmentAnnotationMap = Record<string, FragmentAnnotation>;

export interface CreateFragmentLinkInput {
  fromFragmentId: string;
  fromNoteId: string;
  vaultId: string;
  toNoteId?: string;
  toFragmentId?: string;
  toFragmentNoteId?: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  editorFontSize: number;
  editorLineWidth: number;
  spellCheck: boolean;
  unlinkedMentions: boolean;
  /** Restrict the vault colour picker to a curated high-contrast subset. */
  distinctVaultColors: boolean;
}

// ─── Operation log ────────────────────────────────────────────────────────────

export type EntityType = 'note' | 'vault' | 'tag' | 'link' | 'fragment' | 'attachment';
export type OperationType = 'create' | 'update' | 'delete';

export interface OperationLogEntry {
  id: string;
  vaultId: string;
  entityType: EntityType;
  entityId: string;
  operation: OperationType;
  payloadJson: string;
  createdAt: number;
  syncedAt: number | null;
}

// ─── Module system ────────────────────────────────────────────────────────────

export interface CordModule {
  id: string;
  name: string;
  version: string;
  tier: 'free' | 'premium';
  requires?: string[];
}

/** The user's hand-editable config files in ~/.cord. */
export type ConfigFileName = 'settings' | 'keybindings';
