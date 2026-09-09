import { getRawSqlite } from './client';

type Db = ReturnType<typeof getRawSqlite>;

/** Column names of an existing table. Empty if the table does not exist. */
function columnsOf(db: Db, table: string): string[] {
  try {
    const rows = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

/** True if a table — including a virtual table — already exists. */
function tableExists(db: Db, table: string): boolean {
  const row = db
    .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== null;
}

/** ALTER TABLE ADD COLUMN is not idempotent in SQLite — guard on table_info. */
function addColumnIfMissing(db: Db, table: string, column: string, ddl: string): void {
  const cols = columnsOf(db, table);
  if (cols.length === 0 || cols.includes(column)) return;
  db.run(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  console.info(`[db] added ${table}.${column}`);
}

/** Neither is DROP COLUMN. Guard so re-running the migration is a no-op. */
function dropColumnIfPresent(db: Db, table: string, column: string): void {
  if (!columnsOf(db, table).includes(column)) return;
  db.run(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
  console.info(`[db] dropped ${table}.${column}`);
}

/**
 * Full-text index over `blocks.text`, read directly by the Tauri search command.
 *
 * External-content, so the text is not duplicated — `blocks` stays the only
 * copy. The trigram tokenizer is deliberate: it gives substring matching
 * identical to the `LIKE '%q%'` this replaces, so moving search into Rust is a
 * latency change and not a behaviour change.
 *
 * Maintained by triggers rather than by BlockIndexService, because the sidecar
 * owns every write to `blocks` and a future sync receiver reprojecting locally
 * is exactly the caller most likely to forget an explicit index call.
 */
function createBlocksFts(db: Db): void {
  const alreadyBuilt = tableExists(db, 'blocks_fts');

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS \`blocks_fts\` USING fts5(
    text,
    content='blocks',
    content_rowid='rowid',
    tokenize='trigram'
  )`);

  db.run(`CREATE TRIGGER IF NOT EXISTS \`blocks_fts_ai\` AFTER INSERT ON \`blocks\` BEGIN
    INSERT INTO \`blocks_fts\`(rowid, text) VALUES (new.rowid, new.text);
  END`);

  // An external-content table cannot recover the old text itself, so a removal
  // has to be announced with the value being removed. Get this wrong and the
  // index keeps matching text that no longer exists.
  db.run(`CREATE TRIGGER IF NOT EXISTS \`blocks_fts_ad\` AFTER DELETE ON \`blocks\` BEGIN
    INSERT INTO \`blocks_fts\`(\`blocks_fts\`, rowid, text) VALUES('delete', old.rowid, old.text);
  END`);

  db.run(`CREATE TRIGGER IF NOT EXISTS \`blocks_fts_au\` AFTER UPDATE ON \`blocks\` BEGIN
    INSERT INTO \`blocks_fts\`(\`blocks_fts\`, rowid, text) VALUES('delete', old.rowid, old.text);
    INSERT INTO \`blocks_fts\`(rowid, text) VALUES (new.rowid, new.text);
  END`);

  // Only on first creation. Re-running migrations must not re-scan every vault.
  if (!alreadyBuilt) {
    db.run(`INSERT INTO \`blocks_fts\`(\`blocks_fts\`) VALUES('rebuild')`);
    console.info('[db] blocks_fts index built');
  }
}

export function runMigrations(): void {
  const db = getRawSqlite();

  db.run(`CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`username\` text NOT NULL,
    \`password_hash\` text NOT NULL,
    \`created_at\` integer NOT NULL
  )`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS \`users_username_unique\` ON \`users\` (\`username\`)`);

  db.run(`CREATE TABLE IF NOT EXISTS \`vaults\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`user_id\` text,
    \`name\` text NOT NULL,
    \`description\` text,
    \`color\` text,
    \`created_at\` integer NOT NULL,
    \`updated_at\` integer NOT NULL,
    \`archived_at\` integer,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS \`notes\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`vault_id\` text NOT NULL,
    \`title\` text DEFAULT '' NOT NULL,
    \`body_json\` text DEFAULT '{}' NOT NULL,
    \`kind\` text DEFAULT 'note' NOT NULL,
    \`is_pinned\` integer DEFAULT false NOT NULL,
    \`created_at\` integer NOT NULL,
    \`updated_at\` integer NOT NULL,
    \`deleted_at\` integer,
    FOREIGN KEY (\`vault_id\`) REFERENCES \`vaults\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_notes_vault\` ON \`notes\` (\`vault_id\`, \`deleted_at\`)`);

  db.run(`CREATE TABLE IF NOT EXISTS \`note_links\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`from_note_id\` text NOT NULL,
    \`to_note_id\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    FOREIGN KEY (\`from_note_id\`) REFERENCES \`notes\`(\`id\`) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (\`to_note_id\`) REFERENCES \`notes\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_note_links_from\` ON \`note_links\` (\`from_note_id\`)`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_note_links_to\` ON \`note_links\` (\`to_note_id\`)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS \`uq_note_links\` ON \`note_links\` (\`from_note_id\`, \`to_note_id\`)`);

  db.run(`CREATE TABLE IF NOT EXISTS \`tags\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`vault_id\` text NOT NULL,
    \`name\` text NOT NULL,
    \`color\` text,
    \`created_at\` integer NOT NULL,
    FOREIGN KEY (\`vault_id\`) REFERENCES \`vaults\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_tags_vault\` ON \`tags\` (\`vault_id\`)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS \`uq_tags_vault_name\` ON \`tags\` (\`vault_id\`, \`name\`)`);

  db.run(`CREATE TABLE IF NOT EXISTS \`note_tags\` (
    \`note_id\` text NOT NULL,
    \`tag_id\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    PRIMARY KEY(\`note_id\`, \`tag_id\`),
    FOREIGN KEY (\`note_id\`) REFERENCES \`notes\`(\`id\`) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (\`tag_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_note_tags_note\` ON \`note_tags\` (\`note_id\`)`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_note_tags_tag\` ON \`note_tags\` (\`tag_id\`)`);

  db.run(`CREATE TABLE IF NOT EXISTS \`fragments\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`note_id\` text NOT NULL,
    \`vault_id\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    FOREIGN KEY (\`note_id\`) REFERENCES \`notes\`(\`id\`) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (\`vault_id\`) REFERENCES \`vaults\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS \`fragment_tags\` (
    \`fragment_id\` text NOT NULL,
    \`tag_id\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    PRIMARY KEY(\`fragment_id\`, \`tag_id\`),
    FOREIGN KEY (\`fragment_id\`) REFERENCES \`fragments\`(\`id\`) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (\`tag_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS \`fragment_links\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`from_fragment_id\` text NOT NULL,
    \`to_note_id\` text,
    \`to_fragment_id\` text,
    \`vault_id\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    FOREIGN KEY (\`from_fragment_id\`) REFERENCES \`fragments\`(\`id\`) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (\`to_note_id\`) REFERENCES \`notes\`(\`id\`) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (\`vault_id\`) REFERENCES \`vaults\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS \`operation_log\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`vault_id\` text NOT NULL,
    \`entity_type\` text NOT NULL,
    \`entity_id\` text NOT NULL,
    \`operation\` text NOT NULL,
    \`payload_json\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    \`synced_at\` integer
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_oplog_unsynced\` ON \`operation_log\` (\`synced_at\`)`);

  db.run(`CREATE TABLE IF NOT EXISTS \`blocks\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`note_id\` text NOT NULL,
    \`vault_id\` text NOT NULL,
    \`type\` text NOT NULL,
    \`sort\` integer NOT NULL,
    \`level\` integer,
    \`text\` text DEFAULT '' NOT NULL,
    \`ref_block_id\` text,
    \`created_at\` integer NOT NULL,
    \`updated_at\` integer NOT NULL,
    FOREIGN KEY (\`note_id\`) REFERENCES \`notes\`(\`id\`) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (\`vault_id\`) REFERENCES \`vaults\`(\`id\`) ON UPDATE no action ON DELETE no action
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_blocks_note\` ON \`blocks\` (\`note_id\`, \`sort\`)`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_blocks_type\` ON \`blocks\` (\`vault_id\`, \`type\`)`);
  db.run(`CREATE INDEX IF NOT EXISTS \`idx_blocks_ref\`  ON \`blocks\` (\`ref_block_id\`)`);

  createBlocksFts(db);

  // ── Upgrades for databases created before the notepad work ──────────────────
  //
  // `body_markdown` was never actually derived on save, so it held '' for every
  // note this app has ever created. `blocks.text` replaces it as the searchable
  // text surface. Dropping it breaks the additive-only migration rule knowingly
  // — see docs/specs/2026-08-07-notepad-blocks-design.md §4.4.
  addColumnIfMissing(db, 'notes', 'kind', `\`kind\` text DEFAULT 'note' NOT NULL`);
  dropColumnIfPresent(db, 'notes', 'body_markdown');

  console.info('[db] migrations applied');
}
