import { randomBytes } from 'node:crypto';
import type { GhostAdminClient } from './ghost/client.js';

export interface AppSession {
  id: string;
  siteUrl: string;
  email: string;
  /** The user's Ghost role, e.g. `Administrator`. Gates who may run a sync. */
  role: string;
  client: GhostAdminClient;
  createdAt: number;
  lastUsedAt: number;
}

export const SESSION_COOKIE_NAME = 'gib_session';

/**
 * In-memory store for signed-in staff.
 *
 * The Ghost session cookie lives here and only here: the browser gets an opaque
 * random id, so a compromised front end cannot replay Ghost admin credentials
 * against the site. The trade-off is that sessions do not survive a server
 * restart, which is the right default for a tool that holds someone else's
 * admin session.
 */
export class SessionStore {
  private readonly sessions = new Map<string, AppSession>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly ttlMs: number,
    sweepIntervalMs = Math.min(ttlMs, 5 * 60_000),
  ) {
    // `get()` evicts lazily, but a user who closes the tab without signing out
    // is never looked up again — without this sweep their entry (and the Ghost
    // admin cookie it pins) would live in memory until the process restarts.
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastUsedAt > this.ttlMs) this.sessions.delete(id);
    }
  }

  /** Stops the background sweep. Call on shutdown or when discarding the store. */
  stop(): void {
    clearInterval(this.sweepTimer);
  }

  create(siteUrl: string, email: string, client: GhostAdminClient, role = 'Unknown'): AppSession {
    const now = Date.now();
    const session: AppSession = {
      id: randomBytes(32).toString('hex'),
      siteUrl,
      email,
      role,
      client,
      createdAt: now,
      lastUsedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): AppSession | null {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (Date.now() - session.lastUsedAt > this.ttlMs) {
      this.sessions.delete(id);
      return null;
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  get size(): number {
    return this.sessions.size;
  }
}
