import { getRawSqlite } from './client';

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
    \`body_markdown\` text DEFAULT '' NOT NULL,
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

  console.info('[db] migrations applied');
}
