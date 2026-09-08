import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { SessionStore } from './sessions.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const sessions = new SessionStore(config.sessionTtlMs);

// In production the built UI ships from the API origin, which keeps the session
// cookie same-site. In development Vite serves it and proxies /api here instead.
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const app = createApp(db, config, sessions, (app) => {
  if (!existsSync(webDist)) return;
  app.use(express.static(webDist));
  // Client-side routing fallback, written as middleware rather than a wildcard
  // route so it does not depend on the router's path-pattern syntax.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(join(webDist, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
});

const server = app.listen(config.port, () => {
  console.log(`ghost-image-browser API listening on http://localhost:${config.port}`);
  if (config.ghostUrl) console.log(`Locked to Ghost site ${config.ghostUrl}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      sessions.stop();
      db.close();
      process.exit(0);
    });
  });
}
