export interface Config {
  port: number;
  databasePath: string;
  /** When set, users cannot choose a site at login — only this one is allowed. */
  ghostUrl: string | null;
  corsOrigins: string[];
  /** How long an idle app session survives, in milliseconds. */
  sessionTtlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 4000),
    databasePath: env.DATABASE_PATH ?? './data/catalog.sqlite',
    ghostUrl: env.GHOST_URL?.trim() ? env.GHOST_URL.trim() : null,
    corsOrigins: (env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 12 * 60 * 60 * 1000),
  };
}
