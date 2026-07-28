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

export interface Note {
  id: string;
  vaultId: string;
  title: string;
  bodyJson: string;       // serialised Tiptap JSON document
  bodyMarkdown: string;   // derived on save — never edited directly
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface NoteListItem {
  id: string;
  vaultId: string;
  title: string;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface CreateNoteInput {
  vaultId: string;
  title?: string;
  bodyJson?: string;
  bodyMarkdown?: string;
}

export interface UpdateNoteInput {
  title?: string;
  bodyJson?: string;
  bodyMarkdown?: string;
  isPinned?: boolean;
}

export interface UnlinkedMention {
  noteId: string;
  noteTitle: string;
  excerpt: string;
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

export type EntityType = 'note' | 'vault' | 'tag' | 'link' | 'fragment';
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
