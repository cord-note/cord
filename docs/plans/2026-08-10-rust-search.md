# Rust-native search (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `notes:search` off the HTTP sidecar hop and onto a direct SQLite FTS5 query in the Tauri Rust layer, with results identical to today's `LIKE '%q%'`.

**Architecture:** An external-content FTS5 table (`blocks_fts`) indexes `blocks.text` using the **trigram** tokenizer, kept in sync by SQLite triggers rather than by service code. Rust opens the same database file the Bun sidecar owns — learning its path from a new `SIDECAR_DB=` stdout line — and queries it directly, falling back to the existing sidecar route if the database cannot be opened.

**Tech Stack:** Rust + `rusqlite` (bundled SQLite), Tauri v2, Bun + `bun:sqlite`, Drizzle, `bun test`.

**Spec:** `docs/specs/2026-08-10-rust-search-design.md`

---

## Context you need before starting

**Two different SQLite libraries are in play.** Bun links its own SQLite (3.53.0, FTS5 + trigram confirmed working). `rusqlite` with the `bundled` feature compiles a *separate* copy from source. Whether that copy has FTS5 compiled in is verified explicitly in Task 3 — do not assume it.

**`blocks` is a derived index.** It is rebuilt by wholesale `DELETE` + `INSERT` on every note save (`BlockIndexService.reproject`). `blocks_fts` is derived from *that*, so it is twice-derived, holds no authored data, writes no `operation_log` entries, and may be hard-deleted. This is a documented exception, not a violation — see the spec §4.1.

**Never write to the database from Rust.** The connection exists to read. The sidecar owns every write.

**Run all Bun tests from `apps/desktop`** with `CORD_DB_PATH=:memory: bun test <path>`. Run all Rust commands from `apps/desktop/src-tauri`.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/sidecar/db/client.ts` | Modify | Extract `resolveDbPath()` so one function owns where the DB lives |
| `src/sidecar/db/__tests__/client.test.ts` | Create | Path resolution tests |
| `src/sidecar/index.ts` | Modify | Print `SIDECAR_DB=` on stdout after migrations |
| `src/sidecar/db/migrations.ts` | Modify | Create `blocks_fts` + triggers + guarded backfill |
| `src/sidecar/db/__tests__/blocksFts.test.ts` | Create | Trigger-sync tests against the real migrations |
| `src-tauri/Cargo.toml` | Modify | Add `rusqlite` |
| `src-tauri/src/search.rs` | Create | Escaping, query building, row → DTO. All search logic |
| `src-tauri/src/state.rs` | Modify | `AppState.db` |
| `src-tauri/src/lib.rs` | Modify | Parse `SIDECAR_DB=`, declare `mod search` |
| `src-tauri/src/commands/notes.rs` | Modify | `notes_search` uses Rust path, falls back to sidecar |
| `src/renderer/ipc/__tests__/parity.test.ts` | Create | Every `invoke()` name is a registered Tauri command |
| `.github/workflows/ci.yml` | Modify | `cargo test` |
| `CLAUDE.md`, `README.md` | Modify | M4 done, M5 hibernated |

---

## Task 1: Extract the DB path and publish it to Rust

**Files:**
- Modify: `apps/desktop/src/sidecar/db/client.ts:12-18`
- Modify: `apps/desktop/src/sidecar/index.ts:66`
- Test: `apps/desktop/src/sidecar/db/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/sidecar/db/__tests__/client.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'path';
import { resolveDbPath } from '../client';

// resolveDbPath is the single source of truth for where cord.db lives. Rust
// reads the path from the sidecar rather than recomputing it, so if this
// function and the Rust side ever disagree, search silently reads a different
// database than the one being written.

const ORIGINAL = process.env['CORD_DB_PATH'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['CORD_DB_PATH'];
  else process.env['CORD_DB_PATH'] = ORIGINAL;
});

describe('resolveDbPath', () => {
  it('honours CORD_DB_PATH when set', () => {
    process.env['CORD_DB_PATH'] = '/tmp/cord-test.db';
    expect(resolveDbPath()).toBe('/tmp/cord-test.db');
  });

  it('passes :memory: through unchanged', () => {
    process.env['CORD_DB_PATH'] = ':memory:';
    expect(resolveDbPath()).toBe(':memory:');
  });

  it('defaults to .cord/cord.db under the home directory', () => {
    delete process.env['CORD_DB_PATH'];
    expect(resolveDbPath().endsWith(join('.cord', 'cord.db'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd apps/desktop && CORD_DB_PATH=:memory: bun test src/sidecar/db/__tests__/client.test.ts
```

Expected: FAIL — `resolveDbPath` is not exported from `../client`.

- [ ] **Step 3: Extract the function**

In `apps/desktop/src/sidecar/db/client.ts`, add above `getDb()`:

```ts
/**
 * Where the database lives. The single source of truth for the path.
 *
 * The Tauri layer opens this same file directly for search, and learns the
 * path from the `SIDECAR_DB=` line this process prints rather than
 * recomputing it — so this function must stay the only place the default is
 * expressed.
 */
export function resolveDbPath(): string {
  return process.env['CORD_DB_PATH'] ?? join(
    process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.',
    '.cord',
    'cord.db',
  );
}
```

Then replace the inline computation inside `getDb()` so it reads:

```ts
  const dbPath = resolveDbPath();
```

- [ ] **Step 4: Run the test again**

```bash
cd apps/desktop && CORD_DB_PATH=:memory: bun test src/sidecar/db/__tests__/client.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Print the path on stdout**

In `apps/desktop/src/sidecar/index.ts`, add to the imports at the top:

```ts
import { resolveDbPath } from './db/client';
```

Then replace the single `SIDECAR_PORT` write near the bottom with both lines. `SIDECAR_DB` is printed **first** so that Rust — which stops reading once it has the port — has already seen it:

```ts
// Tauri reads these two lines from stdout. SIDECAR_DB comes first because the
// reader stops at SIDECAR_PORT; migrations have already run by this point, so
// the file Rust opens is guaranteed to have its schema.
process.stdout.write(`SIDECAR_DB=${resolveDbPath()}\n`);
process.stdout.write(`SIDECAR_PORT=${server.port}\n`);
```

- [ ] **Step 6: Verify the whole suite still passes**

```bash
cd apps/desktop && CORD_DB_PATH=:memory: bun test src
```

Expected: 202 pass, 0 fail (199 existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/sidecar/db/client.ts apps/desktop/src/sidecar/db/__tests__/client.test.ts apps/desktop/src/sidecar/index.ts
git commit -m "Publish the database path to the Tauri layer

Rust opens the same SQLite file for search. Handing it the path over
stdout keeps client.ts the only place that knows where cord.db lives,
so the default and CORD_DB_PATH cannot drift apart."
```

---

## Task 2: The FTS5 index and its triggers

**Files:**
- Modify: `apps/desktop/src/sidecar/db/migrations.ts`
- Test: `apps/desktop/src/sidecar/db/__tests__/blocksFts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/sidecar/db/__tests__/blocksFts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { freshDb, seedUser, seedVault } from '../../services/__tests__/helpers';
import { getRawSqlite } from '../client';
import { runMigrations } from '../migrations';
import { NoteService } from '../../services/NoteService';
import { BlockIndexService } from '../../services/BlockIndexService';

// blocks_fts is maintained by SQLite triggers, not by service code, so nothing
// in TypeScript references it. These tests are the only thing standing between
// a broken trigger and phantom search results — an external-content FTS table
// that misses a delete keeps matching text that no longer exists anywhere.

const USER_ID = 'fts-user';
const VAULT_ID = 'vault-fts-01';

const notepad = (...texts: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: texts.map((text, i) => ({
      type: 'notepadBlock',
      attrs: { blockId: `fts-b${i + 1}` },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  });

/** Rows in the FTS index whose text contains `needle` as a substring. */
function ftsMatches(needle: string): number {
  const row = getRawSqlite()
    .query(`SELECT count(*) AS c FROM blocks_fts WHERE text MATCH ?`)
    .get(`"${needle}"`) as { c: number };
  return row.c;
}

function ftsTotal(): number {
  const row = getRawSqlite()
    .query(`SELECT count(*) AS c FROM blocks_fts`)
    .get() as { c: number };
  return row.c;
}

describe('blocks_fts', () => {
  let notes: NoteService;
  let index: BlockIndexService;

  beforeEach(() => {
    freshDb();
    seedUser(USER_ID);
    seedVault(VAULT_ID, USER_ID);
    index = new BlockIndexService();
    notes = new NoteService(index);
  });

  it('indexes block text when a note is created', () => {
    notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('hello harbour') });
    expect(ftsMatches('harbour')).toBe(1);
  });

  it('matches mid-word, exactly as LIKE did', () => {
    notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('barfoosh') });
    expect(ftsMatches('foo')).toBe(1);
  });

  it('drops stale rows when a note is reprojected with new text', () => {
    const note = notes.create({
      vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('original text'),
    });
    notes.update(note.id, { bodyJson: notepad('replacement text') });

    expect(ftsMatches('original')).toBe(0);
    expect(ftsMatches('replacement')).toBe(1);
  });

  it('does not duplicate rows when a note is reprojected unchanged', () => {
    const note = notes.create({
      vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('stable text'),
    });
    const before = ftsTotal();

    index.reproject(note.id);
    index.reproject(note.id);

    expect(ftsTotal()).toBe(before);
    expect(ftsMatches('stable')).toBe(1);
  });

  it('leaves nothing behind when a note is purged', () => {
    const note = notes.create({
      vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('doomed text'),
    });
    notes.delete(note.id);
    notes.permanentDelete(note.id);

    expect(ftsMatches('doomed')).toBe(0);
    expect(ftsTotal()).toBe(0);
  });

  it('is idempotent — re-running migrations does not error or rebuild', () => {
    notes.create({ vaultId: VAULT_ID, kind: 'notepad', bodyJson: notepad('persistent text') });
    const before = ftsTotal();

    runMigrations();

    expect(ftsTotal()).toBe(before);
    expect(ftsMatches('persistent')).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd apps/desktop && CORD_DB_PATH=:memory: bun test src/sidecar/db/__tests__/blocksFts.test.ts
```

Expected: FAIL — `no such table: blocks_fts`.

- [ ] **Step 3: Add the table, triggers and guarded backfill**

In `apps/desktop/src/sidecar/db/migrations.ts`, add this helper beside `columnsOf`:

```ts
/** True if a table — including a virtual table — already exists. */
function tableExists(db: Db, table: string): boolean {
  const row = db
    .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== null;
}
```

Then add this function below `dropColumnIfPresent`:

```ts
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
```

Finally, call it inside `runMigrations()`, immediately after the three `idx_blocks_*` index statements and before the "Upgrades for databases created before the notepad work" comment block:

```ts
  createBlocksFts(db);
```

- [ ] **Step 4: Run the test again**

```bash
cd apps/desktop && CORD_DB_PATH=:memory: bun test src/sidecar/db/__tests__/blocksFts.test.ts
```

Expected: PASS, 6 tests.

If `it leaves nothing behind when a note is purged` fails, the `AFTER DELETE` trigger is the suspect — check that the `'delete'` command form is used and that `old.text` is passed, not `new.text`.

- [ ] **Step 5: Confirm nothing else regressed**

```bash
cd apps/desktop && CORD_DB_PATH=:memory: bun test src
```

Expected: 208 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/sidecar/db/migrations.ts apps/desktop/src/sidecar/db/__tests__/blocksFts.test.ts
git commit -m "Index block text with an FTS5 trigram table

Trigram gives substring matching identical to the LIKE it will replace,
so moving search into Rust changes latency and not results.

Triggers own the index rather than BlockIndexService: the sidecar writes
every blocks row, and a sync receiver reprojecting locally is the caller
most likely to forget an explicit call."
```

---

## Task 3: Verify Rust's bundled SQLite has FTS5

Do this before writing search code — everything downstream depends on it, and the remedy differs depending on the answer.

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Test: `apps/desktop/src-tauri/src/search.rs` (created here, minimally)

- [ ] **Step 1: Add rusqlite**

In `apps/desktop/src-tauri/Cargo.toml`, under `[dependencies]`:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

`bundled` compiles SQLite from source rather than linking the system copy, so every platform gets the same build with the same features — a user's system SQLite may have been compiled without FTS5.

- [ ] **Step 2: Write the probe test**

Create `apps/desktop/src-tauri/src/search.rs`:

```rust
//! Rust-native full-text search over the `blocks` index.
//!
//! This is one of only two places the Rust layer is allowed to hold logic (see
//! CLAUDE.md). It reads the same SQLite file the Bun sidecar writes, and never
//! writes to it.

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    /// Rust bundles its own SQLite, separate from Bun's. Confirming FTS5 and the
    /// trigram tokenizer exist here proves nothing about the sidecar and vice
    /// versa, so both sides are checked independently.
    #[test]
    fn bundled_sqlite_supports_fts5_trigram() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE probe USING fts5(x, tokenize='trigram');
             INSERT INTO probe(x) VALUES('barfoosh');",
        )
        .expect("FTS5 with trigram tokenizer must be available");

        let hits: i64 = conn
            .query_row("SELECT count(*) FROM probe WHERE x MATCH ?1", ["\"foo\""], |r| r.get(0))
            .unwrap();

        assert_eq!(hits, 1, "trigram must match mid-word, as LIKE '%foo%' does");
    }
}
```

- [ ] **Step 3: Declare the module**

In `apps/desktop/src-tauri/src/lib.rs`, add beside the existing `mod` lines at the top:

```rust
mod search;
```

- [ ] **Step 4: Run it**

```bash
cd apps/desktop/src-tauri && cargo test search:: -- --nocapture
```

Expected: PASS. The first run compiles SQLite from source and takes several minutes.

**If it fails with "no such module: fts5"**, the bundled build lacks FTS5. Remedy: switch the dependency to

```toml
rusqlite = { version = "0.32", features = ["bundled-full"] }
```

and re-run. Do not proceed until this test passes — every later task assumes it.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/src/search.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add rusqlite and prove its SQLite has FTS5 trigram

Rust bundles its own SQLite, so Bun's support for the trigram tokenizer
says nothing about this side. Both are now checked independently."
```

---

## Task 4: Escaping

Two escaping jobs, both injection surfaces. Pure functions, so they are tested in isolation before any SQL runs.

**Files:**
- Modify: `apps/desktop/src-tauri/src/search.rs`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src-tauri/src/search.rs`, add inside `mod tests`:

```rust
    use super::*;

    #[test]
    fn like_pattern_wraps_and_escapes() {
        assert_eq!(like_pattern("plain"), "%plain%");
        // % and _ are LIKE wildcards; a user searching for them means them literally.
        assert_eq!(like_pattern("100%"), "%100\\%%");
        assert_eq!(like_pattern("a_b"), "%a\\_b%");
        // The escape character itself has to be escaped.
        assert_eq!(like_pattern("back\\slash"), "%back\\\\slash%");
    }

    #[test]
    fn fts_phrase_quotes_and_doubles_inner_quotes() {
        assert_eq!(fts_phrase("plain"), "\"plain\"");
        // Without doubling, this would terminate the phrase and the remainder
        // would parse as FTS5 query syntax.
        assert_eq!(fts_phrase("say \"hi\""), "\"say \"\"hi\"\"\"");
    }

    #[test]
    fn uses_fts_only_at_three_characters_or_more() {
        assert!(!uses_fts("ab"));
        assert!(uses_fts("abc"));
        // Counted in characters, not bytes — a two-emoji query is not 8 chars.
        assert!(!uses_fts("🙂🙂"));
    }
```

- [ ] **Step 2: Run and confirm it fails**

```bash
cd apps/desktop/src-tauri && cargo test search::
```

Expected: FAIL — `cannot find function like_pattern in this scope`.

- [ ] **Step 3: Implement**

In `apps/desktop/src-tauri/src/search.rs`, above `mod tests`:

```rust
/// The trigram tokenizer cannot index fewer than three characters.
const TRIGRAM_MIN_CHARS: usize = 3;

/// Whether a query is long enough for the FTS index to serve it.
///
/// Shorter queries fall back to a plain LIKE scan so that a one- or
/// two-character search still returns the same rows, just without the index.
fn uses_fts(query: &str) -> bool {
    query.chars().count() >= TRIGRAM_MIN_CHARS
}

/// Build a substring LIKE pattern, escaping the wildcards a user may have typed.
///
/// Pairs with an explicit `ESCAPE '\'` clause in the SQL.
fn like_pattern(query: &str) -> String {
    let mut out = String::with_capacity(query.len() + 2);
    out.push('%');
    for ch in query.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('%');
    out
}

/// Wrap a query as an FTS5 phrase.
///
/// A bare user string is parsed as FTS5 query syntax, where characters like
/// `*`, `:`, `(` and `-` are operators. Quoting makes the whole thing a literal
/// phrase — which the trigram tokenizer treats as a substring search — and
/// internal quotes are doubled so they cannot close it early.
fn fts_phrase(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}
```

- [ ] **Step 4: Run and confirm it passes**

```bash
cd apps/desktop/src-tauri && cargo test search::
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/search.rs
git commit -m "Escape search input for both LIKE and FTS5 MATCH

A bare user string is FTS5 query syntax, where * : ( and - are
operators, and an unescaped % or _ is a LIKE wildcard. Both are
injection surfaces, so both are pure functions with their own tests."
```

---

## Task 5: The query

**Files:**
- Modify: `apps/desktop/src-tauri/src/search.rs`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src-tauri/src/search.rs`, add inside `mod tests`:

```rust
    /// Mirrors the columns Task 2's migration creates. Rust builds its own
    /// schema here rather than running migrations.ts, so this DDL can drift —
    /// the Bun tests in src/sidecar/db/__tests__/blocksFts.test.ts are what
    /// guard the real triggers.
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (
               id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL,
               title TEXT NOT NULL, kind TEXT NOT NULL,
               is_pinned INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
               deleted_at INTEGER
             );
             CREATE TABLE blocks (
               id TEXT PRIMARY KEY NOT NULL, note_id TEXT NOT NULL,
               vault_id TEXT NOT NULL, type TEXT NOT NULL, sort INTEGER NOT NULL,
               level INTEGER, text TEXT NOT NULL DEFAULT '', ref_block_id TEXT,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE VIRTUAL TABLE blocks_fts USING fts5(
               text, content='blocks', content_rowid='rowid', tokenize='trigram'
             );
             CREATE TRIGGER blocks_fts_ai AFTER INSERT ON blocks BEGIN
               INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
             END;",
        )
        .unwrap();
        conn
    }

    fn add_note(conn: &Connection, id: &str, vault: &str, title: &str, body: &str) {
        conn.execute(
            "INSERT INTO notes (id, vault_id, title, kind, is_pinned, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'note', 0, 1, 1)",
            (id, vault, title),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO blocks (id, note_id, vault_id, type, sort, text, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'paragraph', 0, ?4, 1, 1)",
            (format!("{id}-b1"), id, vault, body),
        )
        .unwrap();
    }

    #[test]
    fn finds_notes_by_body_substring() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "the barfoosh incident");

        let hits = query(&conn, "v1", "foo").unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "n1");
    }

    #[test]
    fn finds_notes_by_title() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Harbour Notes", "unrelated body");

        let hits = query(&conn, "v1", "arbour").unwrap();

        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn short_queries_still_match_via_the_like_fallback() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "on the quay");

        let hits = query(&conn, "v1", "qu").unwrap();

        assert_eq!(hits.len(), 1, "two-character queries bypass FTS but must still match");
    }

    #[test]
    fn scopes_results_to_the_requested_vault() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "shared word");
        add_note(&conn, "n2", "v2", "Untitled", "shared word");

        let hits = query(&conn, "v1", "shared").unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "n1");
    }

    #[test]
    fn excludes_soft_deleted_notes() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "deleted content");
        conn.execute("UPDATE notes SET deleted_at = 99 WHERE id = 'n1'", ()).unwrap();

        assert!(query(&conn, "v1", "deleted").unwrap().is_empty());
    }

    #[test]
    fn treats_wildcards_and_quotes_literally() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "a 100% increase");
        add_note(&conn, "n2", "v1", "Untitled", "nothing relevant");

        // Were % unescaped, this would match both rows.
        let hits = query(&conn, "v1", "100%").unwrap();
        assert_eq!(hits.len(), 1);

        // Must not error out as malformed FTS5 syntax.
        assert!(query(&conn, "v1", "say \"hi\"").is_ok());
        assert!(query(&conn, "v1", "a OR b*").is_ok());
    }

    #[test]
    fn orders_pinned_first_then_most_recent() {
        let conn = fixture();
        add_note(&conn, "old", "v1", "Untitled", "ordering probe");
        add_note(&conn, "new", "v1", "Untitled", "ordering probe");
        add_note(&conn, "pin", "v1", "Untitled", "ordering probe");
        conn.execute("UPDATE notes SET updated_at = 50 WHERE id = 'new'", ()).unwrap();
        conn.execute("UPDATE notes SET is_pinned = 1 WHERE id = 'pin'", ()).unwrap();

        let ids: Vec<String> = query(&conn, "v1", "ordering").unwrap()
            .into_iter().map(|n| n.id).collect();

        assert_eq!(ids, vec!["pin", "new", "old"]);
    }

    #[test]
    fn is_pinned_serialises_as_a_json_boolean() {
        let conn = fixture();
        add_note(&conn, "n1", "v1", "Untitled", "pin check");
        conn.execute("UPDATE notes SET is_pinned = 1 WHERE id = 'n1'", ()).unwrap();

        let json = serde_json::to_value(query(&conn, "v1", "pin").unwrap()).unwrap();

        // SQLite stores 0/1; the renderer's pin control expects a real boolean.
        assert_eq!(json[0]["isPinned"], serde_json::Value::Bool(true));
        assert_eq!(json[0]["deletedAt"], serde_json::Value::Null);
        assert_eq!(json[0]["vaultId"], "v1");
    }
```

- [ ] **Step 2: Run and confirm it fails**

```bash
cd apps/desktop/src-tauri && cargo test search::
```

Expected: FAIL — `cannot find function query in this scope`.

- [ ] **Step 3: Implement**

In `apps/desktop/src-tauri/src/search.rs`, add at the top of the file below the module doc comment:

```rust
use rusqlite::Connection;
use serde::Serialize;
```

and above `mod tests`:

```rust
/// Mirrors the `NoteListItem` DTO in src/shared/types/index.ts.
///
/// Field names must survive the rename to camelCase exactly — the renderer
/// consumes this from the same `api.notes.search` call it always has, and a
/// mismatch here is invisible until the UI renders undefined.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItem {
    pub id: String,
    pub vault_id: String,
    pub title: String,
    pub kind: String,
    pub is_pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

const SELECT: &str = "SELECT n.id, n.vault_id, n.title, n.kind, n.is_pinned,
                             n.created_at, n.updated_at, n.deleted_at
                      FROM notes n
                      WHERE n.vault_id = ?1 AND n.deleted_at IS NULL AND (";

const ORDER: &str = ") ORDER BY n.is_pinned DESC, n.updated_at DESC";

/// Title and body search, scoped to one vault.
///
/// Body matching goes through the FTS index; vault scoping is applied on
/// `blocks` rather than inside the MATCH, because filtering an UNINDEXED
/// column within the FTS query is a full index scan and defeats the point.
pub fn query(conn: &Connection, vault_id: &str, q: &str) -> rusqlite::Result<Vec<NoteListItem>> {
    let like = like_pattern(q);

    let sql = if uses_fts(q) {
        format!(
            "{} n.title LIKE ?2 ESCAPE '\\'
                 OR n.id IN (SELECT b.note_id FROM blocks_fts f
                             JOIN blocks b ON b.rowid = f.rowid
                             WHERE f.text MATCH ?3 AND b.vault_id = ?1) {}",
            SELECT, ORDER
        )
    } else {
        format!(
            "{} n.title LIKE ?2 ESCAPE '\\'
                 OR n.id IN (SELECT b.note_id FROM blocks b
                             WHERE b.vault_id = ?1 AND b.text LIKE ?2 ESCAPE '\\') {}",
            SELECT, ORDER
        )
    };

    let mut stmt = conn.prepare(&sql)?;

    let map = |row: &rusqlite::Row<'_>| -> rusqlite::Result<NoteListItem> {
        Ok(NoteListItem {
            id:         row.get(0)?,
            vault_id:   row.get(1)?,
            title:      row.get(2)?,
            kind:       row.get(3)?,
            is_pinned:  row.get::<_, i64>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            deleted_at: row.get(7)?,
        })
    };

    let rows = if uses_fts(q) {
        stmt.query_map((vault_id, &like, fts_phrase(q)), map)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        stmt.query_map((vault_id, &like), map)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    Ok(rows)
}
```

- [ ] **Step 4: Run and confirm it passes**

```bash
cd apps/desktop/src-tauri && cargo test search::
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/search.rs
git commit -m "Query notes through the FTS index from Rust

Vault scoping joins back to blocks rather than filtering an UNINDEXED
column inside the MATCH, which would be a full index scan.

is_pinned is mapped to a real bool: SQLite stores 0/1 and the renderer's
pin control expects a boolean, so passing the integer through would be
invisible until the UI rendered it."
```

---

## Task 6: Open the database and wire up the command

**Files:**
- Modify: `apps/desktop/src-tauri/src/state.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs:26-33,109-137`
- Modify: `apps/desktop/src-tauri/src/commands/notes.rs:53-62`

- [ ] **Step 1: Give AppState a connection**

Replace the contents of `apps/desktop/src-tauri/src/state.rs`:

```rust
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OpenFlags};

pub struct AppState {
    pub sidecar_url: String,
    pub http: Arc<reqwest::Client>,
    /// Read-only in practice — the sidecar owns every write. `None` when the
    /// database could not be opened, in which case search falls back to the
    /// sidecar route rather than failing.
    pub db: Option<Arc<Mutex<Connection>>>,
}

impl AppState {
    pub fn new(port: u16, db_path: Option<&str>) -> Self {
        Self {
            sidecar_url: format!("http://127.0.0.1:{port}"),
            http: Arc::new(reqwest::Client::new()),
            db: db_path.and_then(open_db),
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.sidecar_url)
    }
}

/// Open the database the sidecar just migrated.
///
/// READ_WRITE despite never writing: WAL mode needs a writable `-shm`. Without
/// CREATE, a wrong path is an immediate error rather than an empty database
/// that would report no search results forever.
fn open_db(path: &str) -> Option<Arc<Mutex<Connection>>> {
    if path == ":memory:" {
        return None; // test configuration — nothing on disk to share
    }
    match Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE) {
        Ok(conn) => Some(Arc::new(Mutex::new(conn))),
        Err(err) => {
            eprintln!("[search] could not open {path}: {err} — falling back to sidecar");
            None
        }
    }
}
```

- [ ] **Step 2: Parse the new stdout line**

In `apps/desktop/src-tauri/src/lib.rs`, change `start_sidecar`'s signature and loop:

```rust
/// Spawn the Bun sidecar and read the port — and the database path — it prints.
///
/// Returns the child handle alongside both; the caller must keep it alive for
/// the lifetime of the app and kill it on exit (see `SidecarProcess`).
fn start_sidecar(
    app: &tauri::App,
) -> Result<(u16, Option<String>, CommandChild), Box<dyn std::error::Error>> {
    let sidecar_cmd = app.shell().sidecar("cord-sidecar")?;
    let (mut rx, child) = sidecar_cmd.spawn()?;

    // SIDECAR_DB is printed first, so it has always arrived by the time the
    // port ends this loop.
    let mut db_path: Option<String> = None;

    while let Some(event) = rx.blocking_recv() {
        if let tauri_plugin_shell::process::CommandEvent::Stdout(bytes) = event {
            let line = String::from_utf8_lossy(&bytes);
            let line = line.trim();

            if let Some(path) = line.strip_prefix("SIDECAR_DB=") {
                db_path = Some(path.trim().to_owned());
            }

            if let Some(port_str) = line.strip_prefix("SIDECAR_PORT=") {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    return Ok((port, db_path, child));
                }
            }
        }
    }

    // Never emitted a port — kill it rather than leaving it orphaned.
    let _ = child.kill();
    Err("sidecar did not emit SIDECAR_PORT line on stdout".into())
}
```

And update the `setup` closure to match:

```rust
        .setup(|app| {
            let (port, db_path, child) = start_sidecar(app)?;
            app.manage(AppState::new(port, db_path.as_deref()));
            app.manage(SidecarProcess(Mutex::new(Some(child))));
            Ok(())
        })
```

- [ ] **Step 3: Rewire the command**

In `apps/desktop/src-tauri/src/commands/notes.rs`, add to the imports at the top:

```rust
use crate::search;
```

and replace `notes_search`:

```rust
/// Search notes. The one command that does not forward to the sidecar.
///
/// Runs against SQLite directly because this fires on every keystroke and the
/// HTTP round-trip dominated the query. If the database could not be opened at
/// startup, it forwards as before — search degrades to slow, not broken.
#[tauri::command]
pub async fn notes_search(
    state: State<'_, AppState>,
    vault_id: String,
    query: String,
) -> Result<Value, String> {
    if let Some(db) = state.db.clone() {
        let vault = vault_id.clone();
        let q = query.clone();

        // SQLite calls block; running them on the async runtime would stall
        // unrelated IPC on a large vault.
        let result = tokio::task::spawn_blocking(move || {
            let conn = db.lock().map_err(|e| e.to_string())?;
            search::query(&conn, &vault, &q).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;

        match result {
            Ok(items) => return serde_json::to_value(items).map_err(|e| e.to_string()),
            Err(err) => eprintln!("[search] direct query failed, forwarding: {err}"),
        }
    }

    let q = urlencoding::encode(&query);
    fwd_get(&state, &format!("/notes/search?vaultId={vault_id}&q={q}")).await
}
```

- [ ] **Step 4: Build and test**

```bash
cd apps/desktop/src-tauri && cargo test && cargo check --all-targets
```

Expected: 12 tests PASS, `cargo check` clean.

- [ ] **Step 5: Verify in the running app**

```bash
cd apps/desktop && bun run build:renderer && bun run tauri dev
```

Open a vault, type into the search box, and confirm results appear. Then check the console for `[search] direct query failed` — its absence means the Rust path is live. To prove the fallback works, temporarily rename `~/.cord/cord.db` before launch and confirm search still returns results via the sidecar.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/state.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/commands/notes.rs
git commit -m "Route notes_search through SQLite instead of the sidecar

The command opens the database the sidecar reports and queries it on a
blocking thread. If the file cannot be opened it forwards as before, so
a bad path degrades search to slow rather than breaking it."
```

---

## Task 7: IPC parity test

Command-name typos are currently runtime-only failures that present as a dead button. This is the cheap version of "smoke-test all IPC paths" from M6.

**Files:**
- Test: `apps/desktop/src/renderer/ipc/__tests__/parity.test.ts`

- [ ] **Step 1: Write the test**

Create `apps/desktop/src/renderer/ipc/__tests__/parity.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// Nothing type-checks the string in invoke('notes_search') against the Rust
// command that receives it. A typo compiles, ships, and shows up as a button
// that silently does nothing. This test is the missing link.

const DESKTOP = join(import.meta.dir, '..', '..', '..', '..');

const libRs = readFileSync(join(DESKTOP, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const ipcTs = readFileSync(join(DESKTOP, 'src', 'renderer', 'ipc', 'index.ts'), 'utf8');

function registeredCommands(): Set<string> {
  const block = libRs.split('generate_handler![')[1]?.split('])')[0];
  if (!block) throw new Error('could not find generate_handler! block in lib.rs');
  return new Set([...block.matchAll(/commands::\w+::(\w+)/g)].map((m) => m[1]!));
}

function invokedCommands(): Set<string> {
  return new Set([...ipcTs.matchAll(/invoke(?:<[^(]*?>)?\(\s*'([^']+)'/g)].map((m) => m[1]!));
}

describe('IPC parity', () => {
  it('finds commands on both sides', () => {
    expect(registeredCommands().size).toBeGreaterThan(20);
    expect(invokedCommands().size).toBeGreaterThan(20);
  });

  it('every invoked command is registered in lib.rs', () => {
    const registered = registeredCommands();
    const missing = [...invokedCommands()].filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
  });

  it('every registered command is reachable from the renderer', () => {
    const invoked = invokedCommands();
    const unused = [...registeredCommands()].filter((name) => !invoked.has(name));
    expect(unused).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd apps/desktop && CORD_DB_PATH=:memory: bun test src/renderer/ipc/__tests__/parity.test.ts
```

Expected: PASS, 3 tests.

If the third test fails with a list of names, those commands are registered but unreachable — that is a real finding. Either wire them into `ipc/index.ts` or remove them; do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/ipc/__tests__/parity.test.ts
git commit -m "Assert every invoke() name matches a registered Tauri command

Nothing type-checks a command name across the IPC boundary, so a typo
ships as a button that silently does nothing."
```

---

## Task 8: Run Rust tests in CI

**Files:**
- Modify: `.github/workflows/ci.yml:60-62`

- [ ] **Step 1: Replace the final step**

In `.github/workflows/ci.yml`, replace the `Check Rust shell` step with:

```yaml
      # `cargo test` covers search.rs; `--all-targets` on the check keeps the
      # command modules compiling even though they have no tests of their own.
      - name: Check Rust shell
        working-directory: apps/desktop/src-tauri
        run: cargo check --all-targets

      - name: Test Rust shell
        working-directory: apps/desktop/src-tauri
        run: cargo test
```

- [ ] **Step 2: Verify the file parses**

```bash
cd /c/Users/Olek/Downloads/evrything-cord/cord && bun -e "console.log(require('fs').readFileSync('.github/workflows/ci.yml','utf8').includes('cargo test') ? 'ok' : 'missing')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Run cargo test in CI

search.rs is the first Rust code in this repo with logic in it, so the
Rust job needs to do more than compile."
```

---

## Task 9: Documentation — M4 done, M5 hibernated

**Files:**
- Modify: `../.claude/CLAUDE.md` (four places)
- Modify: `README.md` (three places)
- Modify: `apps/desktop/src/sidecar/db/migrations.ts` (dangling spec path)

- [ ] **Step 1: CLAUDE.md — Rust migration candidates table**

Change the two affected rows to:

```markdown
| Full-text search (FTS5) | Eliminates HTTP round-trip on every keystroke; search-as-you-type must be <50ms | **Done in v1.6** — `search.rs`, trigram tokenizer |
| File system watching | `notify` crate is OS-native | **Hibernated** — nothing on disk to watch until cloud sync exists |
```

- [ ] **Step 2: CLAUDE.md — migration groups table**

```markdown
| M5 — Rust fs-watch | **Hibernated.** Cord stores no notes as files, so a watcher would emit events no renderer consumes. Revisit with cloud sync, where a sync receiver writing out-of-band gives it a consumer. |
```

- [ ] **Step 3: CLAUDE.md — the two prose references**

Line ~227, in the monorepo structure, change `— thin IPC commands + Rust-native commands (search, fs-watch)` to:

```
          commands/         — thin IPC commands + Rust-native search
```

Line ~313, under "How to behave in this codebase", change to:

```markdown
- Tauri Rust commands are thin by default. Only `notes_search` has logic in Rust.
```

- [ ] **Step 4: README.md — three references**

Line 47, principle 5 — replace `(FTS5 search, fs-watch)` with `(currently just FTS5 search)`.

Line 56, the layout tree:

```
      src-tauri/          Rust shell + FTS5 search
```

Line 110:

```markdown
Rust-native search skips the sidecar hop and queries SQLite FTS5 directly.
```

- [ ] **Step 5: Fix the dangling spec path**

In `apps/desktop/src/sidecar/db/migrations.ts`, the comment above the `body_markdown` drop points at `docs/superpowers/specs/2026-08-07-notepad-blocks-design.md`. The file is at `docs/specs/2026-08-07-notepad-blocks-design.md`. Correct it.

- [ ] **Step 6: Confirm no stale references remain**

```bash
cd /c/Users/Olek/Downloads/evrything-cord/cord && grep -rn "fs-watch\|superpowers/specs" README.md apps/desktop/src ../.claude/CLAUDE.md
```

Expected: only the hibernation notes in CLAUDE.md. No hits in README.md or `apps/desktop/src`.

- [ ] **Step 7: Commit**

```bash
git add README.md apps/desktop/src/sidecar/db/migrations.ts ../.claude/CLAUDE.md
git commit -m "Record M4 as done and M5 as hibernated

The README promised a file watcher in three places. Cord stores no notes
on disk, so there is nothing for one to watch until cloud sync exists,
and a watcher with no consumer cannot be measured — which is the rule
that admitted search to Rust in the first place."
```

Note: `.claude/CLAUDE.md` sits outside the repo root at `C:\Users\Olek\Downloads\evrything-cord\.claude\`. Confirm whether it is tracked before staging it; if not, edit it in place and stage only the two repo files.

---

## Final verification

- [ ] **Full Bun suite**

```bash
cd apps/desktop && CORD_DB_PATH=:memory: bun test src
```

Expected: 211 pass, 0 fail (199 existing + 3 path + 6 FTS + 3 parity).

- [ ] **Full Rust suite**

```bash
cd apps/desktop/src-tauri && cargo test && cargo check --all-targets
```

Expected: 12 pass, 0 fail; check clean.

- [ ] **Typecheck and renderer build**

```bash
cd apps/desktop && bun run typecheck && bun run build:renderer
```

- [ ] **Manual smoke test**

Launch with `bun run tauri dev`. Search for a term you know appears mid-word in a note body — it must still match, since that is the whole point of the trigram choice. Confirm pinned notes sort first.

- [ ] **Open the PR**

```bash
git push -u origin feat/m4-rust-search
gh pr create --title "M4: Rust-native FTS5 search" --body "Implements docs/specs/2026-08-10-rust-search-design.md. Hibernates M5."
```
