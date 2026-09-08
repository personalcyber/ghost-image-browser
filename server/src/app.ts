import express, { type ErrorRequestHandler } from 'express';
import type { Database } from './db/index.js';
import type { Config } from './config.js';
import { SessionStore } from './sessions.js';
import type { FetchImpl } from './ghost/client.js';
import { authRoutes } from './routes/auth.js';
import { imageRoutes } from './routes/images.js';
import { syncRoutes } from './routes/sync.js';
import type { AppContext } from './routes/context.js';

interface AppOptions {
  // Lets `index.ts` mount the static UI + SPA fallback *before* the error
  // handler, so a failure serving those still produces a JSON 500 rather than
  // Express's default HTML handler.
  mountExtra?: (app: express.Express) => void;
  /** `fetch` used for the Ghost sign-in calls; injected in tests. */
  loginFetch?: FetchImpl;
}

/**
 * Builds the API. Kept separate from `index.ts` so tests can mount it on an
 * ephemeral port with an in-memory database.
 */
export function createApp(
  db: Database,
  config: Config,
  sessions = new SessionStore(config.sessionTtlMs),
  { mountExtra, loginFetch = fetch }: AppOptions = {},
) {
  const app = express();
  const context: AppContext = { db, config, sessions, loginFetch };

  app.disable('x-powered-by');
  // Governs `req.secure` / `req.protocol` behind a TLS-terminating proxy, which
  // is what decides whether the session cookie gets the `Secure` attribute.
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '256kb' }));

  // In development the UI is served by Vite on another origin, so credentialed
  // requests need an explicit allow-list. In production the built UI is served
  // from this same origin and none of this applies.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes(context));
  app.use('/api/images', imageRoutes(context));
  app.use('/api/sync', syncRoutes(context));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));

  mountExtra?.(app);

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);

    // `express.json` and other middleware attach an HTTP status to their errors
    // (a bad request body is 400, not a server fault); only a missing/5xx
    // status is a genuine "something went wrong on our side".
    const raw: unknown =
      (error as { status?: unknown; statusCode?: unknown })?.status ??
      (error as { statusCode?: unknown })?.statusCode;
    const status = typeof raw === 'number' && raw >= 400 && raw < 600 ? raw : 500;

    if (status >= 500) console.error('[api] unhandled error', error);
    const exposed =
      status < 500 && (error as { expose?: boolean })?.expose && error instanceof Error
        ? error.message
        : 'Something went wrong handling that request.';
    res.status(status).json({ error: exposed });
  };
  app.use(onError);

  return app;
}
