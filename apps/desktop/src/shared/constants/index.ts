export const DB_FILE_NAME = 'cord.db';

export const DEBOUNCE_SAVE_MS = 500;

// Press-and-hold durations for destructive actions. Deletes are reversible
// (notes go to trash), so they hold briefly; archive is heavier and holds longer.
export const HOLD_DELETE_MS = 300;
export const HOLD_ARCHIVE_MS = 400;

export const DEFAULT_SETTINGS = {
  editorFontSize: 15,
  editorLineWidth: 720,
  spellCheck: false,
  unlinkedMentions: true,
  distinctVaultColors: false,
} as const;

// Tauri command names — kept in one place so renderer and tests stay in sync.
export const CMD = {
  VAULTS: {
    LIST:    'vaults_list',
    CREATE:  'vaults_create',
    UPDATE:  'vaults_update',
    ARCHIVE: 'vaults_archive',
  },
  NOTES: {
    LIST:              'notes_list',
    GET:               'notes_get',
    CREATE:            'notes_create',
    UPDATE:            'notes_update',
    DELETE:            'notes_delete',
    RESTORE:           'notes_restore',
    LIST_DELETED:      'notes_list_deleted',
    GET_LINKS:         'notes_get_links',
    SEARCH:            'notes_search',
    PERMANENT_DELETE:  'notes_permanent_delete',
    UNLINKED_MENTIONS: 'notes_unlinked_mentions',
  },
  TAGS: {
    LIST:          'tags_list',
    CREATE:        'tags_create',
    DELETE:        'tags_delete',
    ATTACH:        'tags_attach',
    DETACH:        'tags_detach',
    GET_FOR_NOTE:  'tags_get_for_note',
    GET_NOTE_MAP:  'tags_get_note_map',
  },
  LINKS: {
    CREATE: 'links_create',
    DELETE: 'links_delete',
  },
  FRAGMENTS: {
    GET_FOR_NOTE: 'fragments_get_for_note',
    ATTACH_TAG:   'fragments_attach_tag',
    DETACH_TAG:   'fragments_detach_tag',
    CREATE_LINK:  'fragments_create_link',
    DELETE_LINK:  'fragments_delete_link',
  },
  AUTH: {
    HAS_USERS: 'auth_has_users',
    REGISTER:  'auth_register',
    LOGIN:     'auth_login',
    LOGOUT:    'auth_logout',
    SESSION:   'auth_session',
  },
} as const;
