import { randomBytes } from 'node:crypto';
import type { GhostAdminClient } from './ghost/client.js';

export interface AppSession {
  id: string;
  siteUrl: string;
  email: string;
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

  constructor(private readonly ttlMs: number) {}

  create(siteUrl: string, email: string, client: GhostAdminClient): AppSession {
    const now = Date.now();
    const session: AppSession = {
      id: randomBytes(32).toString('hex'),
      siteUrl,
      email,
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
