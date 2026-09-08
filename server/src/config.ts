export interface Config {
  port: number;
  databasePath: string;
  /** When set, users cannot choose a site at login — only this one is allowed. */
  ghostUrl: string | null;
  corsOrigins: string[];
  /** How long an idle app session survives, in milliseconds. */
  sessionTtlMs: number;
  /**
   * Passed straight to Express's `trust proxy` setting. `false` (the default)
   * means every request is treated as direct; set it (`true`, a hop count, or a
   * subnet list) when a reverse proxy terminates TLS, so `req.secure` reflects
   * `X-Forwarded-Proto` and the session cookie is issued with `Secure`.
   */
  trustProxy: boolean | number | string;
}

/** Parses `TRUST_PROXY`: `true`/`false`, a hop count, or a subnet list. */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const value = raw?.trim();
  if (!value) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return /^\d+$/.test(value) ? Number(value) : value;
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
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  };
}
