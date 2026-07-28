import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id:           text('id').primaryKey(),
  username:     text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt:    integer('created_at').notNull(),
});

// ─── Vaults ───────────────────────────────────────────────────────────────────

export const vaults = sqliteTable('vaults', {
  id:          text('id').primaryKey(),
  userId:      text('user_id').references(() => users.id),
  name:        text('name').notNull(),
  description: text('description'),
  color:       text('color'),
  createdAt:   integer('created_at').notNull(),
  updatedAt:   integer('updated_at').notNull(),
  archivedAt:  integer('archived_at'),
});

// ─── Notes ────────────────────────────────────────────────────────────────────

export const notes = sqliteTable(
  'notes',
  {
    id:           text('id').primaryKey(),
    vaultId:      text('vault_id').notNull().references(() => vaults.id),
    title:        text('title').notNull().default(''),
    bodyJson:     text('body_json').notNull().default('{}'),
    bodyMarkdown: text('body_markdown').notNull().default(''),
    isPinned:     integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
    createdAt:    integer('created_at').notNull(),
    updatedAt:    integer('updated_at').notNull(),
    deletedAt:    integer('deleted_at'),
  },
  (t) => ({
    vaultIdx: index('idx_notes_vault').on(t.vaultId, t.deletedAt),
  }),
);

// ─── Note links ───────────────────────────────────────────────────────────────

export const noteLinks = sqliteTable(
  'note_links',
  {
    id:         text('id').primaryKey(),
    fromNoteId: text('from_note_id').notNull().references(() => notes.id),
    toNoteId:   text('to_note_id').notNull().references(() => notes.id),
    createdAt:  integer('created_at').notNull(),
  },
  (t) => ({
    fromIdx: index('idx_note_links_from').on(t.fromNoteId),
    toIdx:   index('idx_note_links_to').on(t.toNoteId),
    uniq:    uniqueIndex('uq_note_links').on(t.fromNoteId, t.toNoteId),
  }),
);

// ─── Tags ─────────────────────────────────────────────────────────────────────

export const tags = sqliteTable(
  'tags',
  {
    id:        text('id').primaryKey(),
    vaultId:   text('vault_id').notNull().references(() => vaults.id),
    name:      text('name').notNull(),
    color:     text('color'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    vaultIdx: index('idx_tags_vault').on(t.vaultId),
    uniq:     uniqueIndex('uq_tags_vault_name').on(t.vaultId, t.name),
  }),
);

// ─── Note ↔ Tag ───────────────────────────────────────────────────────────────

export const noteTags = sqliteTable(
  'note_tags',
  {
    noteId:    text('note_id').notNull().references(() => notes.id),
    tagId:     text('tag_id').notNull().references(() => tags.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    pk:      primaryKey({ columns: [t.noteId, t.tagId] }),
    noteIdx: index('idx_note_tags_note').on(t.noteId),
    tagIdx:  index('idx_note_tags_tag').on(t.tagId),
  }),
);

// ─── Fragments ────────────────────────────────────────────────────────────────

export const fragments = sqliteTable('fragments', {
  id:        text('id').primaryKey(),
  noteId:    text('note_id').notNull().references(() => notes.id),
  vaultId:   text('vault_id').notNull().references(() => vaults.id),
  createdAt: integer('created_at').notNull(),
});

export const fragmentTags = sqliteTable(
  'fragment_tags',
  {
    fragmentId: text('fragment_id').notNull().references(() => fragments.id),
    tagId:      text('tag_id').notNull().references(() => tags.id),
    createdAt:  integer('created_at').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.fragmentId, t.tagId] }) }),
);

export const fragmentLinks = sqliteTable('fragment_links', {
  id:             text('id').primaryKey(),
  fromFragmentId: text('from_fragment_id').notNull().references(() => fragments.id),
  toNoteId:       text('to_note_id').references(() => notes.id),
  toFragmentId:   text('to_fragment_id'),
  vaultId:        text('vault_id').notNull().references(() => vaults.id),
  createdAt:      integer('created_at').notNull(),
});

// ─── Operation log ────────────────────────────────────────────────────────────

export const operationLog = sqliteTable(
  'operation_log',
  {
    id:          text('id').primaryKey(),
    vaultId:     text('vault_id').notNull(),
    entityType:  text('entity_type').notNull(),
    entityId:    text('entity_id').notNull(),
    operation:   text('operation').notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt:   integer('created_at').notNull(),
    syncedAt:    integer('synced_at'),
  },
  (t) => ({
    unsyncedIdx: index('idx_oplog_unsynced').on(t.syncedAt),
  }),
);

// ─── Schema export ────────────────────────────────────────────────────────────

export const schema = {
  users,
  vaults,
  notes,
  noteLinks,
  tags,
  noteTags,
  fragments,
  fragmentTags,
  fragmentLinks,
  operationLog,
};
