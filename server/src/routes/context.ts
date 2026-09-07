import type { Request, Response, NextFunction } from 'express';
import type { Database } from '../db/index.js';
import type { Config } from '../config.js';
import type { AppSession, SessionStore } from '../sessions.js';
import { SESSION_COOKIE_NAME } from '../sessions.js';

export interface AppContext {
  db: Database;
  config: Config;
  sessions: SessionStore;
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: AppSession;
  }
}

/** Reads one cookie without pulling in a parser dependency. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Rejects the request unless it carries a live session. */
export function requireSession(sessions: SessionStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = sessions.get(readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    req.session = session;
    next();
  };
}

/** Wraps an async handler so rejected promises reach Express's error handler. */
export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
