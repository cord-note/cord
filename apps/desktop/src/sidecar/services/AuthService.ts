import { nanoid } from 'nanoid';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { appState, users } from '../db/schema';
import { generateRecoveryKey, normaliseRecoveryKey } from './recoveryKey';
import type {
  AuthSession,
  AuthUser,
  ChangePasswordInput,
  IssueRecoveryKeyInput,
  LockScreenState,
  LoginInput,
  PinUnlockResult,
  RecoverInput,
  RecoveryKeyResult,
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
