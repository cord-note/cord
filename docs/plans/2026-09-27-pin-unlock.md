# PIN Unlock and Per-User Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock Cord with a 4–6 digit PIN for a remembered user, with a user switcher, recovery keys, an optional idle lock, and settings (theme included) that belong to each user.

**Architecture:** The sidecar's `AuthService` gains PIN, recovery-key and lock-screen methods backed by three new `users` columns and an `app_state` table. `SettingsFileService` resolves files under `~/.cord/users/<userId>/` for the signed-in user. The renderer's auth store drives a lock screen of small views, and a new `settings/session.ts` swaps each user's settings, keybindings and boot cache in and out.

**Tech Stack:** Bun sidecar (bun:sqlite + Drizzle, `Bun.password` bcrypt), Tauri 2 thin commands (Rust), React + Zustand renderer, `bun test`.

**Spec:** `docs/specs/2026-09-27-pin-unlock-design.md`

---

## Ground rules

- Work in the worktree `C:\Users\Olek\Downloads\evrything-cord\cord-pin-unlock` on branch `feature/pin-unlock`. Never touch `../cord` (main checkout) or `../cord-colour-leaks` (the settings branch).
- Run tests from `apps/desktop`: `CORD_DB_PATH=:memory: bun test <path>`. The whole suite is `CORD_DB_PATH=:memory: bun test src` (209 passing at the start).
- Commit messages: imperative sentence, no prefix, **no Co-Authored-By trailer** (repo rule).
- No `console.log` in production code. No `any`.
- Between Task 6 and Task 9 the renderer does not type-check (the old auth store calls removed IPC methods). Run tests, not `tsc`, until Task 9.

## File map

| File | Change |
|---|---|
| `apps/desktop/src/sidecar/db/schema.ts` | `users` gets `pinHash`, `failedPinAttempts`, `recoveryKeyHash`; new `appState` table |
| `apps/desktop/src/sidecar/db/migrations.ts` | Additive migration for the above |
| `apps/desktop/src/sidecar/services/recoveryKey.ts` | **New.** Generate and normalise recovery keys |
| `apps/desktop/src/sidecar/services/AuthService.ts` | Rewritten: lock screen, PIN, recovery, lock |
| `apps/desktop/src/sidecar/services/SettingsFileService.ts` | Per-user folders, seeding |
| `apps/desktop/src/sidecar/handlers/auth.ts` | New routes |
| `apps/desktop/src/sidecar/handlers/settings.ts` | Comment only |
| `apps/desktop/src/sidecar/index.ts` | Wiring |
| `apps/desktop/src/shared/types/index.ts` | Auth types |
| `apps/desktop/src-tauri/src/commands/auth.rs`, `src-tauri/src/lib.rs` | Thin commands |
| `apps/desktop/src/renderer/ipc/index.ts` | `api.auth` |
| `apps/desktop/src/renderer/settings/store.ts` | `unload()` |
| `apps/desktop/src/renderer/store/keybindings.ts` | `unloadKeybindings()` |
| `apps/desktop/src/renderer/settings/migration.ts` | Per-user cache keys, legacy cache adoption |
| `apps/desktop/src/renderer/settings/index.ts` | Per-user boot cache |
| `apps/desktop/src/renderer/settings/session.ts` | **New.** Load / preview / flush a user's settings |
| `apps/desktop/src/renderer/settings/boot.ts` | No file reads before unlock |
| `apps/desktop/src/renderer/store/auth.ts` | Rewritten: lock-screen state machine |
| `apps/desktop/src/renderer/store/authStore.ts` | **Delete** (unused duplicate `useAuthStore`) |
| `apps/desktop/src/renderer/components/LoginScreen.tsx` | Rewritten as a shell over views |
| `apps/desktop/src/renderer/components/login/*.tsx` | **New.** One file per view + shared bits |
| `apps/desktop/src/renderer/components/LoginScreen.module.css` | A few new classes |
| `apps/desktop/src/renderer/hooks/useIdleLock.ts` | **New** |
| `apps/desktop/src/renderer/settings/builtin.ts` | `security.idleLockMinutes` |
| `apps/desktop/src/renderer/components/settings/AccountPage.tsx` (+ `.module.css`) | **New.** Change PIN / password / recovery key |
| `apps/desktop/src/renderer/components/settings/pages.ts` | Register Account page |
| `apps/desktop/src/renderer/App.tsx`, `TitleBar.tsx`, `VaultSidebar.tsx` | Lock instead of Log out |
| `.claude/CLAUDE.md`, `docs/theming/public-api.md`, the spec | Docs |

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/desktop/src/sidecar/db/schema.ts`
- Modify: `apps/desktop/src/sidecar/db/migrations.ts`
- Test: `apps/desktop/src/sidecar/db/__tests__/pinUnlockMigration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/sidecar/db/__tests__/pinUnlockMigration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { getRawSqlite } from '../client';
import { runMigrations } from '../migrations';
import { freshDb } from '../../services/__tests__/helpers';

// PIN unlock adds three columns to users and a machine-local app_state table.
// Additive only, and safe to run on every boot.

const columns = (table: string): string[] =>
  (getRawSqlite().query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);

describe('PIN unlock migration', () => {
  beforeEach(() => freshDb());

  it('adds the PIN and recovery-key columns to users', () => {
    expect(columns('users')).toEqual(
      expect.arrayContaining(['pin_hash', 'failed_pin_attempts', 'recovery_key_hash']),
    );
  });

  it('creates app_state', () => {
    expect(columns('app_state')).toEqual(['key', 'value', 'updated_at']);
  });

  it('starts existing users at zero failed attempts', () => {
    getRawSqlite().run(`INSERT INTO users (id, username, password_hash, created_at) VALUES ('u', 'u', 'h', 1)`);
    const row = getRawSqlite().query(`SELECT failed_pin_attempts AS n, pin_hash AS pin FROM users`).get() as { n: number; pin: string | null };
    expect(row).toEqual({ n: 0, pin: null });
  });

  it('is a no-op when run again', () => {
    expect(() => runMigrations()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/desktop && CORD_DB_PATH=:memory: bun test src/sidecar/db/__tests__/pinUnlockMigration.test.ts`
Expected: FAIL — `pin_hash` missing, `app_state` has no columns.

- [ ] **Step 3: Update the Drizzle schema**

In `apps/desktop/src/sidecar/db/schema.ts`, replace the `users` table and add `appState` right after it:

```ts
export const users = sqliteTable('users', {
  id:           text('id').primaryKey(),
  username:     text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** bcrypt hash of the unlock PIN; null until the user sets one. */
  pinHash:           text('pin_hash'),
  /** Wrong PINs in a row. At MAX_PIN_ATTEMPTS the PIN is refused until a password sign-in. */
  failedPinAttempts: integer('failed_pin_attempts').notNull().default(0),
  /** bcrypt hash of the recovery key; null until one is issued, and again once it is spent. */
  recoveryKeyHash:   text('recovery_key_hash'),
  createdAt:    integer('created_at').notNull(),
});

// ─── App state ────────────────────────────────────────────────────────────────

/**
 * Machine-local key/value state the lock screen needs before anyone unlocks
 * (`last_user_id`). Never synced and never written to operation_log.
 */
export const appState = sqliteTable('app_state', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
```

Add `appState,` to the `schema` export object after `users,`.

- [ ] **Step 4: Add the migration**

In `apps/desktop/src/sidecar/db/migrations.ts`, insert before the final `console.info('[db] migrations applied');`:

```ts
  // ── PIN unlock — docs/specs/2026-09-27-pin-unlock-design.md ────────────────
  addColumnIfMissing(db, 'users', 'pin_hash', '`pin_hash` text');
  addColumnIfMissing(db, 'users', 'failed_pin_attempts', '`failed_pin_attempts` integer DEFAULT 0 NOT NULL');
  addColumnIfMissing(db, 'users', 'recovery_key_hash', '`recovery_key_hash` text');

  db.run(`CREATE TABLE IF NOT EXISTS \`app_state\` (
    \`key\` text PRIMARY KEY NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` integer NOT NULL
  )`);
```

- [ ] **Step 5: Run the test and the sidecar suite**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar`
Expected: PASS, including the 4 new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/sidecar/db
git commit -m "Add PIN and recovery-key columns and the app_state table"
```

---

### Task 2: Recovery key helpers

**Files:**
- Create: `apps/desktop/src/sidecar/services/recoveryKey.ts`
- Test: `apps/desktop/src/sidecar/services/__tests__/recoveryKey.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'bun:test';
import { encodeRecoveryKey, generateRecoveryKey, normaliseRecoveryKey } from '../recoveryKey';

// A recovery key is 160 random bits someone may copy onto paper and type back
// months later, so the format is forgiving: Crockford base32, grouped in fours.

const FORMAT = /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/;

describe('recovery keys', () => {
  it('generates eight groups of four Crockford characters', () => {
    expect(generateRecoveryKey()).toMatch(FORMAT);
  });

  it('never repeats', () => {
    expect(generateRecoveryKey()).not.toBe(generateRecoveryKey());
  });

  it('encodes bytes big-endian, five bits per character', () => {
    expect(encodeRecoveryKey(new Uint8Array(20))).toBe(Array(8).fill('0000').join('-'));
    expect(encodeRecoveryKey(new Uint8Array(20).fill(255))).toBe(Array(8).fill('ZZZZ').join('-'));
    expect(encodeRecoveryKey(new Uint8Array([0b00001000, 0b01000000, 0, 0, 0])).slice(0, 4)).toBe('1110');
  });

  it('normalises case, separators and look-alike letters', () => {
    expect(normaliseRecoveryKey(' k7qm-2xvd o1il ')).toBe('K7QM2XVD0111');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/recoveryKey.test.ts`
Expected: FAIL — cannot find module `../recoveryKey`.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/sidecar/services/recoveryKey.ts`:

```ts
import { randomBytes } from 'node:crypto';

/**
 * Recovery keys: 20 random bytes (160 bits) in Crockford base32, shown as
 * eight groups of four — `K7QM-2XVD-…`. Crockford leaves out I, L, O and U, so
 * a key copied by hand survives the usual misreadings (see normalise below).
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_KEY_BYTES = 20;

export function encodeRecoveryKey(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff; // never more than 12 live bits
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return (out.match(/.{1,4}/g) ?? []).join('-');
}

export function generateRecoveryKey(): string {
  return encodeRecoveryKey(randomBytes(RECOVERY_KEY_BYTES));
}

/** The form that is hashed and compared: uppercase, no separators, look-alikes folded. */
export function normaliseRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/recoveryKey.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/sidecar/services/recoveryKey.ts apps/desktop/src/sidecar/services/__tests__/recoveryKey.test.ts
git commit -m "Add recovery key generation and normalisation"
```

---

### Task 3: AuthService — lock screen, sign-in and PIN

**Files:**
- Modify: `apps/desktop/src/shared/types/index.ts` (Auth section)
- Rewrite: `apps/desktop/src/sidecar/services/AuthService.ts`
- Test: `apps/desktop/src/sidecar/services/__tests__/AuthService.test.ts`

- [ ] **Step 1: Add the shared types**

In `apps/desktop/src/shared/types/index.ts`, after `LoginInput`, add:

```ts
/** A signed-in user as the sidecar reports them. */
export interface AuthUser extends User {
  hasPin: boolean;
  hasRecoveryKey: boolean;
}

export interface LockScreenUser {
  id: string;
  username: string;
  hasPin: boolean;
  /** Too many wrong PINs: only the password works until the next password sign-in. */
  pinLocked: boolean;
}

export interface LockScreenState {
  /** Alphabetical. */
  users: LockScreenUser[];
  /** The last user who unlocked, if they still exist. */
  lastUserId: string | null;
}

export interface UnlockPinInput {
  userId: string;
  pin: string;
}

export type PinUnlockResult =
  | { ok: true; user: AuthUser }
  | { ok: false; triesLeft: number };

export interface SetPinInput {
  pin: string;
  /** Required when replacing an existing PIN. */
  password?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface IssueRecoveryKeyInput {
  /** Required when replacing an existing key. */
  password?: string;
}

export interface RecoveryKeyResult {
  /** Shown once; only its hash is stored. */
  recoveryKey: string;
}

export interface RecoverInput {
  username: string;
  recoveryKey: string;
  newPassword: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/desktop/src/sidecar/services/__tests__/AuthService.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { AuthService, MAX_PIN_ATTEMPTS } from '../AuthService';
import type { AuthUser } from '@shared/types';
import { freshDb } from './helpers';

// Fast hashes and no back-off: these tests are about the rules, not bcrypt.
const makeAuth = (onRegister?: (userId: string) => void): AuthService =>
  new AuthService({ hashCost: 4, recoveryFailureDelayMs: 0, onRegister });

let auth: AuthService;

beforeEach(() => {
  freshDb();
  auth = makeAuth();
  auth.lock(); // the session is process-wide; start every test signed out
});

async function userWithPin(username = 'alice', pin = '1234'): Promise<AuthUser> {
  const user = await auth.register({ username, password: 'correct horse' });
  await auth.setPin({ pin });
  auth.lock();
  return user;
}

describe('AuthService — sign-in and PIN unlock', () => {
  it('registering signs in, remembers the user and reports no PIN yet', async () => {
    const registered: string[] = [];
    auth = makeAuth((id) => registered.push(id));
    const user = await auth.register({ username: ' Alice ', password: 'correct horse' });
    expect(user).toMatchObject({ username: 'alice', hasPin: false, hasRecoveryKey: false });
    expect(auth.getSession()?.userId).toBe(user.id);
    expect(auth.currentUser()).toEqual(user);
    expect(registered).toEqual([user.id]);
    expect(auth.getLockScreenState().lastUserId).toBe(user.id);
  });

  it('lists users alphabetically for the lock screen', async () => {
    expect(auth.getLockScreenState()).toEqual({ users: [], lastUserId: null });
    const zed = await userWithPin('zed');
    const amy = await auth.register({ username: 'amy', password: 'pw-amy-123' });
    expect(auth.getLockScreenState()).toEqual({
      users: [
        { id: amy.id, username: 'amy', hasPin: false, pinLocked: false },
        { id: zed.id, username: 'zed', hasPin: true, pinLocked: false },
      ],
      lastUserId: amy.id,
    });
  });

  it('accepts only 4 to 6 digit PINs', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    for (const pin of ['123', '1234567', '12a4', ' 1234', '']) {
      await expect(auth.setPin({ pin })).rejects.toThrow('PIN must be 4 to 6 digits');
    }
    await expect(auth.setPin({ pin: '123456' })).resolves.toMatchObject({ hasPin: true });
  });

  it('needs the password to replace an existing PIN', async () => {
    const user = await auth.register({ username: 'alice', password: 'correct horse' });
    await auth.setPin({ pin: '1234' });
    await expect(auth.setPin({ pin: '5678' })).rejects.toThrow('Wrong password');
    await expect(auth.setPin({ pin: '5678', password: 'nope' })).rejects.toThrow('Wrong password');
    await auth.setPin({ pin: '5678', password: 'correct horse' });
    auth.lock();
    expect((await auth.unlockWithPin(user.id, '5678')).ok).toBe(true);
  });

  it('unlocks with the right PIN and remembers the user', async () => {
    const user = await userWithPin();
    const result = await auth.unlockWithPin(user.id, '1234');
    expect(result).toEqual({ ok: true, user: expect.objectContaining({ id: user.id, hasPin: true }) });
    expect(auth.getSession()?.userId).toBe(user.id);
    expect(auth.getLockScreenState().lastUserId).toBe(user.id);
  });

  it('counts wrong PINs and refuses the PIN at the limit', async () => {
    const user = await userWithPin();
    for (let left = MAX_PIN_ATTEMPTS - 1; left >= 0; left--) {
      expect(await auth.unlockWithPin(user.id, '0000')).toEqual({ ok: false, triesLeft: left });
    }
    expect(auth.getSession()).toBeNull();
    expect(auth.getLockScreenState().users[0]!.pinLocked).toBe(true);
    // Even the right PIN is refused now.
    await expect(auth.unlockWithPin(user.id, '1234')).rejects.toThrow('Too many wrong PINs');
  });

  it('keeps the count across restarts', async () => {
    const user = await userWithPin();
    await auth.unlockWithPin(user.id, '0000');
    const restarted = makeAuth();
    expect(await restarted.unlockWithPin(user.id, '0000')).toEqual({ ok: false, triesLeft: MAX_PIN_ATTEMPTS - 2 });
  });

  it('resets the count after the right PIN', async () => {
    const user = await userWithPin();
    await auth.unlockWithPin(user.id, '0000');
    await auth.unlockWithPin(user.id, '1234');
    auth.lock();
    expect(await auth.unlockWithPin(user.id, '0000')).toEqual({ ok: false, triesLeft: MAX_PIN_ATTEMPTS - 1 });
  });

  it('re-enables a refused PIN after a password sign-in', async () => {
    const user = await userWithPin();
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) await auth.unlockWithPin(user.id, '0000');
    await auth.login({ username: 'alice', password: 'correct horse' });
    auth.lock();
    expect((await auth.unlockWithPin(user.id, '1234')).ok).toBe(true);
  });

  it('refuses PIN unlock for a user who has no PIN', async () => {
    const user = await auth.register({ username: 'alice', password: 'correct horse' });
    auth.lock();
    await expect(auth.unlockWithPin(user.id, '1234')).rejects.toThrow('no PIN yet');
  });

  it('rejects a bad sign-in without saying which part was wrong', async () => {
    await userWithPin();
    await expect(auth.login({ username: 'alice', password: 'nope' })).rejects.toThrow('Invalid username or password');
    await expect(auth.login({ username: 'bob', password: 'nope' })).rejects.toThrow('Invalid username or password');
  });

  it('forgets the session on lock', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    auth.lock();
    expect(auth.currentUser()).toBeNull();
    expect(() => auth.requireSession()).toThrow('Not authenticated');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/AuthService.test.ts`
Expected: FAIL — `MAX_PIN_ATTEMPTS` not exported, `setPin` / `lock` not functions.

- [ ] **Step 4: Rewrite AuthService**

Replace `apps/desktop/src/sidecar/services/AuthService.ts` entirely:

```ts
import { nanoid } from 'nanoid';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { appState, users } from '../db/schema';
import type {
  AuthSession,
  AuthUser,
  LockScreenState,
  LoginInput,
  PinUnlockResult,
  RegisterInput,
  SetPinInput,
} from '@shared/types';

// In-process session — the sidecar is a single-user local process.
let _session: AuthSession | null = null;

/** Wrong PINs in a row before the PIN is refused until a password sign-in. */
export const MAX_PIN_ATTEMPTS = 5;

const PIN_PATTERN = /^\d{4,6}$/;
const LAST_USER_KEY = 'last_user_id';

type UserRow = typeof users.$inferSelect;

export interface AuthServiceOptions {
  /** bcrypt cost. Tests lower it; the app uses the default. */
  hashCost?: number;
  /** Pause after a wrong recovery key, to slow guessing. */
  recoveryFailureDelayMs?: number;
  /** Runs after a user is created — the sidecar creates their settings folder here. */
  onRegister?: (userId: string) => void;
}

/**
 * Accounts on this machine. Password, PIN and recovery-key hashes, the
 * attempt counter and `last_user_id` are machine-local and must never
 * replicate, so none of these writes go to operation_log (CLAUDE.md,
 * principle 2).
 */
export class AuthService {
  private readonly hashCost: number;
  private readonly recoveryFailureDelayMs: number;
  private readonly onRegister: (userId: string) => void;

  constructor(options: AuthServiceOptions = {}) {
    this.hashCost = options.hashCost ?? 12;
    this.recoveryFailureDelayMs = options.recoveryFailureDelayMs ?? 1000;
    this.onRegister = options.onRegister ?? ((): void => {});
  }

  /** Everything the lock screen shows before anyone has unlocked. */
  getLockScreenState(): LockScreenState {
    const db = getDb();
    const rows = db.select().from(users).orderBy(asc(users.username)).all();
    const last = db.select().from(appState).where(eq(appState.key, LAST_USER_KEY)).get();
    return {
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        hasPin: r.pinHash !== null,
        pinLocked: r.failedPinAttempts >= MAX_PIN_ATTEMPTS,
      })),
      lastUserId: last && rows.some((r) => r.id === last.value) ? last.value : null,
    };
  }

  async register(input: RegisterInput): Promise<AuthUser> {
    const db = getDb();
    const id = nanoid();
    db.insert(users).values({
      id,
      username:     input.username.toLowerCase().trim(),
      passwordHash: await this.hash(input.password),
      createdAt:    Date.now(),
    }).run();

    const row = this.findById(id);
    if (!row) throw new Error('User not found after insert');
    this.onRegister(id);
    // Registering signs you in — setup continues with choosing a PIN.
    return this.startSession(row);
  }

  async login(input: LoginInput): Promise<AuthUser> {
    const row = this.findByUsername(input.username);
    if (!row || !(await Bun.password.verify(input.password, row.passwordHash))) {
      throw new Error('Invalid username or password');
    }
    // A password sign-in is what re-enables a PIN refused after wrong attempts.
    this.update(row.id, { failedPinAttempts: 0 });
    return this.startSession({ ...row, failedPinAttempts: 0 });
  }

  async unlockWithPin(userId: string, pin: string): Promise<PinUnlockResult> {
    const row = this.findById(userId);
    if (!row) throw new Error('Unknown user');
    if (row.pinHash === null) throw new Error('This user has no PIN yet. Sign in with your password.');
    if (row.failedPinAttempts >= MAX_PIN_ATTEMPTS) {
      throw new Error('Too many wrong PINs. Sign in with your password.');
    }

    if (!(await Bun.password.verify(pin, row.pinHash))) {
      const attempts = row.failedPinAttempts + 1;
      this.update(row.id, { failedPinAttempts: attempts });
      return { ok: false, triesLeft: MAX_PIN_ATTEMPTS - attempts };
    }

    this.update(row.id, { failedPinAttempts: 0 });
    return { ok: true, user: this.startSession({ ...row, failedPinAttempts: 0 }) };
  }

  /** The first PIN is part of setup; replacing one needs the password. */
  async setPin(input: SetPinInput): Promise<AuthUser> {
    const row = this.sessionRow();
    if (!PIN_PATTERN.test(input.pin)) throw new Error('PIN must be 4 to 6 digits');
    if (row.pinHash !== null) await this.requirePassword(row, input.password);

    const next = { pinHash: await this.hash(input.pin), failedPinAttempts: 0 };
    this.update(row.id, next);
    return toAuthUser({ ...row, ...next });
  }

  lock(): void {
    _session = null;
  }

  /** The signed-in user, or null. */
  currentUser(): AuthUser | null {
    if (!_session) return null;
    const row = this.findById(_session.userId);
    return row ? toAuthUser(row) : null;
  }

  getSession(): AuthSession | null {
    return _session;
  }

  requireSession(): AuthSession {
    if (!_session) throw new Error('Not authenticated');
    return _session;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private startSession(row: UserRow): AuthUser {
    const now = Date.now();
    _session = { userId: row.id, username: row.username, loggedInAt: now };
    getDb()
      .insert(appState)
      .values({ key: LAST_USER_KEY, value: row.id, updatedAt: now })
      .onConflictDoUpdate({ target: appState.key, set: { value: row.id, updatedAt: now } })
      .run();
    return toAuthUser(row);
  }

  private sessionRow(): UserRow {
    const row = this.findById(this.requireSession().userId);
    if (!row) throw new Error('Not authenticated');
    return row;
  }

  private async requirePassword(row: UserRow, password: string | undefined): Promise<void> {
    if (!password || !(await Bun.password.verify(password, row.passwordHash))) {
      throw new Error('Wrong password');
    }
  }

  private hash(secret: string): Promise<string> {
    return Bun.password.hash(secret, { algorithm: 'bcrypt', cost: this.hashCost });
  }

  private findById(id: string): UserRow | undefined {
    return getDb().select().from(users).where(eq(users.id, id)).get();
  }

  private findByUsername(username: string): UserRow | undefined {
    return getDb().select().from(users).where(eq(users.username, username.toLowerCase().trim())).get();
  }

  private update(id: string, values: Partial<UserRow>): void {
    getDb().update(users).set(values).where(eq(users.id, id)).run();
  }
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt,
    hasPin: row.pinHash !== null,
    hasRecoveryKey: row.recoveryKeyHash !== null,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/AuthService.test.ts`
Expected: PASS (12 tests).

`src/sidecar/handlers/auth.ts` still calls the removed `hasUsers()`; it is replaced in Task 6. Don't run `tsc` yet.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/types/index.ts apps/desktop/src/sidecar/services/AuthService.ts apps/desktop/src/sidecar/services/__tests__/AuthService.test.ts
git commit -m "Unlock with a PIN and remember the last user"
```

---

### Task 4: AuthService — password change and recovery keys

**Files:**
- Modify: `apps/desktop/src/sidecar/services/AuthService.ts`
- Test: `apps/desktop/src/sidecar/services/__tests__/AuthService.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

Append to `AuthService.test.ts`:

```ts
describe('AuthService — password and recovery key', () => {
  const KEY_FORMAT = /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/;

  it('changes the password only with the current one', async () => {
    await auth.register({ username: 'alice', password: 'old password' });
    await expect(auth.changePassword({ currentPassword: 'nope', newPassword: 'new password' })).rejects.toThrow('Wrong password');
    await auth.changePassword({ currentPassword: 'old password', newPassword: 'new password' });
    auth.lock();
    await expect(auth.login({ username: 'alice', password: 'old password' })).rejects.toThrow();
    await expect(auth.login({ username: 'alice', password: 'new password' })).resolves.toMatchObject({ username: 'alice' });
  });

  it('issues the first key without a password and later ones only with it', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    const first = await auth.issueRecoveryKey({});
    expect(first.recoveryKey).toMatch(KEY_FORMAT);
    expect(auth.currentUser()?.hasRecoveryKey).toBe(true);
    await expect(auth.issueRecoveryKey({})).rejects.toThrow('Wrong password');
    const second = await auth.issueRecoveryKey({ password: 'correct horse' });
    expect(second.recoveryKey).not.toBe(first.recoveryKey);
  });

  it('resets the password with the key, clears the PIN and spends the key', async () => {
    await auth.register({ username: 'alice', password: 'forgotten' });
    await auth.setPin({ pin: '1234' });
    const { recoveryKey } = await auth.issueRecoveryKey({});
    auth.lock();

    const typedSloppily = recoveryKey.toLowerCase().replace(/-/g, ' ');
    const user = await auth.recover({ username: 'Alice', recoveryKey: typedSloppily, newPassword: 'remembered' });
    expect(user).toMatchObject({ hasPin: false, hasRecoveryKey: false });
    expect(auth.getSession()?.userId).toBe(user.id);

    auth.lock();
    await expect(auth.login({ username: 'alice', password: 'remembered' })).resolves.toBeDefined();
    auth.lock();
    await expect(auth.recover({ username: 'alice', recoveryKey, newPassword: 'again' }))
      .rejects.toThrow("That recovery key doesn't match.");
  });

  it('stops accepting an old key once a new one is issued', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    const { recoveryKey: old } = await auth.issueRecoveryKey({});
    await auth.issueRecoveryKey({ password: 'correct horse' });
    auth.lock();
    await expect(auth.recover({ username: 'alice', recoveryKey: old, newPassword: 'x' }))
      .rejects.toThrow("That recovery key doesn't match.");
  });

  it('answers a wrong key and an unknown user the same way', async () => {
    await auth.register({ username: 'alice', password: 'correct horse' });
    await auth.issueRecoveryKey({});
    auth.lock();
    const wrong = 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA';
    await expect(auth.recover({ username: 'alice', recoveryKey: wrong, newPassword: 'x' }))
      .rejects.toThrow("That recovery key doesn't match.");
    await expect(auth.recover({ username: 'nobody', recoveryKey: wrong, newPassword: 'x' }))
      .rejects.toThrow("That recovery key doesn't match.");
    expect(auth.getSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/AuthService.test.ts`
Expected: the 5 new tests FAIL — `changePassword` / `issueRecoveryKey` / `recover` not functions.

- [ ] **Step 3: Implement**

In `AuthService.ts`:

Add the import:

```ts
import { generateRecoveryKey, normaliseRecoveryKey } from './recoveryKey';
```

Add to the `@shared/types` import: `ChangePasswordInput`, `IssueRecoveryKeyInput`, `RecoverInput`, `RecoveryKeyResult`.

Add these methods after `setPin`:

```ts
  async changePassword(input: ChangePasswordInput): Promise<void> {
    const row = this.sessionRow();
    await this.requirePassword(row, input.currentPassword);
    this.update(row.id, { passwordHash: await this.hash(input.newPassword) });
  }

  /**
   * Issues a new recovery key and returns it — the only time it exists in
   * plain text. The first key is part of setup; replacing one needs the
   * password, and the old key stops working.
   */
  async issueRecoveryKey(input: IssueRecoveryKeyInput): Promise<RecoveryKeyResult> {
    const row = this.sessionRow();
    if (row.recoveryKeyHash !== null) await this.requirePassword(row, input.password);
    const recoveryKey = generateRecoveryKey();
    this.update(row.id, { recoveryKeyHash: await this.hash(normaliseRecoveryKey(recoveryKey)) });
    return { recoveryKey };
  }

  /**
   * Forgotten password: the recovery key sets a new one and signs in. The key
   * is spent and the PIN goes with the old password, so setup continues with
   * a new PIN and a new key.
   */
  async recover(input: RecoverInput): Promise<AuthUser> {
    const row = this.findByUsername(input.username);
    const matches = row !== undefined
      && row.recoveryKeyHash !== null
      && (await Bun.password.verify(normaliseRecoveryKey(input.recoveryKey), row.recoveryKeyHash));
    if (!row || !matches) {
      await Bun.sleep(this.recoveryFailureDelayMs);
      throw new Error("That recovery key doesn't match.");
    }

    const next = {
      passwordHash: await this.hash(input.newPassword),
      pinHash: null,
      failedPinAttempts: 0,
      recoveryKeyHash: null,
    };
    this.update(row.id, next);
    return this.startSession({ ...row, ...next });
  }
```

- [ ] **Step 4: Run the tests**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/AuthService.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/sidecar/services
git commit -m "Change passwords and reset them with a recovery key"
```

---

### Task 5: Per-user settings files

**Files:**
- Modify: `apps/desktop/src/sidecar/services/SettingsFileService.ts`
- Rewrite: `apps/desktop/src/sidecar/services/__tests__/SettingsFileService.test.ts`

- [ ] **Step 1: Rewrite the tests**

Replace `SettingsFileService.test.ts` entirely:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CONFIG_BYTES, SettingsFileService } from '../SettingsFileService';

// Settings files are stored as opaque text: the renderer owns parsing, so a
// hand-edited file — comments and all — must round-trip byte for byte. Each
// user has their own folder; the signed-in user decides which one is used.

describe('SettingsFileService', () => {
  let dir: string;
  let base: string;
  let service: SettingsFileService;
  const userDir = (id: string): string => join(base, 'users', id);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cord-config-'));
    base = join(dir, 'nested');
    process.env['CORD_CONFIG_DIR'] = base;
    service = new SettingsFileService(() => 'u1');
  });

  afterEach(() => {
    delete process.env['CORD_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a missing file as null', () => {
    expect(service.read('settings')).toBeNull();
  });

  it('writes text verbatim into the user folder and reads it back', () => {
    const text = '{\n  // bigger text\n  "editor.fontSize": 17,\n}\n';
    service.write('settings', text);
    expect(readFileSync(join(userDir('u1'), 'settings.json'), 'utf8')).toBe(text);
    expect(service.read('settings')).toBe(text);
  });

  it('replaces an existing file and leaves no temp file behind', () => {
    service.write('keybindings', '{"a":1}');
    service.write('keybindings', '{"a":2}');
    expect(service.read('keybindings')).toBe('{"a":2}');
    expect(readdirSync(userDir('u1'))).toEqual(['keybindings.json']);
  });

  it('keeps each user’s files apart', () => {
    service.write('settings', '{"who":"u1"}');
    const other = new SettingsFileService(() => 'u2');
    expect(other.read('settings')).toBeNull();
    other.write('settings', '{"who":"u2"}');
    expect(service.read('settings')).toBe('{"who":"u1"}');
  });

  it('refuses when nobody is signed in', () => {
    const signedOut = new SettingsFileService(() => { throw new Error('Not authenticated'); });
    expect(() => signedOut.read('settings')).toThrow('Not authenticated');
  });

  it('gives an existing user a copy of the shared files, once', () => {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'settings.json'), '{"shared":1}');
    expect(service.read('settings')).toBe('{"shared":1}');
    expect(service.read('keybindings')).toBeNull();
    writeFileSync(join(base, 'settings.json'), '{"shared":2}');
    expect(service.read('settings')).toBe('{"shared":1}');
  });

  it('starts a newly registered user from defaults', () => {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'settings.json'), '{"shared":1}');
    service.createUserDir('u1');
    expect(service.read('settings')).toBeNull();
  });

  it('rejects user ids that are not plain ids', () => {
    expect(() => new SettingsFileService(() => '../escape').read('settings')).toThrow('Invalid user id');
  });

  it('rejects unknown file names', () => {
    expect(() => service.read('../cord')).toThrow(/Unknown settings file/);
    expect(() => service.write('secrets', '{}')).toThrow(/Unknown settings file/);
  });

  it('rejects oversized text without touching the file', () => {
    service.write('settings', '{}');
    expect(() => service.write('settings', 'x'.repeat(MAX_CONFIG_BYTES + 1))).toThrow(/exceeds/);
    expect(service.read('settings')).toBe('{}');
  });

  it('rejects non-string text', () => {
    expect(() => service.write('settings', 42 as unknown as string)).toThrow(/must be a string/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/SettingsFileService.test.ts`
Expected: FAIL — files land in `nested/` not `nested/users/u1/`, `createUserDir` missing.

- [ ] **Step 3: Implement**

Replace `SettingsFileService.ts` entirely:

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDbPath } from '../db/client';

/**
 * Stores each user's settings files as opaque text in
 * `<config dir>/users/<userId>/` (config dir = `~/.cord`, beside the
 * database). The renderer owns the schema and does all parsing, so a
 * hand-edited file — comments and all — round-trips exactly.
 */

export const CONFIG_FILES = ['settings', 'keybindings'] as const;
export type ConfigFileName = (typeof CONFIG_FILES)[number];

/** Anything larger is not a settings file someone meant to write. */
export const MAX_CONFIG_BYTES = 1024 * 1024;

/** nanoid's alphabet. Anything else could climb out of the users folder. */
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function resolveConfigDir(): string {
  return process.env['CORD_CONFIG_DIR'] ?? dirname(resolveDbPath());
}

export function userConfigDir(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error('Invalid user id');
  return join(resolveConfigDir(), 'users', userId);
}

export class SettingsFileService {
  /** @param currentUserId the signed-in user's id; throws when nobody is signed in. */
  constructor(private readonly currentUserId: () => string) {}

  read(name: string): string | null {
    const path = this.pathFor(name);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }

  write(name: string, text: string): void {
    const path = this.pathFor(name);
    if (typeof text !== 'string') throw new Error('Settings text must be a string');
    if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) {
      throw new Error(`Settings file exceeds ${MAX_CONFIG_BYTES} bytes`);
    }
    mkdirSync(dirname(path), { recursive: true });
    // Write beside the target and rename over it, so a crash mid-write never
    // leaves a truncated settings file.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, path);
  }

  /** A new user's folder, created empty so they start from the defaults. */
  createUserDir(userId: string): void {
    mkdirSync(userConfigDir(userId), { recursive: true });
  }

  private pathFor(name: string): string {
    if (!(CONFIG_FILES as readonly string[]).includes(name)) {
      throw new Error(`Unknown settings file "${name}"`);
    }
    const userId = this.currentUserId();
    this.seedUserDir(userId);
    return join(userConfigDir(userId), `${name}.json`);
  }

  /**
   * Users who existed before settings were per user have no folder yet. They
   * get a copy of the shared files so nobody loses their setup. The shared
   * files stay where they are and are never read again.
   */
  private seedUserDir(userId: string): void {
    const dir = userConfigDir(userId);
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
    for (const name of CONFIG_FILES) {
      const shared = join(resolveConfigDir(), `${name}.json`);
      if (existsSync(shared)) copyFileSync(shared, join(dir, `${name}.json`));
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `CORD_DB_PATH=:memory: bun test src/sidecar/services/__tests__/SettingsFileService.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/sidecar/services/SettingsFileService.ts apps/desktop/src/sidecar/services/__tests__/SettingsFileService.test.ts
git commit -m "Keep settings files per user"
```

---

### Task 6: Routes, sidecar wiring, Tauri commands and IPC

**Files:**
- Rewrite: `apps/desktop/src/sidecar/handlers/auth.ts`
- Modify: `apps/desktop/src/sidecar/handlers/settings.ts` (comment)
- Modify: `apps/desktop/src/sidecar/index.ts`
- Rewrite: `apps/desktop/src-tauri/src/commands/auth.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/renderer/ipc/index.ts`
- Test: existing `apps/desktop/src/renderer/ipc/__tests__/parity.test.ts`

- [ ] **Step 1: Rewrite the auth handlers**

Replace `apps/desktop/src/sidecar/handlers/auth.ts`:

```ts
import { Router, json, ok } from '../router';
import type { AuthService } from '../services/AuthService';
import type { UnlockPinInput } from '@shared/types';

// No session checks here: these routes are how a session starts. The ones that
// need a signed-in user get it from AuthService, which refuses without one.
export function registerAuthHandlers(router: Router, auth: AuthService): void {
  router.get('/auth/lock-screen', async () => json(auth.getLockScreenState()));

  router.get('/auth/current', async () => json(auth.currentUser()));

  router.post('/auth/register', async (req) => json(await auth.register(await req.json()), 201));

  router.post('/auth/login', async (req) => json(await auth.login(await req.json())));

  router.post('/auth/unlock-pin', async (req) => {
    const { userId, pin } = (await req.json()) as UnlockPinInput;
    return json(await auth.unlockWithPin(userId, pin));
  });

  router.post('/auth/pin', async (req) => json(await auth.setPin(await req.json())));

  router.post('/auth/password', async (req) => {
    await auth.changePassword(await req.json());
    return ok();
  });

  router.post('/auth/recovery-key', async (req) => json(await auth.issueRecoveryKey(await req.json())));

  router.post('/auth/recover', async (req) => json(await auth.recover(await req.json())));

  router.post('/auth/lock', async () => {
    auth.lock();
    return ok();
  });
}
```

- [ ] **Step 2: Update the settings handler comment**

In `apps/desktop/src/sidecar/handlers/settings.ts`, replace the two comment lines above `export function registerSettingsHandlers` with:

```ts
// The files belong to the signed-in user: SettingsFileService resolves the
// user and refuses when nobody is signed in. The lock screen paints from the
// renderer's per-user boot cache instead of reading files.
```

- [ ] **Step 3: Wire the services**

In `apps/desktop/src/sidecar/index.ts` replace `const auth      = new AuthService();` with:

```ts
// A new user's settings folder is created empty, so they start from the
// defaults instead of being seeded from the pre-PIN shared files.
const auth      = new AuthService({ onRegister: (userId) => settingsFiles.createUserDir(userId) });
```

and replace `const settingsFiles = new SettingsFileService();` with:

```ts
const settingsFiles = new SettingsFileService(() => auth.requireSession().userId);
```

(`onRegister` runs only on a request, long after both constants exist.)

- [ ] **Step 4: Replace the Tauri auth commands**

Replace `apps/desktop/src-tauri/src/commands/auth.rs`:

```rust
use crate::state::AppState;
use super::http::{fwd_get, fwd_post};
use serde_json::Value;
use tauri::State;

// Thin forwards. The sidecar validates input and owns every rule.

#[tauri::command]
pub async fn auth_lock_screen(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_get(&state, "/auth/lock-screen").await
}

#[tauri::command]
pub async fn auth_current(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_get(&state, "/auth/current").await
}

#[tauri::command]
pub async fn auth_register(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/register", data).await
}

#[tauri::command]
pub async fn auth_login(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/login", data).await
}

#[tauri::command]
pub async fn auth_unlock_pin(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/unlock-pin", data).await
}

#[tauri::command]
pub async fn auth_set_pin(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/pin", data).await
}

#[tauri::command]
pub async fn auth_change_password(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/password", data).await
}

#[tauri::command]
pub async fn auth_issue_recovery_key(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/recovery-key", data).await
}

#[tauri::command]
pub async fn auth_recover(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    fwd_post(&state, "/auth/recover", data).await
}

#[tauri::command]
pub async fn auth_lock(state: State<'_, AppState>) -> Result<Value, String> {
    fwd_post(&state, "/auth/lock", Value::Null).await
}
```

In `apps/desktop/src-tauri/src/lib.rs`, replace the five `commands::auth::…` lines under `// auth` with:

```rust
            commands::auth::auth_lock_screen,
            commands::auth::auth_current,
            commands::auth::auth_register,
            commands::auth::auth_login,
            commands::auth::auth_unlock_pin,
            commands::auth::auth_set_pin,
            commands::auth::auth_change_password,
            commands::auth::auth_issue_recovery_key,
            commands::auth::auth_recover,
            commands::auth::auth_lock,
```

- [ ] **Step 5: Replace `api.auth` in the renderer**

In `apps/desktop/src/renderer/ipc/index.ts`, replace the whole `auth: { … },` block with:

```ts
  auth: {
    lockScreen:       ()                            => invoke<LockScreenState>('auth_lock_screen'),
    current:          ()                            => invoke<AuthUser | null>('auth_current'),
    register:         (data: RegisterInput)         => invoke<AuthUser>('auth_register', { data }),
    login:            (data: LoginInput)            => invoke<AuthUser>('auth_login', { data }),
    unlockPin:        (data: UnlockPinInput)        => invoke<PinUnlockResult>('auth_unlock_pin', { data }),
    setPin:           (data: SetPinInput)           => invoke<AuthUser>('auth_set_pin', { data }),
    changePassword:   (data: ChangePasswordInput)   => invoke<{ ok: true }>('auth_change_password', { data }),
    issueRecoveryKey: (data: IssueRecoveryKeyInput) => invoke<RecoveryKeyResult>('auth_issue_recovery_key', { data }),
    recover:          (data: RecoverInput)          => invoke<AuthUser>('auth_recover', { data }),
    lock:             ()                            => invoke<{ ok: true }>('auth_lock'),
  },
```

In the `import type { … } from '@shared/types';` block at the top of the same file, remove `User` and `AuthSession` if nothing else in the file uses them (search the file first), and add: `AuthUser, LockScreenState, UnlockPinInput, PinUnlockResult, SetPinInput, ChangePasswordInput, IssueRecoveryKeyInput, RecoveryKeyResult, RecoverInput`.

- [ ] **Step 6: Run the parity test, the sidecar tests and the Rust check**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/ipc src/sidecar`
Expected: PASS — every invoked command is registered and vice versa.

Run: `cd src-tauri && cargo check`
Expected: finishes without errors.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/sidecar apps/desktop/src-tauri/src apps/desktop/src/renderer/ipc/index.ts
git commit -m "Expose PIN unlock, recovery and lock over IPC"
```

---

### Task 7: Unloading the settings and keybinding stores

A user switch must write the outgoing user's pending edits to *their* file, then forget that file before the next user's is read.

**Files:**
- Modify: `apps/desktop/src/renderer/settings/store.ts`
- Modify: `apps/desktop/src/renderer/store/keybindings.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/store.test.ts` (append)
- Test: `apps/desktop/src/renderer/store/__tests__/keybindings.test.ts` (append)

- [ ] **Step 1: Append the failing settings-store test**

Append inside the top-level `describe('settings store', …)` in `store.test.ts`:

```ts
  it('unload writes pending edits, then forgets the file', async () => {
    const h = harness('{"editor.fontSize": 18}');
    await h.store.getState().load();
    h.store.getState().set('editor.spellCheck', true);
    await h.store.getState().unload();

    expect(h.disk.text).toContain('editor.spellCheck');
    expect(h.store.getState()).toMatchObject({
      loaded: false,
      text: '',
      data: {},
      values: { 'editor.fontSize': 15, 'editor.spellCheck': false },
    });

    // Until the next load, an edit must not overwrite whichever file comes next.
    h.store.getState().set('editor.fontSize', 19);
    await Bun.sleep(20);
    expect(h.disk.writes).toHaveLength(1);
  });
```

- [ ] **Step 2: Append the failing keybindings test**

In `keybindings.test.ts`, add `unloadKeybindings` to the import list from `'../keybindings'`, then append at the end of the file:

```ts
describe('unloadKeybindings', () => {
  it('writes pending changes, then falls back to the defaults', async () => {
    disk.text = null;
    disk.writes = [];
    await useKeybindingStore.getState().load();
    const def = KEYBINDINGS[0]!;
    useKeybindingStore.getState().setBinding(def.id, 'Ctrl+Alt+F12');

    await unloadKeybindings();

    expect(disk.text).toContain('Ctrl+Alt+F12');
    expect(useKeybindingStore.getState().bindings[def.id]).toBe(def.defaultAccel);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/store.test.ts src/renderer/store/__tests__/keybindings.test.ts`
Expected: FAIL — `unload` is not a function; `unloadKeybindings` is not exported.

- [ ] **Step 4: Implement `unload` in the settings store**

In `settings/store.ts`, add to `SettingsState` after `flush`:

```ts
  /** Write anything pending, then return to defaults and not-loaded (a user switch). */
  unload: () => Promise<void>;
```

and to the returned object after `flush: () => writer.flush(),`:

```ts
      unload: async () => {
        await writer.flush();
        set({
          values: resolveValues(deps.definitions(), {}).values,
          data: {},
          text: '',
          problems: [],
          syntaxError: false,
          saveError: null,
          loaded: false,
        });
      },
```

- [ ] **Step 5: Implement `unloadKeybindings`**

In `store/keybindings.ts`, after `flushKeybindings`, add:

```ts
/** Write any pending change, then forget this user's file (before another user's is loaded). */
export async function unloadKeybindings(): Promise<void> {
  await writer.flush();
  fileText = '';
  useKeybindingStore.setState({ bindings: defaultMap(), fileError: null });
}
```

(`useKeybindingStore` is declared later in the file; that is fine because the function only runs after the module has loaded.)

- [ ] **Step 6: Run the tests**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings src/renderer/store`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/settings/store.ts apps/desktop/src/renderer/store/keybindings.ts apps/desktop/src/renderer/settings/__tests__/store.test.ts apps/desktop/src/renderer/store/__tests__/keybindings.test.ts
git commit -m "Let the settings and keybinding stores unload for a user switch"
```

---

### Task 8: Per-user boot cache and the settings session

**Files:**
- Modify: `apps/desktop/src/renderer/settings/migration.ts`
- Modify: `apps/desktop/src/renderer/settings/index.ts`
- Create: `apps/desktop/src/renderer/settings/session.ts`
- Modify: `apps/desktop/src/renderer/settings/boot.ts`
- Test: `apps/desktop/src/renderer/settings/__tests__/migration.test.ts` (append)
- Test: `apps/desktop/src/renderer/settings/__tests__/session.test.ts`

- [ ] **Step 1: Append the failing cache-adoption test**

In `migration.test.ts`, change the import to
`import { adoptLegacyCache, clearLegacySettings, readLegacySettings } from '../migration';`
and append:

```ts
describe('adoptLegacyCache', () => {
  function fullStorage(entries: Record<string, string>) {
    const map = new Map(Object.entries(entries));
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    };
  }

  it('hands the shared boot cache to the first user, once', () => {
    const s = fullStorage({ 'cord-settings-cache': '{"a":1}' });
    adoptLegacyCache(s, 'u1');
    adoptLegacyCache(s, 'u2');
    expect(Object.fromEntries(s.map)).toEqual({ 'cord-settings-cache:u1': '{"a":1}' });
  });

  it('never overwrites a user’s own cache', () => {
    const s = fullStorage({ 'cord-settings-cache': '{"a":1}', 'cord-settings-cache:u1': '{"a":2}' });
    adoptLegacyCache(s, 'u1');
    expect(Object.fromEntries(s.map)).toEqual({ 'cord-settings-cache:u1': '{"a":2}' });
  });
});
```

- [ ] **Step 2: Write the failing session test**

Create `apps/desktop/src/renderer/settings/__tests__/session.test.ts`:

```ts
import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Each user has their own settings files and boot cache. A user switch must
// never write one user's pending edit into another user's file, and the lock
// screen paints the chosen user's look from their cache without reading files.

const cache = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => cache.get(k) ?? null,
    setItem: (k: string, v: string) => { cache.set(k, v); },
    removeItem: (k: string) => { cache.delete(k); },
  },
});

/** The sidecar's side: one set of files per signed-in user. */
const files = new Map<string, string>();
let signedIn = 'u1';
mock.module('@renderer/ipc', () => ({
  api: {
    settings: {
      read: async (file: string) => ({ text: files.get(`${signedIn}/${file}`) ?? null }),
      write: async (file: string, text: string) => { files.set(`${signedIn}/${file}`, text); return { ok: true }; },
    },
  },
}));

const { registerSetting, settingDefinition, setSetting, getSetting } = await import('../index');
const { loadUserSettings, previewUserSettings, flushUserSettings, hasActiveSettingsUser } = await import('../session');

// Test files share one module registry, and theme.test.ts may have registered it already.
if (!settingDefinition('appearance.theme')) {
  registerSetting({
    key: 'appearance.theme', type: 'string', title: '', description: '', section: 'Appearance',
    default: 'mono', pattern: /^[a-z0-9-]+$/,
  });
}

beforeEach(async () => {
  await previewUserSettings(null);
  cache.clear();
  files.clear();
});

describe('per-user settings', () => {
  it('loads the signed-in user’s own file', async () => {
    files.set('u1/settings', '{"appearance.theme": "teal"}');
    files.set('u2/settings', '{"appearance.theme": "olive"}');
    signedIn = 'u2';
    await loadUserSettings('u2');
    expect(getSetting('appearance.theme')).toBe('olive');
    expect(hasActiveSettingsUser()).toBe(true);
  });

  it('writes a pending edit to the user who made it', async () => {
    signedIn = 'u1';
    await loadUserSettings('u1');
    setSetting('appearance.theme', 'teal');
    await flushUserSettings(); // what lock() does before the session ends
    expect(files.get('u1/settings')).toContain('teal');
    expect(hasActiveSettingsUser()).toBe(false);
  });

  it('refreshes the user’s boot cache from their file', async () => {
    files.set('u1/settings', '{"appearance.theme": "teal"}');
    signedIn = 'u1';
    await loadUserSettings('u1');
    expect(cache.get('cord-settings-cache:u1')).toContain('teal');
  });

  it('previews a user from their boot cache, defaults when there is none', async () => {
    cache.set('cord-settings-cache:u2', '{"appearance.theme":"olive"}');
    await previewUserSettings('u2');
    expect(getSetting('appearance.theme')).toBe('olive');
    await previewUserSettings('u3');
    expect(getSetting('appearance.theme')).toBe('mono');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/settings/__tests__/migration.test.ts src/renderer/settings/__tests__/session.test.ts`
Expected: FAIL — `adoptLegacyCache` not exported; `../session` not found.

- [ ] **Step 4: Add the cache helpers to `migration.ts`**

Append to `apps/desktop/src/renderer/settings/migration.ts`:

```ts
/** Before PINs there was one boot cache for everybody. */
export const LEGACY_CACHE_KEY = 'cord-settings-cache';

export function userCacheKey(userId: string): string {
  return `${LEGACY_CACHE_KEY}:${userId}`;
}

/** Hand the shared boot cache to the first user whose cache is looked up, then drop it. */
export function adoptLegacyCache(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  userId: string,
): void {
  const legacy = storage.getItem(LEGACY_CACHE_KEY);
  if (legacy === null) return;
  if (storage.getItem(userCacheKey(userId)) === null) storage.setItem(userCacheKey(userId), legacy);
  storage.removeItem(LEGACY_CACHE_KEY);
}
```

- [ ] **Step 5: Make the boot cache per user in `settings/index.ts`**

Replace the `migration` import with:

```ts
import { adoptLegacyCache, clearLegacySettings, readLegacySettings, userCacheKey } from './migration';
```

Delete `const CACHE_KEY = 'cord-settings-cache';` and add in its place:

```ts
/** Remembers whose cache painted the last frame, so the next launch paints it before the sidecar answers. */
const CACHE_USER_KEY = 'cord-settings-cache-user';

/** Whose boot cache `useSettings` reads and writes. Null when nobody is chosen. */
let cacheUserId: string | null = null;

/** Point the boot cache at `userId`. Call before the store is touched on a user switch. */
export function setSettingsCacheUser(userId: string | null): void {
  cacheUserId = userId;
  if (!userId) return;
  try {
    localStorage.setItem(CACHE_USER_KEY, userId);
    adoptLegacyCache(localStorage, userId);
  } catch {
    // Storage blocked: the lock screen paints defaults until unlock.
  }
}

export function lastCacheUser(): string | null {
  try {
    return localStorage.getItem(CACHE_USER_KEY);
  } catch {
    return null;
  }
}
```

and change the `cache` entry of `createSettingsStore({ … })` to:

```ts
  cache: {
    read: () => (cacheUserId ? localStorage.getItem(userCacheKey(cacheUserId)) : null),
    write: (text) => { if (cacheUserId) localStorage.setItem(userCacheKey(cacheUserId), text); },
  },
```

(The store already wraps both calls in `try`.)

- [ ] **Step 6: Create `settings/session.ts`**

```ts
import { flushKeybindings, unloadKeybindings, useKeybindingStore } from '../store/keybindings';
import { setSettingsCacheUser, useSettings } from './index';

/**
 * Which user's settings the app is showing. Files are read only for a
 * signed-in user; the lock screen shows a user's boot cache instead.
 */

let activeUserId: string | null = null;

/** True while a signed-in user's files are loaded. Reloading before that is refused by the sidecar. */
export function hasActiveSettingsUser(): boolean {
  return activeUserId !== null;
}

/** Lock screen: show `userId`'s last-known look from their boot cache. Reads no files. */
export async function previewUserSettings(userId: string | null): Promise<void> {
  await release();
  setSettingsCacheUser(userId);
  useSettings.getState().applyBootCache();
}

/** After unlock: read the user's settings.json and keybindings.json. */
export async function loadUserSettings(userId: string): Promise<void> {
  await previewUserSettings(userId);
  activeUserId = userId;
  await Promise.all([useSettings.getState().load(), useKeybindingStore.getState().load()]);
}

/** Before the session ends: write anything pending into this user's files, and stop reading them. */
export async function flushUserSettings(): Promise<void> {
  activeUserId = null;
  await Promise.all([useSettings.getState().flush(), flushKeybindings()]);
}

async function release(): Promise<void> {
  activeUserId = null;
  await Promise.all([useSettings.getState().unload(), unloadKeybindings()]);
}
```

- [ ] **Step 7: Stop reading files at boot**

Replace `apps/desktop/src/renderer/settings/boot.ts`:

```ts
import { useKeybindingStore } from '../store/keybindings';
import { useThemeStore } from '../store/theme';
import { lastCacheUser, setSettingsCacheUser, useSettings } from './index';
import { hasActiveSettingsUser } from './session';

/**
 * Startup. Settings belong to a user, so no file is read until someone
 * unlocks (settings/session.ts). The first frame is painted from the boot
 * cache of whoever was shown last, so the lock screen opens in their theme.
 * Once unlocked, the files are re-read whenever the window regains focus,
 * since there is no filesystem watcher and the user may have edited them in
 * another editor.
 */
export function bootSettings(): void {
  setSettingsCacheUser(lastCacheUser());
  useSettings.getState().applyBootCache();
  useThemeStore.getState().init();

  window.addEventListener('focus', () => {
    if (!hasActiveSettingsUser()) return;
    void useSettings.getState().reload();
    void useKeybindingStore.getState().reload();
  });
}
```

- [ ] **Step 8: Run the renderer tests**

Run: `CORD_DB_PATH=:memory: bun test src/renderer`
Expected: PASS, including the 6 new tests.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/settings
git commit -m "Load, preview and flush settings per user"
```

---

### Task 9: The auth store

**Files:**
- Rewrite: `apps/desktop/src/renderer/store/auth.ts`
- Delete: `apps/desktop/src/renderer/store/authStore.ts` (an unused second `useAuthStore`; nothing imports it)
- Test: `apps/desktop/src/renderer/store/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/renderer/store/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, mock, spyOn } from 'bun:test';
import type { AuthUser, LockScreenState, PinUnlockResult } from '@shared/types';
import * as session from '../../settings/session';

// The lock screen is a small state machine: which user is chosen, which view
// shows, and when the workspace opens. Settings are swapped per user, and a
// user's pending edits are flushed before their session ends.

const calls: string[] = [];
const alice: AuthUser = { id: 'a', username: 'alice', createdAt: 1, hasPin: true, hasRecoveryKey: true };
let lockScreen: LockScreenState;
let unlockResult: PinUnlockResult;
let current: AuthUser | null;

mock.module('@renderer/ipc', () => ({
  api: {
    auth: {
      current: async () => current,
      lockScreen: async () => lockScreen,
      unlockPin: async () => { calls.push('unlockPin'); return unlockResult; },
      login: async () => { calls.push('login'); return alice; },
      register: async () => ({ ...alice, id: 'n', username: 'new', hasPin: false, hasRecoveryKey: false }),
      setPin: async () => { calls.push('setPin'); return { ...alice, id: 'n', username: 'new', hasRecoveryKey: false }; },
      issueRecoveryKey: async () => ({ recoveryKey: 'KEY' }),
      recover: async () => ({ ...alice, hasPin: false, hasRecoveryKey: false }),
      lock: async () => { calls.push('lock'); return { ok: true }; },
    },
  },
}));

// Spies, not mock.module: a module mock leaks into every later test file in
// the run (Bun 1.3), which would replace the real session in session.test.ts.
const spies = [
  spyOn(session, 'previewUserSettings').mockImplementation(async (id) => { calls.push(`preview:${id}`); }),
  spyOn(session, 'loadUserSettings').mockImplementation(async (id) => { calls.push(`load:${id}`); }),
  spyOn(session, 'flushUserSettings').mockImplementation(async () => { calls.push('flush'); }),
];
afterAll(() => { for (const spy of spies) spy.mockRestore(); });

const { useAuthStore } = await import('../auth');

function lockScreenWith(users: LockScreenState['users'], lastUserId: string | null): LockScreenState {
  return { users, lastUserId };
}

beforeEach(() => {
  calls.length = 0;
  current = null;
  lockScreen = lockScreenWith(
    [
      { id: 'a', username: 'alice', hasPin: true, pinLocked: false },
      { id: 'b', username: 'bob', hasPin: false, pinLocked: false },
    ],
    'a',
  );
  useAuthStore.setState({ user: null, pendingUser: null, recoveryKey: null, notice: null, checking: true });
});

describe('auth store', () => {
  it('preselects the last user and asks for their PIN', async () => {
    await useAuthStore.getState().check();
    expect(useAuthStore.getState()).toMatchObject({ checking: false, selectedUserId: 'a', view: 'pin' });
    expect(calls).toEqual(['preview:a']);
  });

  it('asks for the password when the user has no PIN, and registration when nobody exists', async () => {
    await useAuthStore.getState().check();
    await useAuthStore.getState().selectUser('b');
    expect(useAuthStore.getState().view).toBe('password');

    lockScreen = lockScreenWith([], null);
    await useAuthStore.getState().check();
    expect(useAuthStore.getState()).toMatchObject({ selectedUserId: null, view: 'register' });
  });

  it('opens the workspace after the right PIN', async () => {
    await useAuthStore.getState().check();
    unlockResult = { ok: true, user: alice };
    await useAuthStore.getState().unlockWithPin('1234');
    expect(useAuthStore.getState().user).toEqual(alice);
    expect(calls).toContain('load:a');
  });

  it('moves to the password after the last wrong PIN', async () => {
    await useAuthStore.getState().check();
    unlockResult = { ok: false, triesLeft: 2 };
    expect(await useAuthStore.getState().unlockWithPin('0000')).toEqual({ ok: false, triesLeft: 2 });
    expect(useAuthStore.getState().view).toBe('pin');

    unlockResult = { ok: false, triesLeft: 0 };
    await useAuthStore.getState().unlockWithPin('0000');
    expect(useAuthStore.getState()).toMatchObject({ view: 'password', user: null });
    expect(useAuthStore.getState().notice).toContain('Too many wrong PINs');
  });

  it('walks a new user through PIN and recovery key before the workspace', async () => {
    await useAuthStore.getState().check();
    await useAuthStore.getState().register('new', 'password');
    expect(useAuthStore.getState()).toMatchObject({ view: 'setPin', user: null });

    await useAuthStore.getState().setPin('1234');
    expect(useAuthStore.getState()).toMatchObject({ view: 'recoveryKey', recoveryKey: 'KEY', user: null });

    await useAuthStore.getState().finishSetup();
    expect(useAuthStore.getState()).toMatchObject({ recoveryKey: null, user: { id: 'n' } });
    expect(calls).toContain('load:n');
  });

  it('continues setup with a new PIN after a recovery-key reset', async () => {
    await useAuthStore.getState().check();
    await useAuthStore.getState().recover('alice', 'KEY', 'new password');
    expect(useAuthStore.getState()).toMatchObject({ view: 'setPin', user: null });
  });

  it('flushes settings before locking, then returns to the same user’s PIN', async () => {
    await useAuthStore.getState().check();
    unlockResult = { ok: true, user: alice };
    await useAuthStore.getState().unlockWithPin('1234');
    calls.length = 0;

    await useAuthStore.getState().lock();

    expect(calls.slice(0, 2)).toEqual(['flush', 'lock']);
    expect(useAuthStore.getState()).toMatchObject({ user: null, selectedUserId: 'a', view: 'pin' });
  });

  it('resumes an existing session (webview reload during development)', async () => {
    current = alice;
    await useAuthStore.getState().check();
    expect(useAuthStore.getState().user).toEqual(alice);
    expect(calls).toContain('load:a');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/store/__tests__/auth.test.ts`
Expected: FAIL — `selectUser` / `unlockWithPin` are not functions.

- [ ] **Step 3: Rewrite the store**

Replace `apps/desktop/src/renderer/store/auth.ts`:

```ts
import { create } from 'zustand';
import type { AuthUser, LockScreenState, PinUnlockResult } from '@shared/types';
import { api } from '@renderer/ipc';
import { log } from '../lib/log';
import { flushUserSettings, loadUserSettings, previewUserSettings } from '../settings/session';
import { useVaultStore } from './vaults';
import { useNoteStore } from './notes';
import { useTagStore } from './tags';
import { useUIStore } from './ui';

/**
 * What the lock screen shows. `setPin` and `recoveryKey` are setup steps
 * taken after signing in and before the workspace opens.
 */
export type AuthView = 'pin' | 'password' | 'forgotPin' | 'register' | 'recover' | 'setPin' | 'recoveryKey';

interface AuthState {
  /** Signed in and set up: the workspace is showing. */
  user: AuthUser | null;
  checking: boolean;
  lockScreen: LockScreenState;
  selectedUserId: string | null;
  view: AuthView;
  /** Signed in, still finishing setup. */
  pendingUser: AuthUser | null;
  /** Shown once on the recovery-key step, then dropped. */
  recoveryKey: string | null;
  /** Why the view changed on its own, e.g. after too many wrong PINs. */
  notice: string | null;

  check: () => Promise<void>;
  selectUser: (userId: string | null) => Promise<void>;
  setView: (view: AuthView) => void;
  unlockWithPin: (pin: string) => Promise<PinUnlockResult>;
  login: (username: string, password: string) => Promise<void>;
  /** Forgot PIN: prove it with the password and choose a new PIN in one go. */
  forgotPin: (username: string, password: string, pin: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  recover: (username: string, recoveryKey: string, newPassword: string) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  finishSetup: () => Promise<void>;
  lock: () => Promise<void>;
}

const EMPTY_LOCK_SCREEN: LockScreenState = { users: [], lastUserId: null };

/** The view a chosen user starts on. */
function entryView(lockScreen: LockScreenState, userId: string | null): AuthView {
  const user = lockScreen.users.find((u) => u.id === userId);
  if (!user) return 'register';
  return user.hasPin && !user.pinLocked ? 'pin' : 'password';
}

export const useAuthStore = create<AuthState>((set, get) => {
  /** Signed in: finish any setup step still owed, then open the workspace. */
  async function signedIn(user: AuthUser): Promise<void> {
    if (!user.hasPin) {
      set({ pendingUser: user, view: 'setPin', notice: null });
      return;
    }
    if (!user.hasRecoveryKey) {
      const { recoveryKey } = await api.auth.issueRecoveryKey({});
      set({ pendingUser: { ...user, hasRecoveryKey: true }, recoveryKey, view: 'recoveryKey', notice: null });
      return;
    }
    await loadUserSettings(user.id);
    set({ user, pendingUser: null, recoveryKey: null, notice: null });
  }

  return {
    user:           null,
    checking:       true,
    lockScreen:     EMPTY_LOCK_SCREEN,
    selectedUserId: null,
    view:           'register',
    pendingUser:    null,
    recoveryKey:    null,
    notice:         null,

    check: async () => {
      try {
        const [current, lockScreen] = await Promise.all([api.auth.current(), api.auth.lockScreen()]);
        set({ lockScreen });
        if (current) {
          set({ selectedUserId: current.id });
          await signedIn(current);
        } else {
          await get().selectUser(lockScreen.lastUserId ?? lockScreen.users[0]?.id ?? null);
        }
      } catch (err) {
        log('error', 'auth', 'Could not load the lock screen', err);
      } finally {
        set({ checking: false });
      }
    },

    selectUser: async (userId) => {
      set({ selectedUserId: userId, view: entryView(get().lockScreen, userId), notice: null });
      await previewUserSettings(userId);
    },

    setView: (view) => set({ view, notice: null }),

    unlockWithPin: async (pin) => {
      const userId = get().selectedUserId;
      if (!userId) throw new Error('Choose a user first');
      const result = await api.auth.unlockPin({ userId, pin });
      if (result.ok) {
        await signedIn(result.user);
      } else if (result.triesLeft === 0) {
        set({
          lockScreen: await api.auth.lockScreen(),
          view: 'password',
          notice: 'Too many wrong PINs. Enter your password.',
        });
      }
      return result;
    },

    login: async (username, password) => {
      await signedIn(await api.auth.login({ username, password }));
    },

    forgotPin: async (username, password, pin) => {
      await api.auth.login({ username, password });
      await signedIn(await api.auth.setPin({ pin, password }));
    },

    register: async (username, password) => {
      await signedIn(await api.auth.register({ username, password }));
    },

    recover: async (username, recoveryKey, newPassword) => {
      await signedIn(await api.auth.recover({ username, recoveryKey, newPassword }));
    },

    setPin: async (pin) => {
      await signedIn(await api.auth.setPin({ pin }));
    },

    finishSetup: async () => {
      const pending = get().pendingUser;
      if (pending) await signedIn(pending);
    },

    lock: async () => {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // Pending settings edits go to this user's files before the session ends.
      await flushUserSettings();
      await api.auth.lock();
      useVaultStore.getState().reset();
      useNoteStore.getState().reset();
      useTagStore.getState().reset();
      useUIStore.getState().closeCommands();

      const lockScreen = await api.auth.lockScreen();
      set({ user: null, pendingUser: null, recoveryKey: null, lockScreen });
      await get().selectUser(lockScreen.lastUserId ?? lockScreen.users[0]?.id ?? null);
    },
  };
});
```

- [ ] **Step 4: Delete the unused duplicate store**

First confirm nothing imports it:

Run: `grep -rn "store/authStore" src`
Expected: no output.

```bash
git rm apps/desktop/src/renderer/store/authStore.ts
```

- [ ] **Step 5: Run the tests**

Run: `CORD_DB_PATH=:memory: bun test src/renderer/store/__tests__/auth.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/store
git commit -m "Drive the lock screen from the auth store"
```

---

### Task 10: The lock screen

UI only; verified by running the app in Task 13.

**Files:**
- Rewrite: `apps/desktop/src/renderer/components/LoginScreen.tsx`
- Modify: `apps/desktop/src/renderer/components/LoginScreen.module.css`
- Create: `apps/desktop/src/renderer/components/login/shared.tsx`
- Create: `apps/desktop/src/renderer/components/login/PinView.tsx`, `PasswordView.tsx`, `ForgotPinView.tsx`, `RegisterView.tsx`, `RecoverView.tsx`, `SetPinView.tsx`, `RecoveryKeyView.tsx`

- [ ] **Step 1: Shared pieces — `login/shared.tsx`**

```tsx
import { useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { LockScreenUser } from '@shared/types';
import { useAuthStore } from '../../store/auth';
import styles from '../LoginScreen.module.css';

export const isPin = (s: string): boolean => /^\d{4,6}$/.test(s);

/** Runs a form action with a loading flag and a readable error. */
export function useSubmit(action: () => Promise<void>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await action();
    } catch (err: unknown) {
      // Tauri rejects with the sidecar's message as a plain string.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, setError, onSubmit };
}

export function useSelectedUser(): LockScreenUser | null {
  return useAuthStore((s) => s.lockScreen.users.find((u) => u.id === s.selectedUserId) ?? null);
}

/** Collapses rather than unmounting, so it keeps the last message while it animates shut. */
export function ErrorPanel({ error }: { error: string }) {
  const last = useRef('');
  if (error) last.current = error;
  return (
    <div className={`${styles.collapsible} ${error ? styles.collapsibleOpen : ''}`}>
      <div className={styles.collapsibleInner}>
        <div className={styles.error} role="alert">{error || last.current}</div>
      </div>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function PasswordField(props: FieldProps & { autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={props.id}>{props.label}</label>
      <div className={styles.passwordRow}>
        <input
          id={props.id}
          className={styles.input}
          type={show ? 'text' : 'password'}
          autoComplete={props.autoComplete}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          required
        />
        <button
          type="button"
          className={styles.showPwBtn}
          onClick={() => setShow((v) => !v)}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}

/** Masked, digits only, at most 6. `inputMode` brings up a number pad on touch screens. */
export function PinField(props: FieldProps) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className={`${styles.input} ${styles.pinInput} cord-login__pin`}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        required
      />
    </div>
  );
}

export function TextField(props: FieldProps & { autoComplete: string; placeholder?: string; mono?: boolean }) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className={`${styles.input} ${props.mono ? styles.mono : ''}`}
        type="text"
        spellCheck={false}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        required
      />
    </div>
  );
}

/** Which user is unlocking. A native select: keyboard and screen-reader friendly for free. */
export function UserPicker({ disabled }: { disabled?: boolean }) {
  const users = useAuthStore((s) => s.lockScreen.users);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const selectUser = useAuthStore((s) => s.selectUser);
  if (users.length === 0) return null;
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor="auth-user">User</label>
      <select
        id="auth-user"
        className={`${styles.input} ${styles.userSelect} cord-login__user-picker`}
        value={selectedUserId ?? ''}
        onChange={(e) => void selectUser(e.target.value)}
        disabled={disabled}
      >
        {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
      </select>
    </div>
  );
}

export function LinkRow({ links }: { links: { label: string; onClick: () => void }[] }) {
  return (
    <div className={`${styles.links} cord-login__links`}>
      {links.map((l) => (
        <button key={l.label} type="button" className={styles.linkBtn} onClick={l.onClick}>{l.label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `login/PinView.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PinField, UserPicker, isPin, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function PinView() {
  const unlockWithPin = useAuthStore((s) => s.unlockWithPin);
  const setView = useAuthStore((s) => s.setView);
  const [pin, setPin] = useState('');

  const { loading, error, setError, onSubmit } = useSubmit(async () => {
    const result = await unlockWithPin(pin);
    if (result.ok) return;
    setPin('');
    // At zero the store has already switched to the password view.
    if (result.triesLeft > 0) {
      setError(`Wrong PIN — ${result.triesLeft} ${result.triesLeft === 1 ? 'try' : 'tries'} left.`);
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <UserPicker disabled={loading} />
      <PinField id="auth-pin" label="PIN" value={pin} onChange={setPin} disabled={loading} autoFocus />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !isPin(pin)}>
        {loading ? 'Unlocking…' : 'Unlock'}
      </button>
      <LinkRow links={[
        { label: 'Use password', onClick: () => setView('password') },
        { label: 'Forgot PIN?', onClick: () => setView('forgotPin') },
        { label: 'New user', onClick: () => setView('register') },
      ]} />
    </form>
  );
}
```

- [ ] **Step 3: `login/PasswordView.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PasswordField, UserPicker, useSelectedUser, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function PasswordView() {
  const login = useAuthStore((s) => s.login);
  const setView = useAuthStore((s) => s.setView);
  const notice = useAuthStore((s) => s.notice);
  const user = useSelectedUser();
  const [password, setPassword] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (user) await login(user.username, password);
  });

  const canUsePin = !!user?.hasPin && !user.pinLocked;

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <UserPicker disabled={loading} />
      <PasswordField
        id="auth-password" label="Password" value={password} onChange={setPassword}
        autoComplete="current-password" disabled={loading} autoFocus
      />
      <ErrorPanel error={error || notice || ''} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !user || !password}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
      <LinkRow links={[
        ...(canUsePin ? [{ label: 'Use PIN', onClick: () => setView('pin') }] : []),
        { label: 'Forgot password?', onClick: () => setView('recover') },
        { label: 'New user', onClick: () => setView('register') },
      ]} />
    </form>
  );
}
```

- [ ] **Step 4: `login/ForgotPinView.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PasswordField, PinField, UserPicker, isPin, useSelectedUser, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function ForgotPinView() {
  const forgotPin = useAuthStore((s) => s.forgotPin);
  const setView = useAuthStore((s) => s.setView);
  const user = useSelectedUser();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (pin !== confirm) throw new Error('PINs do not match.');
    if (user) await forgotPin(user.username, password, pin);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <UserPicker disabled={loading} />
      <PasswordField
        id="auth-password" label="Password" value={password} onChange={setPassword}
        autoComplete="current-password" disabled={loading} autoFocus
      />
      <PinField id="auth-new-pin" label="New PIN" value={pin} onChange={setPin} disabled={loading} />
      <PinField id="auth-confirm-pin" label="Repeat PIN" value={confirm} onChange={setConfirm} disabled={loading} />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !user || !password || !isPin(pin) || !confirm}>
        {loading ? 'Saving…' : 'Set new PIN'}
      </button>
      <LinkRow links={[
        { label: 'Back', onClick: () => setView('pin') },
        { label: 'Forgot password?', onClick: () => setView('recover') },
      ]} />
    </form>
  );
}
```

- [ ] **Step 5: `login/RegisterView.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PasswordField, TextField, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function RegisterView() {
  const register = useAuthStore((s) => s.register);
  const selectUser = useAuthStore((s) => s.selectUser);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const hasUsers = useAuthStore((s) => s.lockScreen.users.length > 0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Passwords do not match.');
    await register(username, password);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <TextField
        id="auth-username" label="Username" value={username} onChange={setUsername}
        autoComplete="off" placeholder="e.g. alice" disabled={loading} autoFocus
      />
      <PasswordField
        id="auth-password" label="Password" value={password} onChange={setPassword}
        autoComplete="new-password" placeholder="You’ll need it to change your PIN" disabled={loading}
      />
      <PasswordField
        id="auth-confirm" label="Repeat password" value={confirm} onChange={setConfirm}
        autoComplete="new-password" disabled={loading}
      />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !username || !password || !confirm}>
        {loading ? 'Creating account…' : 'Create account'}
      </button>
      {hasUsers && (
        <LinkRow links={[{ label: 'Back to sign in', onClick: () => void selectUser(selectedUserId) }]} />
      )}
    </form>
  );
}
```

- [ ] **Step 6: `login/RecoverView.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, LinkRow, PasswordField, TextField, useSelectedUser, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function RecoverView() {
  const recover = useAuthStore((s) => s.recover);
  const setView = useAuthStore((s) => s.setView);
  const selected = useSelectedUser();
  const [username, setUsername] = useState(selected?.username ?? '');
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Passwords do not match.');
    await recover(username, key, password);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <TextField
        id="auth-username" label="Username" value={username} onChange={setUsername}
        autoComplete="username" disabled={loading}
      />
      <TextField
        id="auth-recovery-key" label="Recovery key" value={key} onChange={setKey}
        autoComplete="off" placeholder="XXXX-XXXX-…" mono disabled={loading} autoFocus
      />
      <PasswordField
        id="auth-password" label="New password" value={password} onChange={setPassword}
        autoComplete="new-password" disabled={loading}
      />
      <PasswordField
        id="auth-confirm" label="Repeat password" value={confirm} onChange={setConfirm}
        autoComplete="new-password" disabled={loading}
      />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !username || !key || !password || !confirm}>
        {loading ? 'Checking…' : 'Reset password'}
      </button>
      <LinkRow links={[{ label: 'Back', onClick: () => setView('password') }]} />
    </form>
  );
}
```

- [ ] **Step 7: `login/SetPinView.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, PinField, isPin, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

/** A setup step: no way around it except closing Cord, which leaves the user PIN-less for next time. */
export function SetPinView() {
  const setPin = useAuthStore((s) => s.setPin);
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');

  const { loading, error, onSubmit } = useSubmit(async () => {
    if (pin !== confirm) throw new Error('PINs do not match.');
    await setPin(pin);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <PinField id="auth-new-pin" label="PIN" value={pin} onChange={setPinValue} disabled={loading} autoFocus />
      <PinField id="auth-confirm-pin" label="Repeat PIN" value={confirm} onChange={setConfirm} disabled={loading} />
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !isPin(pin) || !confirm}>
        {loading ? 'Saving…' : 'Set PIN'}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: `login/RecoveryKeyView.tsx`**

```tsx
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { ErrorPanel, useSubmit } from './shared';
import styles from '../LoginScreen.module.css';

export function RecoveryKeyView() {
  const recoveryKey = useAuthStore((s) => s.recoveryKey) ?? '';
  const finishSetup = useAuthStore((s) => s.finishSetup);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const { loading, error, onSubmit } = useSubmit(finishSetup);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={`${styles.keyBox} cord-login__recovery-key`}>
        <code>{recoveryKey}</code>
        <button type="button" className={styles.showPwBtn} onClick={() => void copy()} aria-label="Copy recovery key">
          {copied ? <Check size={15} strokeWidth={1.75} /> : <Copy size={15} strokeWidth={1.75} />}
        </button>
      </div>
      <p className={styles.hint}>
        Write it down or keep it in a password manager. It is shown only now. Without it, a forgotten password can’t be reset.
      </p>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I’ve saved my recovery key
      </label>
      <ErrorPanel error={error} />
      <button type="submit" className={styles.submitBtn} disabled={loading || !saved}>
        {loading ? 'Opening…' : 'Continue'}
      </button>
    </form>
  );
}
```

- [ ] **Step 9: Rewrite `LoginScreen.tsx`**

```tsx
import type { ComponentType } from 'react';
import AppIcon from './icons/AppIcon';
import { useAuthStore, type AuthView } from '../store/auth';
import { PinView } from './login/PinView';
import { PasswordView } from './login/PasswordView';
import { ForgotPinView } from './login/ForgotPinView';
import { RegisterView } from './login/RegisterView';
import { RecoverView } from './login/RecoverView';
import { SetPinView } from './login/SetPinView';
import { RecoveryKeyView } from './login/RecoveryKeyView';
import styles from './LoginScreen.module.css';

const COPY: Record<AuthView, { title: string; subtitle: string }> = {
  pin:         { title: 'Welcome back',           subtitle: 'Enter your PIN to open Cord' },
  password:    { title: 'Welcome back',           subtitle: 'Enter your password' },
  forgotPin:   { title: 'Choose a new PIN',       subtitle: 'Confirm it’s you with your password' },
  register:    { title: 'Create your account',    subtitle: 'The password protects account changes; a PIN unlocks Cord day to day' },
  recover:     { title: 'Reset your password',    subtitle: 'Use the recovery key you saved when you set up Cord' },
  setPin:      { title: 'Choose a PIN',           subtitle: '4 to 6 digits. You’ll use it to unlock Cord.' },
  recoveryKey: { title: 'Save your recovery key', subtitle: 'It’s the only way back in if you forget your password' },
};

const VIEWS: Record<AuthView, ComponentType> = {
  pin: PinView,
  password: PasswordView,
  forgotPin: ForgotPinView,
  register: RegisterView,
  recover: RecoverView,
  setPin: SetPinView,
  recoveryKey: RecoveryKeyView,
};

export default function LoginScreen() {
  const view = useAuthStore((s) => s.view);
  const selectedUserId = useAuthStore((s) => s.selectedUserId);
  const { title, subtitle } = COPY[view];
  const View = VIEWS[view];

  return (
    <div className={`${styles.screen} cord-login`}>
      <div className={`${styles.card} cord-login__card`}>
        <div className={styles.logoRow}>
          <AppIcon size={22} className={styles.logoIcon} />
          <span className={styles.logoName}>Cord</span>
        </div>

        {/* Keyed so the copy crossfades on view change instead of snapping. */}
        <h1 key={`h-${view}`} className={styles.heading}>{title}</h1>
        <p key={`s-${view}`} className={styles.subheading}>{subtitle}</p>

        {/* Keyed by user too, so switching user clears what was typed. */}
        <View key={`${view}-${selectedUserId ?? ''}`} />

        <p className={styles.disclaimer}>
          Notes are stored only on this device. The PIN keeps other people out of Cord; it does not encrypt your files.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Add the CSS**

Append to `LoginScreen.module.css`, before the `@media (prefers-reduced-motion …)` block:

```css
/* ── Lock screen additions ───────────────────────────────────────────────── */

.pinInput {
  font-size: var(--text-lg);
  letter-spacing: 0.4em;
  text-align: center;
}

.userSelect {
  appearance: none;
  cursor: pointer;
}

.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.04em;
}

.links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-1) var(--space-3);
}

.linkBtn {
  background: none;
  border: none;
  padding: var(--space-1);
  font: inherit;
  font-size: var(--text-sm);
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius);
}

.linkBtn:hover { color: var(--text-primary); }
.linkBtn:focus-visible { outline: 1.5px solid var(--accent); }

.keyBox {
  position: relative;
  padding: var(--space-3);
  padding-right: calc(var(--space-3) + 28px);
  background: var(--bg-input);
  border-radius: var(--radius);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-base);
  line-height: 1.6;
  word-break: break-all;
  user-select: all;
}

.hint {
  font-size: var(--text-sm);
  color: var(--text-muted);
  line-height: 1.5;
}

.checkRow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-md);
  color: var(--text-primary);
  cursor: pointer;
}
```

If `--text-lg` or `--space-1` is not defined, grep `styles/global.css` for the nearest existing token and use it — never add a raw colour.

- [ ] **Step 11: Run the tests**

Run: `CORD_DB_PATH=:memory: bun test src`
Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src/renderer/components/LoginScreen.tsx apps/desktop/src/renderer/components/LoginScreen.module.css apps/desktop/src/renderer/components/login
git commit -m "Replace the sign-in form with a PIN lock screen"
```

---

### Task 11: Lock instead of Log out, and the idle lock

**Files:**
- Modify: `apps/desktop/src/renderer/components/TitleBar.tsx`
- Modify: `apps/desktop/src/renderer/components/VaultSidebar.tsx`
- Modify: `apps/desktop/src/renderer/settings/builtin.ts`
- Create: `apps/desktop/src/renderer/hooks/useIdleLock.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: TitleBar**

In `TitleBar.tsx`:
- In the `lucide-react` import, replace `LogOut` with `Lock` (if `Lock` is already imported, just remove `LogOut`).
- Replace the command at line 67 with
  `{ id: 'lock',        label: 'Lock',                                    icon: Lock,          group: 'Account'    },`
- Replace `const { logout }    = useAuthStore();` with `const lock = useAuthStore((s) => s.lock);`
- Replace `case 'logout':       if (confirm('Log out?')) await logout(); break;` with
  `case 'lock':         await lock(); break;` (locking loses nothing, so no confirm).
- In that `useCallback` dependency list, replace `logout` with `lock`.

- [ ] **Step 2: VaultSidebar**

In `VaultSidebar.tsx`:
- In the `lucide-react` import, replace `LogOut` with `Lock`.
- Replace `const { user, logout } = useAuthStore();` with
  `const user = useAuthStore((s) => s.user);` and `const lock = useAuthStore((s) => s.lock);`
- Replace `handleLogout` with:

```tsx
  async function handleLock() {
    await lock();
  }
```

- In the user row, change the button to
  `onClick={(e) => { e.stopPropagation(); void handleLock(); }} title="Lock"` and `<LogOut …/>` to `<Lock size={14} strokeWidth={1.75} />`. Update the nearby comment's "logout control" to "lock control". Leave the `styles.logoutBtn` class name alone (renaming it touches CSS for nothing).

- [ ] **Step 3: The idle-lock setting**

In `settings/builtin.ts`, add `'security.idleLockMinutes': number;` to the `SettingValues` augmentation, and after the `vaults.distinctColors` registration add:

```ts
registerSetting({
  key: 'security.idleLockMinutes', type: 'number', section: 'Security', order: 10,
  title: 'Lock when idle',
  description: 'Return to the PIN screen after this many minutes without keyboard or mouse input. 0 turns it off.',
  default: 0, min: 0, max: 120, step: 5, unit: 'min', keywords: ['pin', 'lock', 'timeout', 'away'],
});
```

- [ ] **Step 4: The hook — `hooks/useIdleLock.ts`**

```ts
import { useEffect } from 'react';
import { useSetting } from '../settings';
import { useAuthStore } from '../store/auth';

const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;

/** Locks Cord after `security.idleLockMinutes` without input. 0 turns it off. */
export function useIdleLock(): void {
  const minutes = useSetting('security.idleLockMinutes');
  const signedIn = useAuthStore((s) => s.user !== null);

  useEffect(() => {
    if (!signedIn || minutes <= 0) return;
    const delay = minutes * 60_000;
    const fire = (): void => { void useAuthStore.getState().lock(); };
    let timer = setTimeout(fire, delay);
    const reset = (): void => {
      clearTimeout(timer);
      timer = setTimeout(fire, delay);
    };
    for (const e of ACTIVITY) window.addEventListener(e, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of ACTIVITY) window.removeEventListener(e, reset);
    };
  }, [signedIn, minutes]);
}
```

- [ ] **Step 5: Use it in `App.tsx`**

Add `import { useIdleLock } from './hooks/useIdleLock';` and call `useIdleLock();` on the line after `const { check, user, checking } = useAuthStore();`.

- [ ] **Step 6: Type-check and test**

Run: `bunx tsc --noEmit` (from `apps/desktop`)
Expected: no errors. The renderer type-checks again from here on.

Run: `CORD_DB_PATH=:memory: bun test src`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "Lock instead of logging out, and lock after idle time"
```

---

### Task 12: Account settings page

**Files:**
- Create: `apps/desktop/src/renderer/components/settings/AccountPage.tsx`
- Create: `apps/desktop/src/renderer/components/settings/AccountPage.module.css`
- Modify: `apps/desktop/src/renderer/components/settings/pages.ts`

- [ ] **Step 1: `AccountPage.module.css`**

Kept separate from `SettingsPage.module.css`, which the settings branch is editing.

```css
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 320px;
}

.key {
  font-family: var(--font-mono, ui-monospace, monospace);
  user-select: all;
  word-break: break-all;
}
```

- [ ] **Step 2: `AccountPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { api } from '../../ipc';
import styles from '../SettingsPage.module.css';
import own from './AccountPage.module.css';

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One small form: run `action`, show what happened. */
function useAction(action: () => Promise<string>) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      setStatus(await action());
    } catch (err) {
      setStatus(message(err));
    } finally {
      setBusy(false);
    }
  }
  return { status, busy, onSubmit };
}

function ChangePin() {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const { status, busy, onSubmit } = useAction(async () => {
    await api.auth.setPin({ pin, password });
    setPassword('');
    setPin('');
    return 'PIN changed.';
  });
  return (
    <form className={`${styles.field} cord-settings__field`} onSubmit={onSubmit}>
      <div className={styles.fieldLabel}>Change PIN</div>
      <div className={styles.fieldHint}>4 to 6 digits. Needs your password.</div>
      <div className={own.form}>
        <input className={styles.textInput} type="password" placeholder="Password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className={styles.textInput} type="password" inputMode="numeric" placeholder="New PIN" maxLength={6}
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <button type="submit" className={styles.secondaryBtn} disabled={busy || !password || !/^\d{4,6}$/.test(pin)}>
          Change PIN
        </button>
        {status && <div className={styles.fieldHint} role="status">{status}</div>}
      </div>
    </form>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const { status, busy, onSubmit } = useAction(async () => {
    if (next !== confirm) throw new Error('Passwords do not match.');
    await api.auth.changePassword({ currentPassword: current, newPassword: next });
    setCurrent('');
    setNext('');
    setConfirm('');
    return 'Password changed.';
  });
  return (
    <form className={`${styles.field} cord-settings__field`} onSubmit={onSubmit}>
      <div className={styles.fieldLabel}>Change password</div>
      <div className={own.form}>
        <input className={styles.textInput} type="password" placeholder="Current password" autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className={styles.textInput} type="password" placeholder="New password" autoComplete="new-password"
          value={next} onChange={(e) => setNext(e.target.value)} />
        <input className={styles.textInput} type="password" placeholder="Repeat new password" autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button type="submit" className={styles.secondaryBtn} disabled={busy || !current || !next || !confirm}>
          Change password
        </button>
        {status && <div className={styles.fieldHint} role="status">{status}</div>}
      </div>
    </form>
  );
}

function NewRecoveryKey() {
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const { status, busy, onSubmit } = useAction(async () => {
    const { recoveryKey } = await api.auth.issueRecoveryKey({ password });
    setPassword('');
    setKey(recoveryKey);
    return 'Your old recovery key no longer works. Save this one now — it won’t be shown again.';
  });
  return (
    <form className={`${styles.field} cord-settings__field`} onSubmit={onSubmit}>
      <div className={styles.fieldLabel}>Recovery key</div>
      <div className={styles.fieldHint}>Make a new one if the old key was lost or seen by someone else.</div>
      <div className={own.form}>
        <input className={styles.textInput} type="password" placeholder="Password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className={styles.secondaryBtn} disabled={busy || !password}>
          Make a new recovery key
        </button>
        {key && <code className={own.key}>{key}</code>}
        {status && <div className={styles.fieldHint} role="status">{status}</div>}
      </div>
    </form>
  );
}

export default function AccountPage() {
  return (
    <>
      <ChangePin />
      <ChangePassword />
      <NewRecoveryKey />
    </>
  );
}
```

- [ ] **Step 3: Register the page**

In `components/settings/pages.ts`, add the import `import AccountPage from './AccountPage';` next to the others and:

```ts
registry.addPage('settings', { id: 'account',  label: 'Account',  component: AccountPage,  position: 40 });
```

- [ ] **Step 4: Type-check and test**

Run: `bunx tsc --noEmit && CORD_DB_PATH=:memory: bun test src`
Expected: no type errors; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/settings
git commit -m "Add the Account settings page"
```

---

### Task 13: Docs and end-to-end verification

**Files:**
- Modify: `.claude/CLAUDE.md`
- Modify: `docs/theming/public-api.md`
- Modify: `docs/specs/2026-09-27-pin-unlock-design.md`

- [ ] **Step 1: CLAUDE.md**

In principle 2, after the `blocks` exception sentence, add:

```
   Second documented exception: auth state — password, PIN and recovery-key
   hashes, the PIN attempt counter, and `app_state` (`last_user_id`) — is
   machine-local, must never replicate, and is not logged. Settings files are
   per-device preferences and are not logged either.
```

In the schema block, add after `attachments`:

```sql
users         (id TEXT PK, username UNIQUE, password_hash, pin_hash, failed_pin_attempts INT, recovery_key_hash, created_at INT)
app_state     (key TEXT PK, value, updated_at INT)   -- machine-local, never synced
```

Add one bullet under the schema notes:

```
- Settings files live per user in `~/.cord/users/<userId>/` (`settings.json`,
  `keybindings.json`). The lock screen paints from a per-user boot cache in
  localStorage. PIN unlock: docs/specs/2026-09-27-pin-unlock-design.md.
```

- [ ] **Step 2: Theming public API**

In `docs/theming/public-api.md`, after the `cord-login__card` row, add:

```
| `cord-login__pin` | PIN field |
| `cord-login__user-picker` | User dropdown on the lock screen |
| `cord-login__links` | Row of secondary actions under a lock-screen form |
| `cord-login__recovery-key` | The recovery key shown once during setup |
```

- [ ] **Step 3: Align the spec with what was built**

In `docs/specs/2026-09-27-pin-unlock-design.md`:
- "Register" paragraph: "shown once with Copy and Save to file" → "shown once with a Copy button".
- "Settings → Security page" paragraph: rename the heading to "**Settings → Account page**" and say the idle lock lives in the Security section of the generated settings.
- Sidecar section: delete the bullet "Unknown user and wrong PIN both take a hash comparison, and error messages never reveal whether a username exists." and replace it with: "Password sign-in and recovery never reveal whether a username exists. (The lock screen lists users anyway, so PIN unlock takes a user id.)"

- [ ] **Step 4: Full automated check**

From `apps/desktop`:

Run: `CORD_DB_PATH=:memory: bun test src`
Expected: all PASS (209 at the start plus about 50 new).

Run: `bunx tsc --noEmit`
Expected: no errors.

Run: `cd src-tauri && cargo check`
Expected: no errors.

- [ ] **Step 5: Run the app against a throwaway database**

Use the `run` skill, or `bun run dev` from `apps/desktop` with `CORD_DB_PATH` and `CORD_CONFIG_DIR` pointing into a temp folder, so the real `~/.cord` is not touched. Walk through and screenshot:

1. Fresh database → register view → create `alice` → set PIN → recovery key shown, Continue disabled until ticked → workspace opens.
2. Settings → Appearance: change theme. Command bar → **Lock** → PIN screen in alice's theme.
3. **New user** → `bob` → setup → default theme. Change bob's theme. Lock.
4. Dropdown: alice ↔ bob repaints each user's theme before unlocking.
5. Five wrong PINs for bob → "N tries left" each time → password view with the notice → password works.
6. **Forgot PIN?** → password + new PIN → unlocks; the new PIN works after Lock.
7. **Forgot password?** with alice's saved key → new password → set PIN → new recovery key shown; the old key fails afterwards.
8. Settings → Security: set idle lock to 5 min (set it to 5 and temporarily test by changing `60_000` to `1_000` locally — revert before committing).
9. Restart the app → it opens on the last user's PIN screen in their theme, no flash of another theme.
10. Check `<temp>/users/<id>/settings.json` exists per user.

Also: copy the real `~/.cord/cord.db` and `settings.json` into a second temp folder and launch against it → the existing user signs in with the password → sets PIN → gets key → their existing theme and shortcuts are intact.

- [ ] **Step 6: Commit**

```bash
git add .claude/CLAUDE.md docs
git commit -m "Document PIN unlock and per-user settings"
```

- [ ] **Step 7: Hand off**

Use superpowers:finishing-a-development-branch. Do not merge or push without asking.
