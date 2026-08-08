// Typed wrapper around Tauri invoke().
// Mirrors the old window.cordAPI shape so CordDB components need minimal edits.
// Each method name maps 1:1 to a Rust command name in src-tauri/src/commands/.

import { invoke } from '@tauri-apps/api/core';
import type {
  Vault, CreateVaultInput, UpdateVaultInput,
  Note, NoteListItem, NoteKind, CreateNoteInput, UpdateNoteInput, NoteLinks, UnlinkedMention,
  ConversionImpact,
  Block, BlockRefTarget,
  Tag, CreateTagInput, NoteTagRow,
  NoteLink,
  FragmentAnnotationMap, CreateFragmentLinkInput, FragmentLink,
  User, RegisterInput, LoginInput, AuthSession,
} from '@shared/types';

export const api = {
  vaults: {
    list:    ()                                    => invoke<Vault[]>('vaults_list'),
    create:  (data: CreateVaultInput)              => invoke<Vault>('vaults_create', { data }),
    update:  (id: string, data: UpdateVaultInput)  => invoke<Vault>('vaults_update', { id, data }),
    archive: (id: string)                          => invoke<void>('vaults_archive', { id }),
  },

  notes: {
    list:             (vaultId: string)                          => invoke<NoteListItem[]>('notes_list', { vaultId }),
    get:              (id: string)                               => invoke<Note | null>('notes_get', { id }),
    create:           (data: CreateNoteInput)                    => invoke<Note>('notes_create', { data }),
    update:           (id: string, data: UpdateNoteInput)        => invoke<Note>('notes_update', { id, data }),
    delete:           (id: string)                               => invoke<void>('notes_delete', { id }),
    restore:          (id: string)                               => invoke<Note>('notes_restore', { id }),
    listDeleted:      (vaultId: string)                          => invoke<NoteListItem[]>('notes_list_deleted', { vaultId }),
    getLinks:         (id: string)                               => invoke<NoteLinks>('notes_get_links', { id }),
    search:           (vaultId: string, query: string)           => invoke<NoteListItem[]>('notes_search', { vaultId, query }),
    permanentDelete:  (id: string)                               => invoke<void>('notes_permanent_delete', { id }),
    unlinkedMentions: (noteId: string, vaultId: string)          => invoke<UnlinkedMention[]>('notes_unlinked_mentions', { noteId, vaultId }),
    convert:          (id: string, kind: NoteKind)               => invoke<Note>('notes_convert', { id, kind }),
    conversionImpact: (id: string)                               => invoke<ConversionImpact>('notes_conversion_impact', { id }),
  },

  blocks: {
    listForNote: (noteId: string)   => invoke<Block[]>('blocks_list_for_note', { noteId }),
    resolveRef:  (blockId: string)  => invoke<BlockRefTarget | null>('blocks_resolve_ref', { blockId }),
    reproject:   (noteId: string)   => invoke<Block[]>('blocks_reproject', { noteId }),
  },

  tags: {
    list:        (vaultId: string)                => invoke<Tag[]>('tags_list', { vaultId }),
    create:      (data: CreateTagInput)           => invoke<Tag>('tags_create', { data }),
    delete:      (tagId: string)                  => invoke<void>('tags_delete', { tagId }),
    attach:      (noteId: string, tagId: string)  => invoke<void>('tags_attach', { noteId, tagId }),
    detach:      (noteId: string, tagId: string)  => invoke<void>('tags_detach', { noteId, tagId }),
    getForNote:  (noteId: string)                 => invoke<Tag[]>('tags_get_for_note', { noteId }),
    getNoteMap:  (vaultId: string)                => invoke<NoteTagRow[]>('tags_get_note_map', { vaultId }),
  },

  links: {
    create: (fromId: string, toId: string)  => invoke<NoteLink>('links_create', { fromId, toId }),
    delete: (fromId: string, toId: string)  => invoke<void>('links_delete', { fromId, toId }),
  },

  fragments: {
    getForNote:  (noteId: string)                                                              => invoke<FragmentAnnotationMap>('fragments_get_for_note', { noteId }),
    attachTag:   (blockId: string, noteId: string, vaultId: string, tagId: string)            => invoke<void>('fragments_attach_tag', { blockId, noteId, vaultId, tagId }),
    detachTag:   (blockId: string, tagId: string)                                              => invoke<void>('fragments_detach_tag', { blockId, tagId }),
    createLink:  (data: CreateFragmentLinkInput)                                               => invoke<FragmentLink>('fragments_create_link', { data }),
    deleteLink:  (linkId: string)                                                              => invoke<void>('fragments_delete_link', { linkId }),
  },

  auth: {
    hasUsers: ()                          => invoke<{ hasUsers: boolean }>('auth_has_users'),
    register: (data: RegisterInput)       => invoke<User>('auth_register', { data }),
    login:    (data: LoginInput)          => invoke<User>('auth_login', { data }),
    logout:   ()                          => invoke<void>('auth_logout'),
    session:  ()                          => invoke<AuthSession | null>('auth_session'),
  },
} as const;
