# PIN unlock and per-user settings — design

**Status:** approved, Stage 1 of 2
**Branch:** `feature/pin-unlock`

## Why

Cord asks for a full password on every launch, because the session lives only
in the sidecar's memory. On a machine already behind an OS login that is
friction without much protection. Several people can share one Cord install,
but every setting — theme included — is global, so switching user never
switches the look.

## Decisions

| Topic | Decision |
|---|---|
| Daily unlock | A 4–6 digit PIN the user sets |
| Password | Needed to register, to reset a forgotten PIN, and after too many wrong PINs |
| Remembered user | The last unlocked user is preselected; a dropdown switches user |
| When the PIN is asked | Every launch, plus an optional per-user idle lock (off by default) |
| Wrong PINs | After 5 in a row the PIN is disabled until the password is entered |
| Forgotten password | Reset with a recovery key shown once at setup. No key, no recovery |
| Existing users | Sign in with the password once, then set a PIN and receive a recovery key |
| Per-user settings | One settings folder per user: `settings.json` and `keybindings.json` both follow the user |
| Encryption | **Not in Stage 1.** Data stays plaintext on disk; the PIN is an access gate |
| Operation log | Auth writes are not logged (see below) |

### Two stages

**Stage 1 (this spec)** ships the PIN, remembered user, user switcher,
per-user settings and recovery keys.

**Stage 2 (separate project)** encrypts the database with a password-derived
key. It needs SQLCipher, which `bun:sqlite` cannot load on Windows or Linux,
and Rust search opens the same file — so it is a feasibility spike first, not
an add-on. Only when data is encrypted does "no recovery without the key"
become a cryptographic fact rather than a policy. The recovery key introduced
here carries over: in Stage 2 it will wrap the vault key.

Until then, anyone with file access can read `cord.db`. The UI must not claim
otherwise — no "encrypted" or "secure vault" wording.

## What the user sees

**Launch.** Cord reads the lock-screen state, paints the last user's theme
from their boot cache (no flash of the wrong theme), and shows the PIN screen
with their name. A dropdown lists the other users; picking one repaints with
that user's cached theme.

- Correct PIN → unlocked.
- Wrong PIN → "Wrong PIN — N tries left". At zero: "Too many attempts. Enter
  your password." and the PIN field is replaced by the password field.
- Links under the field: **Use password instead**, **Forgot PIN?** (same
  thing — password, then choose a new PIN), **New user**.
- A user who has no PIN yet (existing users after the update) goes straight to
  the password field.

**Register.** Username, password, confirm → choose PIN (entered twice) →
recovery key screen. The key is shown once with a Copy button, and
Continue stays disabled until "I've saved my recovery key" is ticked.

**First launch after the update.** Password sign-in as today → choose PIN →
recovery key screen.

**Forgotten password.** From the password field: **Forgot password?** →
enter recovery key → new password (twice) → new PIN → a **new** recovery key
is shown; the old one stops working.

**Idle lock.** Setting `security.idleLockMinutes` (0 = off, default). After
that many minutes with no keyboard or pointer input in the app, Cord
flushes pending saves and returns to the PIN screen for
the same user.

**Settings → Account page.** Change PIN (needs the password), change
password (needs the current one), and make a new recovery key (needs the
password). The idle lock option is in the generated **Security** section.

**Lock / switch user.** The existing Log out command becomes **Lock**, which
returns to the PIN screen with the current user preselected; switching user
happens from there.

## Data

Additive migration, guarded so re-running is a no-op.

```sql
ALTER TABLE users ADD pin_hash            TEXT;            -- NULL = no PIN yet
ALTER TABLE users ADD failed_pin_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD recovery_key_hash   TEXT;            -- NULL = no key yet

CREATE TABLE app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- rows: 'last_user_id'
```

- PINs and recovery keys are hashed with `Bun.password` exactly like
  passwords (bcrypt, cost 12). The attempt counter lives in the database, so
  restarting Cord does not reset it.
- Recovery key: 20 random bytes (160 bits), Crockford base32, shown as eight groups of
  four (`K7QM-2XVD-…`). Input is normalised (uppercase, dashes and spaces
  stripped, `O→0`, `I/L→1`) before verifying.
- Themes and other preferences are **not** in the database — they live in the
  user's settings files.

### Operation log exception

Password, PIN and recovery-key hashes, the attempt counter and `last_user_id`
belong to this machine and must never replicate to a cloud. `operation_log`
also requires a `vault_id`, which these rows do not have. So these writes are
not logged — the same stance the settings foundation took for `settings.json`.
CLAUDE.md principle 2 gains this as its second documented exception.

## Per-user settings files

```
~/.cord/
  cord.db
  settings.json          ← pre-update global files, left in place, no longer read
  keybindings.json
  users/
    <userId>/
      settings.json
      keybindings.json
```

- `SettingsFileService` resolves paths as
  `resolveConfigDir()/users/<userId>/<name>.json` for the **session user**.
  `CORD_CONFIG_DIR` still overrides the base directory.
- The settings endpoints now require a session. The pre-unlock theme comes
  from the renderer's boot cache instead (below), so no unauthenticated read
  is needed.
- **Seeding:** when a session starts and the user's folder does not exist,
  copy the global `settings.json` / `keybindings.json` into it if present.
  Registration creates the folder empty, so new users start from defaults and
  existing users keep their current setup.
- **Boot cache** becomes per-user: `cord-settings-cache:<userId>`. On first
  run the old `cord-settings-cache` is moved to the first user who unlocks.
  The lock screen reads the cache of the preselected user; a user with no
  cache gets the default theme until unlocked.
- **Switching user:** before the session ends the renderer flushes the
  settings and keybinding writers, so a pending save cannot land in the next
  user's file. After unlock it reloads both stores from scratch.

## Sidecar

`AuthService` (handlers stay thin — parse, delegate, return):

| Method | Does |
|---|---|
| `getLockScreenState()` | Users (id, username, hasPin, pinLocked), `lastUserId` |
| `unlockWithPin(userId, pin)` | Verify; on success reset counter, start session, set `last_user_id`; on failure increment and return `triesLeft` |
| `login(username, password)` | As today, plus reset counter and set `last_user_id` |
| `setPin(pin)` | Session user; validates `^\d{4,6}$` |
| `changePassword(current, next)` | Session user |
| `issueRecoveryKey()` | Session user; returns the plaintext key once, stores its hash |
| `resetPasswordWithRecoveryKey(username, key, newPassword)` | Verify key, set password, clear PIN and counter, start session. Caller then sets a PIN and issues a new key |
| `lock()` | Ends the session (replaces `logout`) |

- PIN format and the 5-attempt limit are enforced here, not only in the UI.
  `unlockWithPin` refuses while the counter is at 5.
- Password sign-in and recovery never reveal whether a username exists. (The
  lock screen lists users anyway, so PIN unlock takes a user id.)
- `SettingsFileService` takes the session user from `AuthService` and ensures
  the folder (with seeding) on first access.

Tauri gains thin commands for each new route; the existing test that every
`invoke()` name matches a registered command covers them.

## Renderer

- `LoginScreen` becomes a small state machine of views: `pin`, `password`,
  `forgotPin`, `register`, `setPin`, `recoveryKey`, `recover`. Existing styles and the
  `cord-login` public classes are kept; new views use `cord-login__*` names
  added to `docs/theming/public-api.md`.
- The auth store gains `lockScreen` state and the new actions; `logout`
  becomes `lock`, keeping the existing store resets.
- `settings/boot.ts` no longer loads settings at app start. It applies the
  preselected user's boot cache; `load()` runs after unlock.
- Idle lock: one listener hook on `pointermove`, `keydown`, `wheel` that
  resets a timer read from `security.idleLockMinutes`.
- Settings gets a **Security** section (the idle-lock setting) and an
  **Account** page registered through the UI registry, like every other page.

## Error handling

- Sidecar unreachable on the lock screen → the existing startup error path.
- `users/<id>/` cannot be created or written → the settings store's existing
  `saveError` banner; unlock still succeeds.
- Corrupt boot cache → ignored, default theme.
- Recovery key wrong → "That recovery key doesn't match." No attempt limit
  (160 bits of entropy), but a 1s delay per failure.

## Tests (`bun test`, `CORD_DB_PATH=:memory:`)

- Migration adds columns and `app_state`, and re-running is a no-op.
- PIN: format validation; correct unlock resets the counter; five failures
  lock the PIN; password login clears the lock; counter survives a new
  `AuthService` instance.
- Recovery: correct key resets the password and clears the PIN; old key fails
  after `issueRecoveryKey`; normalisation accepts lowercase and missing dashes.
- `last_user_id` is set by PIN unlock and password login.
- Settings files: paths are per session user; no session → error; seeding
  copies global files only when the user folder is missing; registration
  creates an empty folder.
- Renderer: boot cache key per user and one-time move of the legacy key;
  writers flushed before `lock()`.

## Out of scope

- Database encryption (Stage 2).
- Windows Hello / Touch ID unlock.
- Deleting users, admin roles, one user resetting another.
- Per-vault settings overrides.
