import express, { type ErrorRequestHandler } from 'express';
import type { Database } from './db/index.js';
import type { Config } from './config.js';
import { SessionStore } from './sessions.js';
import { authRoutes } from './routes/auth.js';
import { imageRoutes } from './routes/images.js';
import { syncRoutes } from './routes/sync.js';
import type { AppContext } from './routes/context.js';

/**
 * Builds the API. Kept separate from `index.ts` so tests can mount it on an
 * ephemeral port with an in-memory database.
 */
export function createApp(
  db: Database,
  config: Config,
  sessions = new SessionStore(config.sessionTtlMs),
) {
  const app = express();
  const context: AppContext = { db, config, sessions };

  app.disable('x-powered-by');
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

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error('[api] unhandled error', error);
    res.status(500).json({ error: 'Something went wrong handling that request.' });
  };
  app.use(onError);

  return app;
}
