import type { GhostResource } from './extract.js';
import { normalizeSiteUrl } from './urls.js';

const ADMIN_API_VERSION = 'v5.0';
const SESSION_COOKIE = 'ghost-admin-api-session';
const PAGE_SIZE = 100;

export type GhostResourceType = 'posts' | 'pages';

export class GhostApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'GhostApiError';
  }
}

interface GhostErrorBody {
  errors?: Array<{ message?: string; context?: string; type?: string; code?: string }>;
}

async function readError(response: Response, fallback: string): Promise<GhostApiError> {
  let body: GhostErrorBody = {};
  try {
    body = (await response.json()) as GhostErrorBody;
  } catch {
    // Ghost returns HTML for some proxy-level failures; the status still tells us enough.
  }
  const error = body.errors?.[0];
  const detail = [error?.message, error?.context].filter(Boolean).join(' — ');
  return new GhostApiError(detail || fallback, response.status, error?.code ?? error?.type);
}

/**
 * Talks to a Ghost site's Admin API using *staff credentials*.
 *
 * Ghost offers two Admin API auth schemes: an integration's Admin API key, and
 * the cookie session the Ghost admin client itself uses. We use the session
 * scheme because the product requirement is that people sign in with the email
 * and password they already have as Ghost staff — no integration key to
 * provision, and each user only sees what their own role allows.
 *
 * Ghost checks `Origin` on session-authenticated requests, so every call sends
 * the site's own origin. The session cookie is held server-side (see
 * `sessions.ts`); it never reaches the browser.
 */
export class GhostAdminClient {
  readonly siteUrl: string;
  private aliases: string[] = [];

  constructor(
    siteUrl: string,
    private readonly cookie: string,
  ) {
    this.siteUrl = normalizeSiteUrl(siteUrl);
  }

  /**
   * Other URLs that mean this same site, learned from `getSite()`.
   *
   * Ghost builds the absolute image URLs it stores from its own configured
   * `url`, so unless the admin happens to sign in through exactly that host,
   * those URLs must be recognised as internal via this list.
   */
  get siteAliases(): string[] {
    return this.aliases;
  }

  /**
   * Exchanges staff email + password for a Ghost session cookie.
   *
   * @throws GhostApiError on bad credentials, or when the account has 2FA
   *   enabled — Ghost then requires a one-time code this flow cannot supply.
   */
  static async login(siteUrl: string, email: string, password: string): Promise<GhostAdminClient> {
    const base = normalizeSiteUrl(siteUrl);
    const response = await fetch(`${base}/ghost/api/admin/session/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Version': ADMIN_API_VERSION,
        Origin: new URL(base).origin,
      },
      body: JSON.stringify({ username: email, password }),
      redirect: 'manual',
    });

    if (!response.ok) {
      const error = await readError(response, 'Ghost rejected those credentials.');
      if (error.code === '2FA_TOKEN_REQUIRED' || error.code === 'Needs2FAError') {
        throw new GhostApiError(
          'This Ghost account requires a two-factor code, which this app cannot supply. ' +
            'Use an account without 2FA, or disable it for this account.',
          error.status,
          error.code,
        );
      }
      throw error;
    }

    const cookie = response.headers
      .getSetCookie()
      .map((raw) => raw.split(';')[0] ?? '')
      .find((pair) => pair.startsWith(`${SESSION_COOKIE}=`));

    if (!cookie) {
      throw new GhostApiError(
        'Ghost accepted the login but returned no session cookie. Is this URL the Ghost site root?',
        response.status,
      );
    }

    return new GhostAdminClient(base, cookie);
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.siteUrl}/ghost/api/admin/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Version': ADMIN_API_VERSION,
        Origin: new URL(this.siteUrl).origin,
        Cookie: this.cookie,
      },
      redirect: 'manual',
    });

    if (!response.ok) throw await readError(response, `Ghost request failed: GET ${path}`);
    return (await response.json()) as T;
  }

  /**
   * The signed-in user's primary role name (`Owner`, `Administrator`, `Editor`,
   * `Author`, `Contributor`). Used to decide whether this session may run a
   * full-site sync — see `catalog/roles.ts`.
   */
  async getCurrentUser(): Promise<{ email: string; role: string }> {
    const body = await this.get<{
      users?: Array<{ email?: string; roles?: Array<{ name?: string }> }>;
    }>('users/me/', { include: 'roles' });
    const user = body.users?.[0];
    return { email: user?.email ?? '', role: user?.roles?.[0]?.name ?? 'Unknown' };
  }

  /** Confirms the session is still valid and returns the site's own metadata. */
  async getSite(): Promise<{ title: string; url: string; version: string }> {
    const body = await this.get<{ site: { title: string; url: string; version: string } }>('site/');
    if (body.site?.url) {
      try {
        const configured = normalizeSiteUrl(body.site.url);
        if (configured !== this.siteUrl) this.aliases = [configured];
      } catch {
        // A malformed `url` in Ghost's config costs us alias matching, nothing more.
      }
    }
    return body.site;
  }

  /**
   * Walks every post or page, one API page at a time.
   *
   * Ghost caps `limit` well below most sites' post counts and `limit=all` on a
   * large site with full HTML bodies is a memory problem on both ends, so this
   * yields batches for the caller to process incrementally.
   */
  async *browse(type: GhostResourceType): AsyncGenerator<GhostResource[]> {
    let page = 1;
    for (;;) {
      const body = await this.get<{
        [key: string]: GhostResource[] | { pagination?: { pages: number | null } } | undefined;
      }>(`${type}/`, {
        formats: 'html,lexical,mobiledoc',
        limit: String(PAGE_SIZE),
        page: String(page),
      });

      const items = (body[type] as GhostResource[] | undefined) ?? [];
      if (items.length > 0) yield items;

      const meta = body.meta as { pagination?: { pages: number | null } } | undefined;
      const totalPages = meta?.pagination?.pages ?? 1;
      if (page >= (totalPages || 1) || items.length === 0) return;
      page += 1;
    }
  }
}
