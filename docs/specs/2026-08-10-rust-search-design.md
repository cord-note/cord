# Rust-native search (M4), and hibernating the file watcher (M5)

**Date:** 2026-08-10
**Status:** designed — not yet implemented
**Author:** Aleksander Sprengel — sole developer

> This is a dated design record, kept as written. It refers throughout to
> `CLAUDE.md`, an internal working document that is not published with this
> repository — the architecture rules it describes are summarised in the
> [README](../../README.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## 1. Summary

`notes:search` stops travelling through the Bun sidecar. The Tauri Rust layer opens
the SQLite database directly and queries an FTS5 index, removing an HTTP round-trip
from a path that runs on every keystroke.

The index uses the **trigram** tokenizer, so results are identical to today's
`LIKE '%q%'` — this is a latency change, not a behaviour change. It is maintained by
SQLite triggers, so no service code has to remember to update it.

M5, the `notify`-based file watcher, is **hibernated**. Cord stores no notes on disk;
there is nothing for a watcher to watch until cloud sync exists. Building it now would
violate the same rule that justifies M4.

## 2. Scope

In scope:

- An FTS5 trigram index over `blocks.text`, with triggers, created by an additive migration.
- `search.rs` in the Tauri crate: query building, escaping, row → DTO mapping.
- `notes_search` rewired from HTTP forwarding to a direct query, with a sidecar fallback.
- The DB path handed from the sidecar to Rust over stdout.
- Rust and Bun test suites covering both sides of the new boundary (M6).
- Documentation updates recording M4 as done and M5 as hibernated.

Out of scope:

- `findUnlinkedMentions`. It also runs `LIKE` over `blocks.text` and would benefit
  from the index, but it belongs to the link/backlink subsystem. That subsystem moves
  as one coherent unit or not at all; splitting it across two languages piecemeal is
  worse than leaving it alone.
- Ranking by relevance. The trigram tokenizer ranks poorly, and today's search has no
  ranking at all, so there is nothing to preserve. See §5 for the ordering that is added.
- Any change to the renderer. `api.notes.search` keeps its name, arguments and return type.

## 3. Decisions and their rationale

| Decision | Chosen | Why |
|---|---|---|
| Index upkeep | SQLite triggers | The sidecar owns every write to `blocks`; Rust only reads. Triggers keep the index correct no matter who writes — including a future sync receiver reprojecting locally, which is the path most likely to forget an explicit call. `BlockIndexService` changes zero lines. |
| Tokenizer | `trigram` | Preserves today's substring semantics exactly. `unicode61` with prefix queries would rank better but would silently stop matching mid-word, turning a performance task into a user-visible regression. |
| Index target | `blocks.text` only | Titles are short and few; a second virtual table would double the trigger surface for no measurable gain. `notes.title` stays on `LIKE`. |
| Vault scoping | Join back to `blocks` | Filtering an `UNINDEXED` column inside a `MATCH` is a full index scan, which defeats the point. |
| DB path | Sidecar prints it | `client.ts` stays the single source of truth for where the database lives. Recomputing the path in Rust would let the default and `CORD_DB_PATH` drift apart. |
| Failure mode | Fall back to the sidecar | If the database cannot be opened, search degrades to slow rather than dying. The forwarding code already exists. |
| M5 | Hibernated | No consumer exists. Deferred to the cloud-sync phase, where a sync receiver writing out-of-band gives it a real one. |

## 4. Data model

### 4.1 `blocks_fts` — a derived index of a derived index

```sql
CREATE VIRTUAL TABLE blocks_fts USING fts5(
  text,
  content='blocks',
  content_rowid='rowid',
  tokenize='trigram'
);
```

External-content, so the text is not duplicated — `blocks` remains the only copy.
`blocks` is a normal rowid table (`id` is a `TEXT PRIMARY KEY`, not `WITHOUT ROWID`),
so `content_rowid='rowid'` is valid.

`blocks` is already a derived index of `notes.body_json`. `blocks_fts` is therefore
twice-derived and holds no authored data at all. It follows the exceptions the notepad
design already established: reprojection writes no `operation_log` entries, and rows
may be hard-deleted, because losing the whole thing costs one rebuild.

### 4.2 Triggers

```sql
CREATE TRIGGER blocks_ai AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER blocks_ad AFTER DELETE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;

CREATE TRIGGER blocks_au AFTER UPDATE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
```

An external-content FTS5 table cannot recover the old text by itself, so a deletion
must be announced with the value being removed. Getting this wrong leaves rows matching
text that no longer exists anywhere — the failure is silent and only visible as phantom
search hits, which is why §7 tests it directly rather than trusting the DDL.

`BlockIndexService.reproject` deletes and re-inserts a note's rows wholesale on every
save. Under these triggers that is a delete-then-insert per block, which is exactly
what the update trigger already does; no special handling is needed.

### 4.3 Migration

Additive. Runs in `migrations.ts` alongside the existing DDL — raw SQL there is what
CLAUDE.md permits.

```sql
INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild');
```

The backfill runs **only when the table is created**, guarded the same way
`addColumnIfMissing` guards its `ALTER`s. Re-running migrations on an existing database
must not re-scan every vault.

## 5. The query

```sql
SELECT id, vault_id, title, kind, is_pinned, created_at, updated_at, deleted_at
FROM notes n
WHERE n.vault_id = ?1
  AND n.deleted_at IS NULL
  AND ( n.title LIKE ?2 ESCAPE '\'
     OR n.id IN (SELECT b.note_id
                 FROM blocks_fts f
                 JOIN blocks b ON b.rowid = f.rowid
                 WHERE f.text MATCH ?3 AND b.vault_id = ?1) )
ORDER BY n.is_pinned DESC, n.updated_at DESC
```

**Short queries.** The trigram tokenizer cannot index fewer than three characters.
Queries below that length skip the FTS branch entirely and use `b.text LIKE ?` instead,
so a one- or two-character search still returns the same rows, just without the index.

**Escaping.** Two separate jobs, both injection surfaces:

- LIKE patterns escape `\`, `%` and `_`, with an explicit `ESCAPE '\'` clause.
- The MATCH string is wrapped in double quotes as a phrase, with any internal `"`
  doubled. Trigram treats a quoted string as a substring search.

**Ordering.** Today's search returns rows in SQLite's scan order, which is arbitrary.
`is_pinned DESC, updated_at DESC` makes it deterministic and matches the instinct
already present in `list()`. This changes the order results appear in, but never which
notes match.

## 6. Rust structure

### 6.1 Files

| File | Contains |
|---|---|
| `src-tauri/src/search.rs` | Connection handling, query building, escaping, row → DTO mapping. All logic. |
| `src-tauri/src/commands/notes.rs` | `notes_search` calls `search::query`. Stays thin, like every other command. |
| `src-tauri/src/state.rs` | `AppState` gains `db: Option<Arc<Mutex<Connection>>>`. |
| `src-tauri/src/lib.rs` | `start_sidecar` parses `SIDECAR_DB=` in addition to `SIDECAR_PORT=`. |

`rusqlite` is added with the `bundled` and `fts5` features. `bundled` compiles SQLite
from source, which guarantees FTS5 is present — the system SQLite on a user's machine
may be built without it. This lengthens the CI Rust job; `Swatinem/rust-cache` is
already configured and absorbs it after the first run.

### 6.2 Handing over the DB path

The sidecar already prints `SIDECAR_PORT=<port>` on stdout, which `start_sidecar` blocks
on. It gains a second line, `SIDECAR_DB=<path>`, printed **after migrations complete**
so Rust can never open a database that has not been migrated. `start_sidecar` collects
both before returning; a missing `SIDECAR_DB` is not fatal, and leaves `db: None`.

### 6.3 Opening the connection

Opened `SQLITE_OPEN_READ_WRITE` **without** `SQLITE_OPEN_CREATE`. Read-write despite
never writing, because WAL mode requires a writable `-shm` file. Without `CREATE`,
a wrong path is an immediate error rather than an empty database that reports no
search results forever.

`rusqlite::Connection` is not `Sync`, so it lives behind a `Mutex`. Queries run inside
`tokio::task::spawn_blocking` — SQLite calls block, and blocking Tauri's async runtime
on a large vault would stall unrelated IPC.

### 6.4 DTO parity

Rust must reproduce `NoteListItem` exactly, in camelCase. The trap is `is_pinned`:
SQLite stores `0`/`1`, Drizzle maps it to a TypeScript `boolean`, and the renderer's
pin control expects a real bool. A serialised `0` would be truthy nowhere and falsy
everywhere in the wrong way. `deleted_at` is `Option<i64>` and must serialise to `null`,
not to a missing key.

## 7. Testing (M6)

The risk this design introduces is drift between two languages reading one database,
so both sides are tested.

**Rust — `search.rs`, in-memory rusqlite:**

- substring match returns the note (the trigram guarantee)
- a query under three characters still matches, via the LIKE fallback
- results are scoped to the requested vault
- soft-deleted notes are excluded
- a query containing `%`, `_` and `"` matches literally and does not error
- `is_pinned` serialises as a JSON boolean, `deleted_at` as `null`

**Bun — against the real migrations, not a hand-written fixture:**

- `reproject` populates `blocks_fts`
- deleting a note leaves no rows behind
- a second `reproject` does not duplicate rows
- re-running migrations on an existing database is a no-op

These are what actually guard the triggers. Rust tests build their own schema and
would not notice if `migrations.ts` changed; the Bun tests would.

**IPC parity — one test, high value:**

Parse the `generate_handler!` list in `lib.rs` and every `invoke('…')` name in
`renderer/ipc/index.ts`, and assert the two sets match. Command-name typos are
currently runtime-only failures that present as a dead button.

**CI:** add `cargo test` beside the existing `cargo check --all-targets`.

Not done: HTTP-level mocking of the forwarding commands. `wiremock` is a lot of
machinery for passthroughs whose only logic — status handling in `http.rs` — is better
covered by unit-testing `error_message` directly.

## 8. Hibernating M5

`CLAUDE.md` justifies the file watcher as "needed for future sync". That is true, and
it is also the reason not to build it now: Cord keeps every note in SQLite as
`body_json`. There is no vault folder, no attachments directory, and no importer. A
watcher built today would watch the database file and emit an event no renderer
consumes.

The rule in CLAUDE.md is that Rust is for measurable wins. A watcher with no consumer
cannot be measured. M5 moves from **approved** to **hibernated — revisit with cloud
sync**, in both the Rust-candidates table and the v1.6 migration-groups table.

## 9. Documentation to update in the same change

`CLAUDE.md` (internal, not published):

- Rust migration candidates table — "File system watching" moves from approved to
  hibernated; full-text search moves to done.
- v1.6 migration groups table — the M5 row.
- Monorepo structure, line 227 — `commands/` is annotated "(search, fs-watch)".
- "How to behave in this codebase", line 313 — "Only search and fs-watch commands
  have logic in Rust."

`README.md` (published — three references, all currently promising a watcher):

- Line 47, architecture principle 5 — "(FTS5 search, fs-watch)".
- Line 56, the layout tree — "approved Rust hot paths (search, fs-watch)".
- Line 110, the IPC-flow note — "Rust-native hot paths (search, fs-watch)".

Also, while in the area: the comment at the `body_markdown` drop in `migrations.ts`
points at `docs/superpowers/specs/…`, but the spec lives at `docs/specs/…`.
