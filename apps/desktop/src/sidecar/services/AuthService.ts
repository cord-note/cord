import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import type { User, RegisterInput, LoginInput, AuthSession } from '@shared/types';

// In-process session — the sidecar is a single-user local process.
let _session: AuthSession | null = null;

export class AuthService {
  hasUsers(): boolean {
    const db = getDb();
    return db.select({ id: users.id }).from(users).limit(1).all().length > 0;
  }

  async register(input: RegisterInput): Promise<User> {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();
    const passwordHash = await Bun.password.hash(input.password, { algorithm: 'bcrypt', cost: 12 });

    db.insert(users).values({
      id,
      username:     input.username.toLowerCase().trim(),
      passwordHash,
      createdAt:    now,
    }).run();

    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) throw new Error('User not found after insert');

    // Registering signs you in — otherwise the renderer would show the
    // authenticated UI while every subsequent request failed requireSession().
    _session = { userId: row.id, username: row.username, loggedInAt: Date.now() };
    return toUser(row);
  }

  async login(input: LoginInput): Promise<User> {
    const db = getDb();
    const row = db
      .select()
      .from(users)
      .where(eq(users.username, input.username.toLowerCase().trim()))
      .get();

    if (!row) throw new Error('Invalid username or password');

    const valid = await Bun.password.verify(input.password, row.passwordHash);
    if (!valid) throw new Error('Invalid username or password');

    _session = { userId: row.id, username: row.username, loggedInAt: Date.now() };
    return toUser(row);
  }

  logout(): void {
    _session = null;
  }

  getSession(): AuthSession | null {
    return _session;
  }

  requireSession(): AuthSession {
    if (!_session) throw new Error('Not authenticated');
    return _session;
  }
}

function toUser(row: typeof users.$inferSelect): User {
  return { id: row.id, username: row.username, createdAt: row.createdAt };
}
